import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { VERSION } from "./version";
import { type AgentBrowserOptions, createBrowser } from "./browser";
import {
  type Command,
  commandSchema,
  executeActions,
  executeCommand,
  executeWait,
  formatStepText,
  formatWaitText,
  getStateOptionsSchema,
  type StepAction,
  stepActionSchema,
  type WaitCondition,
  waitConditionSchema,
} from "./commands";
import { createIdGenerator } from "./id";
import { saveProfile } from "./profiles";
import { formatStateText } from "./state";
import type { StorageState } from "./types";

// ============================================================================
// Daemon Protocol
// ============================================================================

const browserOptionsSchema = z
  .object({
    headless: z.boolean().optional(),
    executablePath: z.string().optional(),
    useSystemChrome: z.boolean().optional(),
    viewportWidth: z.number().optional(),
    viewportHeight: z.number().optional(),
    userDataDir: z.string().optional(),
    timeout: z.number().optional(),
    captureNetwork: z.boolean().optional(),
    networkLogLimit: z.number().optional(),
    storageStatePath: z.string().optional(),
    // Profile to load and save back on close
    profile: z.string().optional(),
    // If true, don't save profile on close (read-only)
    noSave: z.boolean().optional(),
  })
  .optional();

const requestSchema = z.discriminatedUnion("type", [
  // Session management
  z.object({
    type: z.literal("create"),
    id: z.string(),
    sessionId: z.literal("default").optional(), // Only "default" is allowed as explicit ID
    options: browserOptionsSchema,
  }),
  z.object({
    type: z.literal("list"),
    id: z.string(),
  }),
  z.object({
    type: z.literal("close"),
    id: z.string(),
    sessionId: z.string(),
  }),
  // Session operations (require sessionId, default to "default")
  z.object({
    type: z.literal("command"),
    id: z.string(),
    sessionId: z.string().optional(),
    command: commandSchema,
  }),
  z.object({
    type: z.literal("act"),
    id: z.string(),
    sessionId: z.string().optional(),
    actions: z.array(stepActionSchema),
    haltOnError: z.boolean().optional(),
    includeState: z.boolean().optional(),
    includeStateText: z.boolean().optional(),
    stateOptions: getStateOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal("wait"),
    id: z.string(),
    sessionId: z.string().optional(),
    condition: waitConditionSchema,
    timeoutMs: z.number().optional(),
    includeState: z.boolean().optional(),
    includeStateText: z.boolean().optional(),
    stateOptions: getStateOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal("state"),
    id: z.string(),
    sessionId: z.string().optional(),
    options: getStateOptionsSchema.optional(),
    format: z.enum(["json", "text"]).optional(),
  }),
  z.object({
    type: z.literal("ping"),
    id: z.string(),
  }),
  z.object({
    type: z.literal("shutdown"),
    id: z.string(),
  }),
]);

type DaemonRequest = z.infer<typeof requestSchema>;

interface DaemonResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================================================
// Session Types
// ============================================================================

type DaemonSession = {
  id: string;
  browser: ReturnType<typeof createBrowser>;
  lastUsed: number;
  busy: boolean;
  options: AgentBrowserOptions;
  // Profile name to save back on close (if set)
  profile?: string;
  // If true, don't save profile on close
  noSave?: boolean;
};

// ============================================================================
// Path Utilities
// ============================================================================

const DAEMON_DIR = path.join(os.tmpdir(), "agent-browser");

function ensureDaemonDir(): void {
  if (!fs.existsSync(DAEMON_DIR)) {
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
  }
}

// Unified daemon paths (single socket for all sessions)
export function getSocketPath(): string {
  return path.join(DAEMON_DIR, "daemon.sock");
}

export function getPidPath(): string {
  return path.join(DAEMON_DIR, "daemon.pid");
}

export function getConfigPath(): string {
  return path.join(DAEMON_DIR, "daemon.config.json");
}

export function getVersionPath(): string {
  return path.join(DAEMON_DIR, "daemon.version");
}

/**
 * Get the version of the currently running daemon (if any)
 */
export function getDaemonVersion(): string | null {
  const versionPath = getVersionPath();
  if (!fs.existsSync(versionPath)) {
    return null;
  }
  try {
    return fs.readFileSync(versionPath, "utf-8").trim();
  } catch {
    return null;
  }
}

