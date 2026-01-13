import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AgentBrowserOptions } from "./browser";
import { createBrowser } from "./browser";
import {
  type Command,
  commandSchema,
  executeActions,
  executeCommand,
  formatStepText,
  formatWaitText,
  getStateOptionsSchema,
  type StepAction,
  stepActionSchema,
  type WaitCondition,
  waitConditionSchema,
} from "./commands";
import { createIdGenerator } from "./id";
import { log } from "./log";
import {
  deleteProfile,
  listProfiles,
  loadProfile,
  resolveProfilePath,
  resolveStorageStateOption,
  saveProfile,
} from "./profiles";
import { formatStateText } from "./state";
import type { StorageState } from "./types";

export interface BrowserServerConfig {
  host?: string;
  port?: number;
  sessionTtlMs?: number;
  browserOptions: AgentBrowserOptions;
}

type ServerSession = {
  id: string;
  browser: ReturnType<typeof createBrowser>;
  lastUsed: number;
  busy: boolean;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

// Utility functions
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wantsJsonResponse(c: Context): boolean {
  const format = c.req.query("format");
  if (format === "json") return true;
  if (format === "text") return false;
  const accept = c.req.header("accept") ?? "";
  // Default to text/plain unless explicitly requesting JSON
  return accept
    .split(",")
    .some((v) => v.toLowerCase().includes("application/json"));
}

function createErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function throwNotFound(message: string): never {
  throw new HTTPException(404, { res: createErrorResponse(message, 404) });
}

function throwBusy(): never {
  throw new HTTPException(409, {
    res: createErrorResponse("Session is busy", 409),
  });
}

function _throwBadRequest(message: string): never {
  throw new HTTPException(400, { res: createErrorResponse(message, 400) });
}

function throwServerError(error: unknown): never {
  const message = getErrorMessage(error);
  throw new HTTPException(500, { res: createErrorResponse(message, 500) });
}

function throwAborted(message: string): never {
  throw new HTTPException(408, { res: createErrorResponse(message, 408) });
}

function getSessionOrThrow(
  sessions: Map<string, ServerSession>,
  sessionId: string,
): ServerSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throwNotFound(`Session not found: ${sessionId}`);
  }
  if (session.busy) {
    throwBusy();
  }
  return session;
}

async function withSession<T>(
  session: ServerSession,
  fn: () => Promise<T>,
): Promise<T> {
  session.busy = true;
  session.lastUsed = Date.now();
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throwServerError(error);
  } finally {
    session.busy = false;
    session.lastUsed = Date.now();
  }
}

// Command and step action schemas are imported from ./commands

const stepRequestSchema = z.object({
  actions: z.array(stepActionSchema).default([]),
  state: getStateOptionsSchema.optional(),
  includeState: z.boolean().default(false),
  includeStateText: z.boolean().default(true),
  haltOnError: z.boolean().default(true),
});

// WaitCondition type and waitConditionSchema are imported from ./commands

// Wait request uses discriminated union: either has "expect" wrapper or inline conditions
const waitWithExpectSchema = z.object({
  kind: z.literal("expect").default("expect"),
  expect: waitConditionSchema,
  timeoutMs: z.number().int().optional(),
  includeState: z.boolean().default(false),
  includeStateText: z.boolean().default(true),
  state: getStateOptionsSchema.optional(),
});

const waitInlineSchema = z
  .object({
    kind: z.literal("inline").default("inline"),
    timeoutMs: z.number().int().optional(),
    includeState: z.boolean().default(false),
    includeStateText: z.boolean().default(true),
    state: getStateOptionsSchema.optional(),
  })
  .extend(waitConditionSchema.shape);

