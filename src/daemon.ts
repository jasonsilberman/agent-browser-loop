import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
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
import { formatStateText } from "./state";

// ============================================================================
// Daemon Protocol
// ============================================================================

const requestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    id: z.string(),
    command: commandSchema,
  }),
  z.object({
    type: z.literal("act"),
    id: z.string(),
    actions: z.array(stepActionSchema),
    haltOnError: z.boolean().optional(),
    includeState: z.boolean().optional(),
    includeStateText: z.boolean().optional(),
    stateOptions: getStateOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal("wait"),
    id: z.string(),
    condition: waitConditionSchema,
    timeoutMs: z.number().optional(),
    includeState: z.boolean().optional(),
    includeStateText: z.boolean().optional(),
    stateOptions: getStateOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal("state"),
    id: z.string(),
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
// Path Utilities
// ============================================================================

const DAEMON_DIR = path.join(os.tmpdir(), "agent-browser");

function ensureDaemonDir(): void {
  if (!fs.existsSync(DAEMON_DIR)) {
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
  }
}

export function getSocketPath(session = "default"): string {
  return path.join(DAEMON_DIR, `${session}.sock`);
}

export function getPidPath(session = "default"): string {
  return path.join(DAEMON_DIR, `${session}.pid`);
}

export function getConfigPath(session = "default"): string {
  return path.join(DAEMON_DIR, `${session}.config.json`);
}

// ============================================================================
// Daemon Status
// ============================================================================

export function isDaemonRunning(session = "default"): boolean {
  const pidPath = getPidPath(session);
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
    cleanupDaemonFiles(session);
    return false;
  }
}

export function cleanupDaemonFiles(session = "default"): void {
  const socketPath = getSocketPath(session);
  const pidPath = getPidPath(session);
  const configPath = getConfigPath(session);

  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch {}
  try {
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  } catch {}
  try {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } catch {}
}

// ============================================================================
// Daemon Server
// ============================================================================

export interface DaemonOptions {
  session?: string;
  browserOptions?: AgentBrowserOptions;
}

export async function startDaemon(options: DaemonOptions = {}): Promise<void> {
  const session = options.session ?? "default";
  const socketPath = getSocketPath(session);
  const pidPath = getPidPath(session);
  const configPath = getConfigPath(session);

  ensureDaemonDir();
  cleanupDaemonFiles(session);

  // Create and start browser
  const browser = createBrowser(options.browserOptions);
  await browser.start();

  let shuttingDown = false;
  // biome-ignore lint/style/useConst: assigned separately for hoisting in shutdown()
  let server: net.Server;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    cleanupDaemonFiles(session);
    browser.stop().finally(() => {
      process.kill(process.pid, "SIGKILL");
    });
    // Failsafe: force kill after 2 seconds
    setTimeout(() => {
      process.kill(process.pid, "SIGKILL");
    }, 2000);
  };

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
            response = await handleRequest(browser, parseResult.data);

            // Handle shutdown
            if (parseResult.data.type === "shutdown") {
              socket.write(JSON.stringify(response) + "\n");
              shutdown();
              return;
            }

            // Handle close command - shutdown daemon
            if (
              parseResult.data.type === "command" &&
              parseResult.data.command.type === "close"
            ) {
              socket.write(JSON.stringify(response) + "\n");
              if (!shuttingDown) {
                shuttingDown = true;
                setTimeout(() => shutdown(), 100);
              }
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

        socket.write(JSON.stringify(response) + "\n");
      }
    });

    socket.on("error", () => {
      // Client disconnected, ignore
    });
  });

  // Write PID and config
  fs.writeFileSync(pidPath, process.pid.toString());
  fs.writeFileSync(configPath, JSON.stringify(options.browserOptions ?? {}));

  // Start listening
  server.listen(socketPath, () => {
    // Ready
  });

  server.on("error", (err) => {
    console.error("Daemon server error:", err);
    cleanupDaemonFiles(session);
    process.exit(1);
  });

  // Handle shutdown signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    cleanupDaemonFiles(session);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    cleanupDaemonFiles(session);
    process.exit(1);
  });

  process.on("exit", () => {
    cleanupDaemonFiles(session);
  });

  // Keep alive
  process.stdin.resume();
}