// ============================================================================
// Daemon Status
// ============================================================================

export function isDaemonRunning(): boolean {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) {
    return false;
  }

  try {
    const pid = Number.parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);
    // Check if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    // Process doesn't exist, clean up stale files
    cleanupDaemonFiles();
    return false;
  }
}

export function cleanupDaemonFiles(): void {
  const socketPath = getSocketPath();
  const pidPath = getPidPath();
  const configPath = getConfigPath();
  const versionPath = getVersionPath();

  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch {}
  try {
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  } catch {}
  try {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } catch {}
  try {
    if (fs.existsSync(versionPath)) fs.unlinkSync(versionPath);
  } catch {}
}

// ============================================================================
// Daemon Server
// ============================================================================

export interface DaemonOptions {
  defaultBrowserOptions?: AgentBrowserOptions;
  sessionTtlMs?: number;
}

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function startDaemon(options: DaemonOptions = {}): Promise<void> {
  const socketPath = getSocketPath();
  const pidPath = getPidPath();
  const configPath = getConfigPath();
  const versionPath = getVersionPath();

  ensureDaemonDir();
  cleanupDaemonFiles();

  // Write version file so CLI can detect version mismatch
  fs.writeFileSync(versionPath, VERSION);

  // Multi-session state
  const sessions = new Map<string, DaemonSession>();
  const idGenerator = createIdGenerator();
  const defaultOptions = options.defaultBrowserOptions ?? {};
  const sessionTtl = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;

  let shuttingDown = false;
  // biome-ignore lint/style/useConst: assigned separately for hoisting in shutdown()
  let server: net.Server;
  // biome-ignore lint/style/useConst: assigned separately for cleanup
  let cleanupTimer: ReturnType<typeof setInterval>;

  // Session helpers
  async function createSession(
    sessionId?: string,
    browserOptions?: AgentBrowserOptions & {
      profile?: string;
      noSave?: boolean;
    },
  ): Promise<DaemonSession> {
    const id = sessionId ?? idGenerator.next();
    if (sessions.has(id)) {
      throw new Error(`Session already exists: ${id}`);
    }
    const { profile, noSave, ...restOptions } = browserOptions ?? {};
    const mergedOptions = { ...defaultOptions, ...restOptions };
    const browser = createBrowser(mergedOptions);
    await browser.start();
    const session: DaemonSession = {
      id,
      browser,
      lastUsed: Date.now(),
      busy: false,
      options: mergedOptions,
      profile,
      noSave,
    };
    sessions.set(id, session);
    return session;
  }

  function getOrDefaultSession(sessionId?: string): DaemonSession {
    const id = sessionId ?? "default";
    const session = sessions.get(id);
    if (!session) {
      throw new Error(
        `Session not found: ${id}. Use 'open' command to create a session first.`,
      );
    }
    return session;
  }

  async function closeSession(
    sessionId: string,
  ): Promise<{ profileSaved?: string }> {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let profileSaved: string | undefined;

    // Save profile if one was loaded and noSave is not set
    if (session.profile && !session.noSave) {
      try {
        const storageState =
          (await session.browser.saveStorageState()) as StorageState;
        saveProfile(session.profile, storageState);
        profileSaved = session.profile;
      } catch (err) {
        // Log but don't fail the close
        console.error(`Failed to save profile ${session.profile}:`, err);
      }
    }

    await session.browser.stop();
    sessions.delete(sessionId);
    idGenerator.release(sessionId);

    return { profileSaved };
  }

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(cleanupTimer);
    server.close();
    // Close all sessions
    for (const session of sessions.values()) {
      try {
        await session.browser.stop();
      } catch {}
    }
    sessions.clear();
    cleanupDaemonFiles();
    process.kill(process.pid, "SIGKILL");
  };

  // Session TTL cleanup
  cleanupTimer = setInterval(
    async () => {
      if (sessionTtl <= 0) return;
      const now = Date.now();
      for (const [id, session] of sessions) {
        if (now - session.lastUsed > sessionTtl && !session.busy) {
          try {
            await session.browser.stop();
          } catch {}
          sessions.delete(id);
          idGenerator.release(id);
        }
      }
    },
    Math.max(10_000, Math.floor(sessionTtl / 2)),
  );

  server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString();

      // Process complete lines (newline-delimited JSON)
      while (buffer.includes("\n")) {
        const newlineIdx = buffer.indexOf("\n");
        const line = buffer.substring(0, newlineIdx);
        buffer = buffer.substring(newlineIdx + 1);

        if (!line.trim()) continue;

        let response: DaemonResponse;

        try {
          const json = JSON.parse(line);
          const parseResult = requestSchema.safeParse(json);

          if (!parseResult.success) {
            response = {
              id: json.id ?? "unknown",
              success: false,
              error: `Invalid request: ${parseResult.error.message}`,
            };
          } else {
            response = await handleRequest(
              parseResult.data,
              sessions,
              createSession,
              getOrDefaultSession,
              closeSession,
            );

            // Handle shutdown
            if (parseResult.data.type === "shutdown") {
              socket.write(`${JSON.stringify(response)}\n`);
              shutdown();
              return;
            }
          }
        } catch (err) {
          response = {
            id: "error",
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        socket.write(`${JSON.stringify(response)}\n`);
      }
    });

    socket.on("error", () => {
      // Client disconnected, ignore
    });
  });

  // Write PID and config
  fs.writeFileSync(pidPath, process.pid.toString());
  fs.writeFileSync(configPath, JSON.stringify(options));

  // Start listening
  server.listen(socketPath, () => {
    // Ready
  });

  server.on("error", (err) => {
    console.error("Daemon server error:", err);
    cleanupDaemonFiles();
    process.exit(1);
  });

  // Handle shutdown signals
  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
  process.on("SIGHUP", () => shutdown());

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    cleanupDaemonFiles();
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    cleanupDaemonFiles();
    process.exit(1);
  });

  process.on("exit", () => {
    cleanupDaemonFiles();
  });

  // Keep alive
  process.stdin.resume();
}