// Transform incoming request to normalized form
const waitRequestSchema = z
  .union([
    z.object({ expect: waitConditionSchema }).passthrough(),
    waitConditionSchema.passthrough(),
  ])
  .transform(
    (
      data,
    ):
      | z.infer<typeof waitWithExpectSchema>
      | z.infer<typeof waitInlineSchema> => {
      if ("expect" in data && data.expect) {
        return {
          kind: "expect",
          expect: data.expect,
          timeoutMs:
            "timeoutMs" in data
              ? (data.timeoutMs as number | undefined)
              : undefined,
          includeState:
            "includeState" in data ? (data.includeState as boolean) : false,
          includeStateText:
            "includeStateText" in data
              ? (data.includeStateText as boolean)
              : true,
          state:
            "state" in data
              ? (data.state as
                  | z.infer<typeof getStateOptionsSchema>
                  | undefined)
              : undefined,
        };
      }
      return {
        kind: "inline",
        selector:
          "selector" in data
            ? (data.selector as string | undefined)
            : undefined,
        text: "text" in data ? (data.text as string | undefined) : undefined,
        url: "url" in data ? (data.url as string | undefined) : undefined,
        notSelector:
          "notSelector" in data
            ? (data.notSelector as string | undefined)
            : undefined,
        notText:
          "notText" in data ? (data.notText as string | undefined) : undefined,
        timeoutMs:
          "timeoutMs" in data
            ? (data.timeoutMs as number | undefined)
            : undefined,
        includeState:
          "includeState" in data ? (data.includeState as boolean) : false,
        includeStateText:
          "includeStateText" in data
            ? (data.includeStateText as boolean)
            : true,
        state:
          "state" in data
            ? (data.state as z.infer<typeof getStateOptionsSchema> | undefined)
            : undefined,
      };
    },
  );

type WaitRequest = z.infer<typeof waitRequestSchema>;

function getWaitCondition(data: WaitRequest): WaitCondition {
  if (data.kind === "expect") {
    return data.expect;
  }
  return {
    selector: data.selector,
    text: data.text,
    url: data.url,
    notSelector: data.notSelector,
    notText: data.notText,
  };
}

const createSessionBodySchema = z.object({
  headless: z.boolean().optional(),
  userDataDir: z.string().optional(),
  profile: z.string().optional(),
});

const sessionParamsSchema = z.object({
  sessionId: z.string(),
});

// Response schemas
const errorResponseSchema = z.object({
  error: z.string(),
});

const sessionInfoSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  busy: z.boolean(),
  lastUsed: z.number().int(),
});

const listSessionsResponseSchema = z.array(sessionInfoSchema);

const createSessionResponseSchema = z.object({
  sessionId: z.string(),
});

const commandResponseSchema = z.unknown();

const stepResultSchema = z.object({
  action: stepActionSchema,
  result: z.unknown().optional(),
  error: z.string().optional(),
});

const stepResponseSchema = z.object({
  results: z.array(stepResultSchema),
  state: z.unknown().optional(),
  stateText: z.string().optional(),
  error: z.string().optional(),
});

const waitResponseSchema = z.object({
  state: z.unknown().optional(),
  stateText: z.string().optional(),
});

// runCommand, runStepActions, formatStepText, formatWaitText are imported from ./commands
// Wrapper to use executeCommand with session
async function runCommand(session: ServerSession, command: Command) {
  return executeCommand(session.browser, command);
}

async function runStepActions(
  session: ServerSession,
  actions: StepAction[],
  haltOnError: boolean,
) {
  return executeActions(session.browser, actions, { haltOnError });
}

// Route definitions
const listSessionsRoute = createRoute({
  method: "get",
  path: "/sessions",
  responses: {
    200: {
      description: "List all sessions with url and title",
      content: {
        "application/json": {
          schema: listSessionsResponseSchema,
        },
      },
    },
  },
});