async function handleRequest(
  browser: ReturnType<typeof createBrowser>,
  request: DaemonRequest,
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

      case "command": {
        const result = await executeCommand(browser, request.command);
        return { id, success: true, data: result };
      }

      case "act": {
        const results = await executeActions(browser, request.actions, {
          haltOnError: request.haltOnError ?? true,
        });

        let state: unknown;
        let stateText: string | undefined;

        if (request.includeState || request.includeStateText !== false) {
          const currentState = await browser.getState(request.stateOptions);
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
      }

      case "wait": {
        await executeWait(browser, request.condition, {
          timeoutMs: request.timeoutMs,
        });

        let state: unknown;
        let stateText: string | undefined;

        if (request.includeState || request.includeStateText !== false) {
          const currentState = await browser.getState(request.stateOptions);
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
      }

      case "state": {
        const currentState = await browser.getState(request.options);
        const format = request.format ?? "text";

        if (format === "text") {
          return {
            id,
            success: true,
            data: { text: formatStateText(currentState) },
          };
        }

        return { id, success: true, data: { state: currentState } };
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

  constructor(session = "default") {
    this.socketPath = getSocketPath(session);
  }

  private async send(request: DaemonRequest): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let buffer = "";

      socket.on("connect", () => {
        socket.write(JSON.stringify(request) + "\n");
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

  async ping(): Promise<boolean> {
    try {
      const response = await this.send({ type: "ping", id: "ping" });
      return response.success;
    } catch {
      return false;
    }
  }

  async command(command: Command): Promise<DaemonResponse> {
    return this.send({
      type: "command",
      id: `cmd-${Date.now()}`,
      command,
    });
  }

  async act(
    actions: StepAction[],
    options: {
      haltOnError?: boolean;
      includeState?: boolean;
      includeStateText?: boolean;
      stateOptions?: z.infer<typeof getStateOptionsSchema>;
    } = {},
  ): Promise<DaemonResponse> {
    return this.send({
      type: "act",
      id: `act-${Date.now()}`,
      actions,
      ...options,
    });
  }

  async wait(
    condition: WaitCondition,
    options: {
      timeoutMs?: number;
      includeState?: boolean;
      includeStateText?: boolean;
      stateOptions?: z.infer<typeof getStateOptionsSchema>;
    } = {},
  ): Promise<DaemonResponse> {
    return this.send({
      type: "wait",
      id: `wait-${Date.now()}`,
      condition,
      ...options,
    });
  }

  async state(
    options: {
      format?: "json" | "text";
      stateOptions?: z.infer<typeof getStateOptionsSchema>;
    } = {},
  ): Promise<DaemonResponse> {
    return this.send({
      type: "state",
      id: `state-${Date.now()}`,
      options: options.stateOptions,
      format: options.format,
    });
  }

  async shutdown(): Promise<DaemonResponse> {
    return this.send({ type: "shutdown", id: "shutdown" });
  }

  async screenshot(options?: {
    fullPage?: boolean;
    path?: string;
  }): Promise<DaemonResponse> {
    return this.send({
      type: "command",
      id: `screenshot-${Date.now()}`,
      command: { type: "screenshot", ...options },
    });
  }
}

// ============================================================================
// Daemon Spawner
// ============================================================================

export async function ensureDaemon(
  session = "default",
  browserOptions?: AgentBrowserOptions,
): Promise<DaemonClient> {
  const client = new DaemonClient(session);

  // Check if already running
  if (isDaemonRunning(session)) {
    // Verify it's responsive
    if (await client.ping()) {
      return client;
    }
    // Not responsive, clean up
    cleanupDaemonFiles(session);
  }

  // Spawn new daemon
  await spawnDaemon(session, browserOptions);

  // Wait for daemon to be ready
  const maxAttempts = 50; // 5 seconds
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await client.ping()) {
      return client;
    }
  }

  throw new Error("Failed to start daemon");
}

async function spawnDaemon(
  session: string,
  browserOptions?: AgentBrowserOptions,
): Promise<void> {
  const configPath = getConfigPath(session);
  ensureDaemonDir();

  // Write config for daemon to read
  fs.writeFileSync(
    configPath,
    JSON.stringify({ session, browserOptions: browserOptions ?? {} }),
  );

  // Spawn detached process
  const { spawn } = await import("node:child_process");

  const child = spawn(
    process.execPath,
    [
      "--bun",
      import.meta.dirname + "/daemon-entry.ts",
      "--session",
      session,
      "--config",
      configPath,
    ],
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
  let session = "default";
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      session = args[i + 1];
      i++;
    } else if (args[i] === "--config" && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    }
  }

  let browserOptions: AgentBrowserOptions = {};
  if (configPath && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      browserOptions = config.browserOptions ?? {};
      session = config.session ?? session;
    } catch {}
  }

  startDaemon({ session, browserOptions }).catch((err) => {
    console.error("Failed to start daemon:", err);
    process.exit(1);
  });
}