async function handleRequest(
  request: DaemonRequest,
  sessions: Map<string, DaemonSession>,
  createSession: (
    sessionId?: string,
    options?: AgentBrowserOptions & { profile?: string; noSave?: boolean },
  ) => Promise<DaemonSession>,
  getOrDefaultSession: (sessionId?: string) => DaemonSession,
  closeSession: (sessionId: string) => Promise<{ profileSaved?: string }>,
): Promise<DaemonResponse> {
  const { id } = request;

  try {
    switch (request.type) {
      case "ping": {
        return { id, success: true, data: { status: "ok" } };
      }

      case "shutdown": {
        return { id, success: true, data: { status: "shutting_down" } };
      }

      case "create": {
        const session = await createSession(request.sessionId, request.options);
        return {
          id,
          success: true,
          data: { sessionId: session.id },
        };
      }

      case "list": {
        const sessionList = Array.from(sessions.values()).map((s) => {
          const state = s.browser.getLastState();
          return {
            id: s.id,
            url: state?.url ?? "about:blank",
            title: state?.title ?? "",
            busy: s.busy,
            lastUsed: s.lastUsed,
          };
        });
        return { id, success: true, data: { sessions: sessionList } };
      }

      case "close": {
        const { profileSaved } = await closeSession(request.sessionId);
        return {
          id,
          success: true,
          data: { closed: request.sessionId, profileSaved },
        };
      }

      case "command": {
        const session = getOrDefaultSession(request.sessionId);
        session.busy = true;
        session.lastUsed = Date.now();
        try {
          const result = await executeCommand(session.browser, request.command);
          // Handle close command - close the session
          if (request.command.type === "close") {
            const { profileSaved } = await closeSession(session.id);
            return {
              id,
              success: true,
              data: { ...((result as object) ?? {}), profileSaved },
            };
          }
          return { id, success: true, data: result };
        } finally {
          if (sessions.has(session.id)) {
            session.busy = false;
            session.lastUsed = Date.now();
          }
        }
      }

      case "act": {
        const session = getOrDefaultSession(request.sessionId);
        session.busy = true;
        session.lastUsed = Date.now();
        try {
          const results = await executeActions(
            session.browser,
            request.actions,
            {
              haltOnError: request.haltOnError ?? true,
            },
          );

          let state: unknown;
          let stateText: string | undefined;

          if (request.includeState || request.includeStateText !== false) {
            const currentState = await session.browser.getState(
              request.stateOptions,
            );
            if (request.includeState) {
              state = currentState;
            }
            if (request.includeStateText !== false) {
              stateText = formatStateText(currentState);
            }
          }

          const hasError = results.some((r) => r.error != null);

          return {
            id,
            success: true,
            data: {
              results,
              state,
              stateText,
              text: formatStepText({ results, stateText }),
              error: hasError ? "One or more actions failed" : undefined,
            },
          };
        } finally {
          session.busy = false;
          session.lastUsed = Date.now();
        }
      }

      case "wait": {
        const session = getOrDefaultSession(request.sessionId);
        session.busy = true;
        session.lastUsed = Date.now();
        try {
          await executeWait(session.browser, request.condition, {
            timeoutMs: request.timeoutMs,
          });

          let state: unknown;
          let stateText: string | undefined;

          if (request.includeState || request.includeStateText !== false) {
            const currentState = await session.browser.getState(
              request.stateOptions,
            );
            if (request.includeState) {
              state = currentState;
            }
            if (request.includeStateText !== false) {
              stateText = formatStateText(currentState);
            }
          }

          return {
            id,
            success: true,
            data: {
              state,
              stateText,
              text: formatWaitText({ condition: request.condition, stateText }),
            },
          };
        } finally {
          session.busy = false;
          session.lastUsed = Date.now();
        }
      }

      case "state": {
        const session = getOrDefaultSession(request.sessionId);
        session.busy = true;
        session.lastUsed = Date.now();
        try {
          const currentState = await session.browser.getState(request.options);
          const format = request.format ?? "text";

          if (format === "text") {
            return {
              id,
              success: true,
              data: { text: formatStateText(currentState) },
            };
          }

          return { id, success: true, data: { state: currentState } };
        } finally {
          session.busy = false;
          session.lastUsed = Date.now();
        }
      }
    }
  } catch (err) {
    return {
      id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================================
// Daemon Client
// ============================================================================

export class DaemonClient {
  private socketPath: string;
  private sessionId?: string;

  constructor(sessionId?: string) {
    this.socketPath = getSocketPath();
    this.sessionId = sessionId;
  }

  private async send(request: DaemonRequest): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let buffer = "";

      socket.on("connect", () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });

      socket.on("data", (data) => {
        buffer += data.toString();
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx !== -1) {
          const line = buffer.substring(0, newlineIdx);
          socket.end();
          try {
            resolve(JSON.parse(line));
          } catch {
            reject(new Error(`Invalid response: ${line}`));
          }
        }
      });

      socket.on("error", (err) => {
        reject(err);
      });

      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      });

      socket.setTimeout(60000);
    });
  }

  /** Set the session ID for subsequent requests */
  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /** Get the current session ID */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  async ping(): Promise<boolean> {
    try {
      const response = await this.send({ type: "ping", id: "ping" });
      return response.success;
    } catch {
      return false;
    }
  }

  /** Create a new session, returns the session ID */
  async create(options?: {
    sessionId?: "default"; // Only "default" is allowed as explicit ID
    browserOptions?: AgentBrowserOptions;
  }): Promise<DaemonResponse> {
    return this.send({
      type: "create",
      id: `create-${Date.now()}`,
      sessionId: options?.sessionId,
      options: options?.browserOptions,
    });
  }

  /** List all sessions */
  async list(): Promise<DaemonResponse> {
    return this.send({
      type: "list",
      id: `list-${Date.now()}`,
    });
  }

  /** Close a specific session */
  async closeSession(sessionId: string): Promise<DaemonResponse> {
    return this.send({
      type: "close",
      id: `close-${Date.now()}`,
      sessionId,
    });
  }

  async command(command: Command, sessionId?: string): Promise<DaemonResponse> {
    return this.send({
      type: "command",
      id: `cmd-${Date.now()}`,
      sessionId: sessionId ?? this.sessionId,
      command,
    });
  }

  async act(
    actions: StepAction[],
    options: {
      sessionId?: string;
      haltOnError?: boolean;
      includeState?: boolean;
      includeStateText?: boolean;
      stateOptions?: z.infer<typeof getStateOptionsSchema>;
    } = {},
  ): Promise<DaemonResponse> {
    const { sessionId, ...rest } = options;
    return this.send({
      type: "act",
      id: `act-${Date.now()}`,
      sessionId: sessionId ?? this.sessionId,
      actions,
      ...rest,
    });
  }

  async wait(
    condition: WaitCondition,
    options: {
      sessionId?: string;
      timeoutMs?: number;
      includeState?: boolean;
      includeStateText?: boolean;
      stateOptions?: z.infer<typeof getStateOptionsSchema>;
    } = {},
  ): Promise<DaemonResponse> {
    const { sessionId, ...rest } = options;
    return this.send({
      type: "wait",
      id: `wait-${Date.now()}`,
      sessionId: sessionId ?? this.sessionId,
      condition,
      ...rest,
    });
  }

  async state(
    options: {
      sessionId?: string;
      format?: "json" | "text";
      stateOptions?: z.infer<typeof getStateOptionsSchema>;
    } = {},
  ): Promise<DaemonResponse> {
    return this.send({
      type: "state",
      id: `state-${Date.now()}`,
      sessionId: options.sessionId ?? this.sessionId,
      options: options.stateOptions,
      format: options.format,
    });
  }

  async shutdown(): Promise<DaemonResponse> {
    return this.send({ type: "shutdown", id: "shutdown" });
  }

  async screenshot(options?: {
    sessionId?: string;
    fullPage?: boolean;
    path?: string;
  }): Promise<DaemonResponse> {
    return this.send({
      type: "command",
      id: `screenshot-${Date.now()}`,
      sessionId: options?.sessionId ?? this.sessionId,
      command: {
        type: "screenshot",
        fullPage: options?.fullPage,
        path: options?.path,
      },
    });
  }
}