const createSessionRoute = createRoute({
  method: "post",
  path: "/session",
  request: {
    body: {
      required: false,
      content: {
        "application/json": {
          schema: createSessionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Created session",
      content: {
        "application/json": {
          schema: createSessionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const commandRoute = createRoute({
  method: "post",
  path: "/session/{sessionId}/command",
  request: {
    params: sessionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: commandSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Command result",
      content: {
        "application/json": {
          schema: commandResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Session busy",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Command failed",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const stepRoute = createRoute({
  method: "post",
  path: "/session/{sessionId}/step",
  request: {
    params: sessionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: stepRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Step results",
      content: {
        "application/json": {
          schema: stepResponseSchema,
        },
        "text/plain": {
          schema: z.string(),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Session busy",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Step failed",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const waitRoute = createRoute({
  method: "post",
  path: "/session/{sessionId}/wait",
  request: {
    params: sessionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: waitRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Wait result",
      content: {
        "application/json": {
          schema: waitResponseSchema,
        },
        "text/plain": {
          schema: z.string(),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Session busy",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    408: {
      description: "Client closed request",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Wait failed",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const closeSessionBodySchema = z
  .object({
    saveProfile: z.string().optional(),
    global: z.boolean().optional(),
    private: z.boolean().optional(),
  })
  .optional();

const closeRoute = createRoute({
  method: "post",
  path: "/session/{sessionId}/close",
  request: {
    params: sessionParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: closeSessionBodySchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: "Session closed",
    },
    200: {
      description: "Session closed with profile saved",
      content: {
        "application/json": {
          schema: z.object({
            profileSaved: z.string().optional(),
            profilePath: z.string().optional(),
          }),
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Session busy",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Close failed",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const stateRoute = createRoute({
  method: "get",
  path: "/session/{sessionId}/state",
  request: {
    params: sessionParamsSchema,
  },
  responses: {
    200: {
      description: "Session state as plain text",
      content: {
        "text/plain": {
          schema: z.string(),
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Session busy",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "State retrieval failed",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

export function startBrowserServer(config: BrowserServerConfig) {
  const sessions = new Map<string, ServerSession>();
  const idGenerator = createIdGenerator();
  const host = config.host ?? "localhost";
  const port = config.port ?? 3790;
  const ttl = config.sessionTtlMs ?? DEFAULT_TTL_MS;

  async function createNewSession(overrides?: Partial<AgentBrowserOptions>) {
    const id = idGenerator.next();
    const browser = createBrowser({
      ...config.browserOptions,
      ...overrides,
    });
    await browser.start();
    sessions.set(id, {
      id,
      browser,
      lastUsed: Date.now(),
      busy: false,
    });
    return id;
  }

  const timer = setInterval(
    async () => {
      const now = Date.now();
      for (const [id, session] of sessions) {
        if (now - session.lastUsed > ttl && !session.busy) {
          await session.browser.stop();
          sessions.delete(id);
          idGenerator.release(id);
        }
      }
    },
    Math.max(10_000, Math.floor(ttl / 2)),
  );

  const app = new OpenAPIHono();

  app.use("*", async (c, next) => {
    const start = Date.now();
    try {
      await next();
    } finally {
      const durationMs = Date.now() - start;
      log
        .withMetadata({
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs,
        })
        .info("HTTP");
    }
  });

  // Root route - plain text description
  app.get("/", (c) => {
    const sessionCount = sessions.size;
    const sessionList = Array.from(sessions.values());
    const lines = [
      "Agent Browser Loop Server",
      "=========================",
      "",
      `Sessions: ${sessionCount}`,
    ];

    if (sessionCount > 0) {
      lines.push("");
      for (const s of sessionList) {
        const state = s.browser.getLastState();
        const url = state?.url ?? "about:blank";
        const title = state?.title ?? "(no title)";
        const status = s.busy ? "[busy]" : "[idle]";
        lines.push(`  ${s.id} ${status}`);
        lines.push(`    ${title}`);
        lines.push(`    ${url}`);
      }
    }

    lines.push("");
    lines.push("Endpoints:");
    lines.push("  GET  /              - This help");
    lines.push("  GET  /openapi.json  - OpenAPI spec");
    lines.push("  GET  /sessions      - List sessions");
    lines.push("  POST /session       - Create session");
    lines.push("  POST /session/:id/command - Run command");
    lines.push("  POST /session/:id/step    - Run actions + get state");
    lines.push("  POST /session/:id/wait    - Wait for condition");
    lines.push("  GET  /session/:id/state   - Get session state");
    lines.push("  POST /session/:id/close   - Close session");

    return c.text(lines.join("\n"), 200);
  });

  app.get("/openapi.json", (c) => {
    const spec = app.getOpenAPIDocument({
      openapi: "3.0.0",
      info: {
        title: "Agent Browser Loop Server",
        version: "0.1.0",
      },
      servers: [{ url: `http://${host}:${port}` }],
    });
    return c.text(JSON.stringify(spec, null, 2), 200, {
      "Content-Type": "application/json",
    });
  });

  app.openapi(listSessionsRoute, async (c) => {
    const sessionList = await Promise.all(
      Array.from(sessions.values()).map(async (s) => {
        const state = s.browser.getLastState();
        return {
          id: s.id,
          url: state?.url ?? "about:blank",
          title: state?.title ?? "",
          busy: s.busy,
          lastUsed: s.lastUsed,
        };
      }),
    );
    return c.json(sessionList);
  });

  app.openapi(
    createSessionRoute,
    async (c) => {
      const body = c.req.valid("json");

      const overrides: Partial<AgentBrowserOptions> = {};
      if (body?.headless != null) {
        overrides.headless = body.headless;
      }
      if (body?.userDataDir) {
        overrides.userDataDir = body.userDataDir;
      }

      // Handle profile option
      if (body?.profile) {
        const storageState = resolveStorageStateOption(body.profile);
        if (typeof storageState === "object") {
          overrides.storageState = storageState;
        }
      }

      const id = await createNewSession(overrides);
      return c.json({ sessionId: id }, 200);
    },
    (result, c) => {
      if (!result.success) {
        return c.json({ error: result.error.message }, 400);
      }
    },
  );

  app.openapi(
    commandRoute,
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const session = getSessionOrThrow(sessions, sessionId);
      const command = c.req.valid("json");

      return withSession(session, async () => {
        const result = await runCommand(session, command);
        if (command.type === "close") {
          sessions.delete(sessionId);
          idGenerator.release(sessionId);
        }
        return c.json(result, 200);
      });
    },
    (result, c) => {
      if (!result.success) {
        return c.json({ error: result.error.message }, 400);
      }
    },
  );

  app.openapi(
    stepRoute,
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const session = getSessionOrThrow(sessions, sessionId);
      const { actions, state, includeState, includeStateText, haltOnError } =
        c.req.valid("json");

      return withSession(session, async () => {
        const results = await runStepActions(session, actions, haltOnError);
        const hasError = results.some((r) => r.error != null);

        let stateResult: unknown;
        let stateTextResult: string | undefined;
        if (includeState || includeStateText) {
          const currentState = await session.browser.getState(state);
          if (includeState) {
            stateResult = currentState;
          }
          if (includeStateText) {
            stateTextResult = formatStateText(currentState);
          }
        }

        if (wantsJsonResponse(c)) {
          return c.json(
            {
              results,
              state: stateResult,
              stateText: stateTextResult,
              error: hasError ? "One or more actions failed" : undefined,
            },
            200,
          );
        }

        return c.text(
          formatStepText({ results, stateText: stateTextResult }),
          200,
        );
      });
    },
    (result, c) => {
      if (!result.success) {
        return c.json({ error: result.error.message }, 400);
      }
    },
  );

  app.openapi(
    waitRoute,
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const session = getSessionOrThrow(sessions, sessionId);
      const data = c.req.valid("json");
      const condition = getWaitCondition(data);
      const { timeoutMs, includeState, includeStateText, state } = data;

      return withSession(session, async () => {
        try {
          await session.browser.waitFor({
            ...condition,
            timeoutMs,
            signal: c.req.raw.signal,
          });
        } catch (error) {
          const message = getErrorMessage(error);
          if (message === "Request aborted") {
            throwAborted(message);
          }
          throw error;
        }

        let stateResult: unknown;
        let stateTextResult: string | undefined;
        if (includeState || includeStateText) {
          const currentState = await session.browser.getState(state);
          if (includeState) {
            stateResult = currentState;
          }
          if (includeStateText) {
            stateTextResult = formatStateText(currentState);
          }
        }

        if (wantsJsonResponse(c)) {
          return c.json(
            { state: stateResult, stateText: stateTextResult },
            200,
          );
        }

        return c.text(
          formatWaitText({ condition, stateText: stateTextResult }),
          200,
        );
      });
    },
    (result, c) => {
      if (!result.success) {
        return c.json({ error: result.error.message }, 400);
      }
    },
  );

  app.openapi(closeRoute, async (c) => {
    const { sessionId } = c.req.valid("param");
    const session = getSessionOrThrow(sessions, sessionId);
    const body = c.req.valid("json");

    return withSession(session, async () => {
      let profilePath: string | undefined;

      // Save profile before closing if requested
      if (body?.saveProfile) {
        const storageState =
          (await session.browser.saveStorageState()) as StorageState;
        profilePath = saveProfile(body.saveProfile, storageState, {
          global: body.global,
          private: body.private,
        });
      }

      await session.browser.stop();
      sessions.delete(sessionId);
      idGenerator.release(sessionId);

      if (profilePath) {
        return c.json({ profileSaved: body?.saveProfile, profilePath }, 200);
      }

      return c.body(null, 204);
    });
  });

  app.openapi(stateRoute, async (c) => {
    const { sessionId } = c.req.valid("param");
    const session = getSessionOrThrow(sessions, sessionId);

    return withSession(session, async () => {
      const currentState = await session.browser.getState();
      return c.text(formatStateText(currentState), 200);
    });
  });

  // ========================================================================
  // Profile Endpoints
  // ========================================================================

  // GET /profiles - list all profiles
  app.get("/profiles", (c) => {
    const profiles = listProfiles();
    return c.json(profiles);
  });

  // GET /profiles/:name - get profile contents
  app.get("/profiles/:name", (c) => {
    const name = c.req.param("name");
    const profile = loadProfile(name);
    if (!profile) {
      return c.json({ error: `Profile not found: ${name}` }, 404);
    }
    const resolved = resolveProfilePath(name);
    return c.json({
      name,
      scope: resolved?.scope,
      path: resolved?.path,
      profile,
    });
  });

  // POST /profiles/:name - save profile from session or body
  app.post("/profiles/:name", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json().catch(() => ({}));

    let storageState: StorageState;

    // If sessionId provided, get storage state from that session
    if (body.sessionId) {
      const session = sessions.get(body.sessionId);
      if (!session) {
        return c.json({ error: `Session not found: ${body.sessionId}` }, 404);
      }
      storageState = (await session.browser.saveStorageState()) as StorageState;
    } else if (body.cookies || body.origins) {
      // Direct storage state in body
      storageState = {
        cookies: body.cookies || [],
        origins: body.origins || [],
      };
    } else {
      return c.json(
        {
          error: "Either sessionId or storage state (cookies/origins) required",
        },
        400,
      );
    }

    const savedPath = saveProfile(name, storageState, {
      global: body.global,
      private: body.private,
      description: body.description,
    });

    return c.json({
      name,
      path: savedPath,
      cookies: storageState.cookies.length,
      origins: storageState.origins.length,
    });
  });

  // DELETE /profiles/:name - delete profile
  app.delete("/profiles/:name", (c) => {
    const name = c.req.param("name");
    const resolved = resolveProfilePath(name);
    if (!resolved) {
      return c.json({ error: `Profile not found: ${name}` }, 404);
    }

    const deleted = deleteProfile(name);
    if (!deleted) {
      return c.json({ error: `Failed to delete profile: ${name}` }, 500);
    }

    return c.json({ deleted: name, path: resolved.path });
  });

  const server = Bun.serve({
    hostname: host,
    port,
    fetch: app.fetch,
  });

  return {
    host,
    port,
    server,
    close: async () => {
      clearInterval(timer);
      for (const session of sessions.values()) {
        await session.browser.stop();
      }
      sessions.clear();
      server.stop(true);
    },
  };
}