// ============================================================================
// Daemon Spawner
// ============================================================================

/**
 * Force restart the daemon by shutting down any existing one
 */
async function forceRestartDaemon(
  browserOptions?: AgentBrowserOptions,
): Promise<void> {
  const client = new DaemonClient();

  // Try to gracefully shutdown existing daemon
  if (isDaemonRunning()) {
    try {
      if (await client.ping()) {
        await client.shutdown();
        // Wait a bit for shutdown
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch {
      // Ignore errors during shutdown
    }
  }

  // Clean up any stale files
  cleanupDaemonFiles();

  // Spawn fresh daemon
  await spawnDaemon(browserOptions);
}

/**
 * Ensure daemon is running and return a client.
 * If sessionId is provided, set the client to use that session.
 * If createIfMissing is true (default), create the "default" session if it doesn't exist.
 */
export async function ensureDaemon(
  sessionId = "default",
  browserOptions?: AgentBrowserOptions,
  options?: { createIfMissing?: boolean },
): Promise<DaemonClient> {
  const client = new DaemonClient(sessionId);
  const createIfMissing = options?.createIfMissing ?? true;

  // Check if daemon is already running
  if (isDaemonRunning()) {
    // Check for version mismatch - force restart if versions don't match
    const daemonVersion = getDaemonVersion();
    if (daemonVersion && daemonVersion !== VERSION) {
      // If we're not allowed to create sessions, tell user to re-open
      if (!createIfMissing) {
        throw new Error(
          `Daemon was upgraded (${daemonVersion} -> ${VERSION}). Please run 'agent-browser open <url>' to start a new session.`,
        );
      }

      console.log(
        `Daemon version mismatch (daemon: ${daemonVersion}, cli: ${VERSION}), restarting...`,
      );
      await forceRestartDaemon(browserOptions);

      // Wait for new daemon to be ready
      const maxAttempts = 50;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await client.ping()) {
          if (sessionId === "default") {
            const createResp = await client.create({
              sessionId: "default",
              browserOptions,
            });
            if (!createResp.success) {
              throw new Error(`Failed to create session: ${createResp.error}`);
            }
          }
          return client;
        }
      }
      throw new Error("Failed to restart daemon after version mismatch");
    }

    // Verify it's responsive
    if (await client.ping()) {
      // Daemon is running, check if session exists or create default
      if (createIfMissing && sessionId === "default") {
        const listResp = await client.list();
        if (listResp.success) {
          const sessions = (
            listResp.data as { sessions: Array<{ id: string }> }
          ).sessions;
          const exists = sessions.some((s) => s.id === sessionId);
          if (!exists) {
            // Create the default session
            const createResp = await client.create({
              sessionId: "default",
              browserOptions,
            });
            if (!createResp.success) {
              throw new Error(`Failed to create session: ${createResp.error}`);
            }
          }
        }
      }
      return client;
    }
    // Not responsive, clean up
    cleanupDaemonFiles();
  }

  // Spawn new daemon
  await spawnDaemon(browserOptions);

  // Wait for daemon to be ready
  const maxAttempts = 50; // 5 seconds
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await client.ping()) {
      // Create the initial default session
      if (createIfMissing && sessionId === "default") {
        const createResp = await client.create({
          sessionId: "default",
          browserOptions,
        });
        if (!createResp.success) {
          throw new Error(`Failed to create session: ${createResp.error}`);
        }
      }
      return client;
    }
  }

  throw new Error("Failed to start daemon");
}

/**
 * Ensure daemon is running and create a NEW session with auto-generated ID.
 * Returns the client with the new session ID set.
 */
export async function ensureDaemonNewSession(
  browserOptions?: AgentBrowserOptions,
): Promise<DaemonClient> {
  const client = new DaemonClient();

  // Check if daemon is already running
  if (isDaemonRunning()) {
    // Check for version mismatch - force restart if versions don't match
    const daemonVersion = getDaemonVersion();
    if (daemonVersion && daemonVersion !== VERSION) {
      console.log(
        `Daemon version mismatch (daemon: ${daemonVersion}, cli: ${VERSION}), restarting...`,
      );
      await forceRestartDaemon(browserOptions);

      // Wait for new daemon to be ready and create session
      const maxAttempts = 50;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await client.ping()) {
          const createResp = await client.create({ browserOptions });
          if (!createResp.success) {
            throw new Error(`Failed to create session: ${createResp.error}`);
          }
          const newSessionId = (createResp.data as { sessionId: string })
            .sessionId;
          client.setSession(newSessionId);
          return client;
        }
      }
      throw new Error("Failed to restart daemon after version mismatch");
    }

    if (await client.ping()) {
      // Create new session with auto-generated ID
      const createResp = await client.create({ browserOptions });
      if (!createResp.success) {
        throw new Error(`Failed to create session: ${createResp.error}`);
      }
      const newSessionId = (createResp.data as { sessionId: string }).sessionId;
      client.setSession(newSessionId);
      return client;
    }
    cleanupDaemonFiles();
  }

  // Spawn new daemon
  await spawnDaemon(browserOptions);

  // Wait for daemon to be ready
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await client.ping()) {
      // Create new session with auto-generated ID
      const createResp = await client.create({ browserOptions });
      if (!createResp.success) {
        throw new Error(`Failed to create session: ${createResp.error}`);
      }
      const newSessionId = (createResp.data as { sessionId: string }).sessionId;
      client.setSession(newSessionId);
      return client;
    }
  }

  throw new Error("Failed to start daemon");
}

async function spawnDaemon(
  defaultBrowserOptions?: AgentBrowserOptions,
): Promise<void> {
  const configPath = getConfigPath();
  ensureDaemonDir();

  // Write config for daemon to read
  fs.writeFileSync(
    configPath,
    JSON.stringify({ defaultBrowserOptions: defaultBrowserOptions ?? {} }),
  );

  // Spawn detached process
  const { spawn } = await import("node:child_process");

  const child = spawn(
    process.execPath,
    ["--bun", `${import.meta.dirname}/daemon-entry.ts`, "--config", configPath],
    {
      detached: true,
      stdio: "ignore",
    },
  );

  child.unref();
}

// ============================================================================
// Entry Point (for daemon process)
// ============================================================================

if (
  process.argv[1]?.endsWith("daemon.ts") ||
  process.argv[1]?.endsWith("daemon-entry.ts") ||
  process.env.AGENT_BROWSER_DAEMON === "1"
) {
  // Parse args
  const args = process.argv.slice(2);
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    }
  }

  let daemonOptions: DaemonOptions = {};
  if (configPath && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      daemonOptions = {
        defaultBrowserOptions: config.defaultBrowserOptions ?? {},
        sessionTtlMs: config.sessionTtlMs,
      };
    } catch {}
  }

  startDaemon(daemonOptions).catch((err) => {
    console.error("Failed to start daemon:", err);
    process.exit(1);
  });
}
