#!/usr/bin/env bun
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  command,
  flag,
  number,
  option,
  optional,
  positional,
  restPositionals,
  run,
  string,
  subcommands,
} from "cmd-ts";
import { VERSION } from "./version";
import type { AgentBrowserOptions } from "./browser";
import type { StepAction } from "./commands";
import { parseBrowserConfig } from "./config";
import {
  cleanupDaemonFiles,
  DaemonClient,
  ensureDaemon,
  ensureDaemonNewSession,
  isDaemonRunning,
} from "./daemon";
import { log, withLog } from "./log";
import {
  deleteProfile,
  importProfile,
  listProfiles,
  loadProfile,
  resolveProfilePath,
  resolveStorageStateOption,
  saveProfile,
} from "./profiles";
import { startBrowserServer } from "./server";
import type { BrowserCliConfig, StorageState } from "./types";

// ============================================================================
// Config Loading
// ============================================================================

const CONFIG_CANDIDATES = [
  "agent.browser.config.ts",
  "agent.browser.config.js",
  "agent.browser.config.mjs",
  "agent.browser.config.cjs",
  "agent.browser.config.json",
];

async function findConfigPath(explicitPath?: string): Promise<string | null> {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!(await Bun.file(resolved).exists())) {
      throw new Error(`Config not found: ${resolved}`);
    }
    return resolved;
  }

  for (const candidate of CONFIG_CANDIDATES) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (await Bun.file(resolved).exists()) {
      return resolved;
    }
  }

  return null;
}

async function loadConfig(configPath: string): Promise<BrowserCliConfig> {
  const ext = path.extname(configPath).toLowerCase();
  if (ext === ".json") {
    const text = await Bun.file(configPath).text();
    return parseBrowserConfig(JSON.parse(text));
  }

  const mod = await import(pathToFileURL(configPath).toString());
  const exported = mod?.default ?? mod?.config ?? mod ?? null;

  if (typeof exported === "function") {
    const resolved = await exported();
    return parseBrowserConfig(resolved);
  }

  if (!exported || typeof exported !== "object") {
    throw new Error(`Config ${configPath} did not export a config object`);
  }

  return parseBrowserConfig(exported);
}

// ============================================================================
// Shared CLI Options
// ============================================================================
// Shared CLI Options
// ============================================================================

const newSessionFlag = flag({
  long: "new",
  short: "n",
  description: "Create a new session with auto-generated ID",
});

const sessionOption = option({
  long: "session",
  short: "s",
  type: optional(string),
  description: "Session ID (from --new)",
});

const headlessFlag = flag({
  long: "headless",
  description: "Run browser in headless mode",
});

const headedFlag = flag({
  long: "headed",
  description: "Run browser in headed mode",
});

const configOption = option({
  long: "config",
  short: "c",
  type: optional(string),
  description: "Path to config file",
});

const jsonFlag = flag({
  long: "json",
  description: "Output as JSON instead of text",
});

const profileOption = option({
  long: "profile",
  short: "p",
  type: optional(string),
  description:
    "Load profile and save back on close (use --no-save for read-only)",
});

const noSaveFlag = flag({
  long: "no-save",
  description: "Don't save profile changes on close (read-only)",
});

const globalFlag = flag({
  long: "global",
  description: "Save to user-level global profiles (~/.config/agent-browser/)",
});

const privateFlag = flag({
  long: "private",
  description: "Save to project .private/ (gitignored, for secrets)",
});

const widthOption = option({
  long: "width",
  short: "W",
  type: optional(number),
  description: "Viewport width in pixels (default: 1280)",
});

const heightOption = option({
  long: "height",
  short: "H",
  type: optional(number),
  description: "Viewport height in pixels (default: 720)",
});

// ============================================================================
// Browser Options Resolution
// ============================================================================

type SessionBrowserOptions = AgentBrowserOptions & {
  profile?: string;
  noSave?: boolean;
};

async function resolveBrowserOptions(args: {
  configPath?: string;
  headless?: boolean;
  headed?: boolean;
  bundled?: boolean;
  profile?: string;
  noSave?: boolean;
  width?: number;
  height?: number;
}): Promise<SessionBrowserOptions> {
  const configPath = await findConfigPath(args.configPath);
  const config = configPath ? await loadConfig(configPath) : undefined;

  let headless: boolean | undefined;
  if (args.headed) {
    headless = false;
  } else if (args.headless) {
    headless = true;
  } else {
    headless = config?.headless;
  }

  const useSystemChrome = args.bundled ? false : config?.useSystemChrome;

  // Resolve storage state from profile or config
  const storageState = resolveStorageStateOption(
    args.profile,
    config?.storageStatePath,
  );

  return {
    headless,
    executablePath: config?.executablePath,
    useSystemChrome,
    allowSystemChromeHeadless: config?.allowSystemChromeHeadless,
    viewportWidth: args.width ?? config?.viewportWidth,
    viewportHeight: args.height ?? config?.viewportHeight,
    userDataDir: config?.userDataDir,
    timeout: config?.timeout,
    captureNetwork: config?.captureNetwork,
    networkLogLimit: config?.networkLogLimit,
    // Use resolved storage state (object or path)
    storageState: typeof storageState === "object" ? storageState : undefined,
    storageStatePath:
      typeof storageState === "string" ? storageState : undefined,
    // Track profile for save-on-close
    profile: args.profile,
    noSave: args.noSave,
  };
}

// ============================================================================
// Action Parsing
// ============================================================================

/**
 * Parse action strings into StepAction objects
 * Formats:
 *   navigate:http://localhost:3000
 *   click:button_0
 *   type:input_0:hello world
 *   press:Enter
 *   scroll:down
 *   scroll:down:500
 *   resize:1920:1080
 */
function parseAction(actionStr: string): StepAction {
  const parts = actionStr.split(":");
  const type = parts[0];

  switch (type) {
    case "navigate":
      return { type: "navigate", url: parts.slice(1).join(":") };

    case "click":
      return { type: "click", ref: parts[1] };

    case "type": {
      const ref = parts[1];
      const text = parts.slice(2).join(":");
      return { type: "type", ref, text };
    }

    case "press":
      return { type: "press", key: parts[1] };

    case "scroll": {
      const direction = parts[1] as "up" | "down";
      const amount = parts[2] ? Number.parseInt(parts[2], 10) : undefined;
      return { type: "scroll", direction, amount };
    }

    case "hover":
      return { type: "hover", ref: parts[1] };

    case "select": {
      const ref = parts[1];
      const value = parts.slice(2).join(":");
      return { type: "select", ref, value };
    }

    case "resize": {
      const width = Number.parseInt(parts[1], 10);
      const height = Number.parseInt(parts[2], 10);
      if (Number.isNaN(width) || Number.isNaN(height)) {
        throw new Error("resize requires width:height (e.g. resize:1920:1080)");
      }
      return { type: "resize", width, height };
    }

    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

// ============================================================================
// Commands
// ============================================================================

// --- skill installation helper ---
async function installSkillFiles(targetDir: string): Promise<boolean> {
  const skillDir = path.join(targetDir, ".claude/skills/agent-browser-loop");

  // Find skills source directory
  let skillSourceDir: string | null = null;
  const candidates = [
    path.join(
      process.cwd(),
      "node_modules/agent-browser-loop/.claude/skills/agent-browser-loop",
    ),
    path.join(
      path.dirname(import.meta.path),
      "../.claude/skills/agent-browser-loop",
    ),
  ];

  for (const candidate of candidates) {
    if (await Bun.file(path.join(candidate, "SKILL.md")).exists()) {
      skillSourceDir = candidate;
      break;
    }
  }

  if (!skillSourceDir) {
    return false;
  }

  await Bun.$`mkdir -p ${skillDir}`;

  // Copy SKILL.md
  const skillContent = await Bun.file(
    path.join(skillSourceDir, "SKILL.md"),
  ).text();
  await Bun.write(path.join(skillDir, "SKILL.md"), skillContent);

  // Copy REFERENCE.md if it exists
  const refPath = path.join(skillSourceDir, "REFERENCE.md");
  if (await Bun.file(refPath).exists()) {
    const refContent = await Bun.file(refPath).text();
    await Bun.write(path.join(skillDir, "REFERENCE.md"), refContent);
  }

  return true;
}

// --- setup ---
const setupCommand = command({
  name: "setup",
  description: "Install Playwright browser and AI agent skill files",
  args: {
    skipSkill: flag({
      long: "skip-skill",
      description: "Skip installing skill files",
    }),
    target: option({
      long: "target",
      short: "t",
      type: optional(string),
      description: "Target directory for skill files (default: cwd)",
    }),
  },
  handler: async (args) => {
    // 1. Install Playwright browser
    console.log("Installing Playwright Chromium...");
    const { $ } = await import("bun");
    try {
      await $`bunx playwright install chromium`.text();
      console.log("Browser installed.");
    } catch (err) {
      console.error("Failed to install browser:", err);
      process.exit(1);
    }

    // 2. Install skill files (unless skipped)
    if (!args.skipSkill) {
      const targetDir = args.target ?? process.cwd();
      console.log("\nInstalling skill files...");
      const installed = await installSkillFiles(targetDir);
      if (installed) {
        console.log(
          `Skills installed to ${targetDir}/.claude/skills/agent-browser-loop/`,
        );
      } else {
        console.warn("Warning: Could not find skill files to install.");
      }
    }

    console.log("\nDone! Run 'agent-browser open <url>' to start.");
  },
});

// --- open ---
const openCommand = command({
  name: "open",
  description: "Open URL in browser (auto-starts daemon)",
  args: {
    url: positional({ type: string, displayName: "url" }),
    session: sessionOption,
    new: newSessionFlag,
    headless: headlessFlag,
    headed: headedFlag,
    config: configOption,
    json: jsonFlag,
    profile: profileOption,
    noSave: noSaveFlag,
    width: widthOption,
    height: heightOption,
  },
  handler: async (args) => {
    const browserOptions = await resolveBrowserOptions({
      ...args,
      configPath: args.config,
    });

    let client: DaemonClient;
    if (args.new) {
      client = await ensureDaemonNewSession(browserOptions);
    } else if (args.session) {
      client = await ensureDaemon(args.session, browserOptions, {
        createIfMissing: false,
      });
    } else {
      client = await ensureDaemon("default", browserOptions);
    }

    const response = await client.act([{ type: "navigate", url: args.url }]);

    if (!response.success) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    const data = response.data as { text?: string };
    const sessionId = client.getSessionId();

    if (args.json) {
      const jsonData =
        typeof response.data === "object" && response.data !== null
          ? { ...(response.data as object), sessionId, profile: args.profile }
          : { data: response.data, sessionId, profile: args.profile };
      console.log(JSON.stringify(jsonData, null, 2));
    } else {
      if (args.new && sessionId) {
        console.log(`Session: ${sessionId}`);
      }
      if (args.profile) {
        console.log(`Profile: ${args.profile}`);
      }
      console.log(data.text ?? "Navigated successfully");
    }
  },
});

// --- act ---
const actCommand = command({
  name: "act",
  description:
    "Execute actions: click:ref, type:ref:text, press:key, scroll:dir",
  args: {
    actions: restPositionals({ type: string, displayName: "actions" }),
    session: sessionOption,
    new: newSessionFlag,
    headless: headlessFlag,
    headed: headedFlag,
    config: configOption,
    json: jsonFlag,
    noState: flag({
      long: "no-state",
      description: "Don't return state after actions",
    }),
    profile: profileOption,
  },
  handler: async (args) => {
    if (args.actions.length === 0) {
      console.error("No actions provided");
      console.error(
        "Usage: agent-browser act click:button_0 type:input_0:hello",
      );
      process.exit(1);
    }

    const browserOptions = await resolveBrowserOptions({
      ...args,
      configPath: args.config,
    });

    let client: DaemonClient;
    if (args.new) {
      client = await ensureDaemonNewSession(browserOptions);
    } else if (args.session) {
      client = await ensureDaemon(args.session, browserOptions, {
        createIfMissing: false,
      });
    } else {
      client = await ensureDaemon("default", browserOptions);
    }

    const actions = args.actions.map(parseAction);
    const response = await client.act(actions, {
      includeStateText: !args.noState,
    });

    if (!response.success) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    const data = response.data as { text?: string; error?: string };
    if (args.json) {
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      if (args.new) {
        console.log(`Session: ${client.getSessionId()}`);
      }
      console.log(data.text ?? "Actions completed");
    }

    if (data.error) {
      process.exit(1);
    }
  },
});

// --- wait ---
const waitCommand = command({
  name: "wait",
  description: "Wait for --text, --selector, --url, or --not-* conditions",
  args: {
    session: sessionOption,
    selector: option({
      long: "selector",
      type: optional(string),
      description: "Wait for selector to be visible",
    }),
    text: option({
      long: "text",
      type: optional(string),
      description: "Wait for text to appear",
    }),
    url: option({
      long: "url",
      type: optional(string),
      description: "Wait for URL to match",
    }),
    notSelector: option({
      long: "not-selector",
      type: optional(string),
      description: "Wait for selector to disappear",
    }),
    notText: option({
      long: "not-text",
      type: optional(string),
      description: "Wait for text to disappear",
    }),
    timeout: option({
      long: "timeout",
      type: number,
      defaultValue: () => 30000,
      description: "Timeout in ms (default: 30000)",
    }),
    json: jsonFlag,
  },
  handler: async (args) => {
    const condition = {
      selector: args.selector,
      text: args.text,
      url: args.url,
      notSelector: args.notSelector,
      notText: args.notText,
    };

    if (
      !condition.selector &&
      !condition.text &&
      !condition.url &&
      !condition.notSelector &&
      !condition.notText
    ) {
      console.error("No wait condition provided");
      console.error(
        'Usage: agent-browser wait --text "Welcome" --timeout 5000',
      );
      process.exit(1);
    }

    const client = await ensureDaemon(args.session ?? "default", undefined, {
      createIfMissing: false,
    });

    const response = await client.wait(condition, { timeoutMs: args.timeout });

    if (!response.success) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    const data = response.data as { text?: string };
    if (args.json) {
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      console.log(data.text ?? "Wait completed");
    }
  },
});

// --- state ---
const stateCommand = command({
  name: "state",
  description: "Get current browser state",
  args: {
    session: sessionOption,
    json: jsonFlag,
  },
  handler: async (args) => {
    const client = await ensureDaemon(args.session ?? "default", undefined, {
      createIfMissing: false,
    });

    const response = await client.state({
      format: args.json ? "json" : "text",
    });

    if (!response.success) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    const data = response.data as { text?: string; state?: unknown };
    if (args.json) {
      console.log(JSON.stringify(data.state, null, 2));
    } else {
      console.log(data.text);
    }
  },
});

// --- screenshot ---
const screenshotCommand = command({
  name: "screenshot",
  description: "Take a screenshot (outputs base64 or saves to file)",
  args: {
    session: sessionOption,
    output: option({
      long: "output",
      short: "o",
      type: optional(string),
      description: "Save to file path instead of base64 output",
    }),
    fullPage: flag({
      long: "full-page",
      description: "Capture full scrollable page",
    }),
  },
  handler: async (args) => {
    const client = await ensureDaemon(args.session ?? "default", undefined, {
      createIfMissing: false,
    });

    const response = await client.screenshot({
      fullPage: args.fullPage,
    });

    if (!response.success) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    // Handle both raw string (from executeCommand) and object format
    const base64 =
      typeof response.data === "string"
        ? response.data
        : (response.data as { base64: string }).base64;

    if (args.output) {
      // Write to file
      const buffer = Buffer.from(base64, "base64");
      await Bun.write(args.output, buffer);
      console.log(`Screenshot saved to ${args.output}`);
    } else {
      // Output base64
      console.log(base64);
    }
  },
});

// --- resize ---
const resizeCommand = command({
  name: "resize",
  description: "Resize browser viewport",
  args: {
    width: positional({ type: number, displayName: "width" }),
    height: positional({ type: number, displayName: "height" }),
    session: sessionOption,
    json: jsonFlag,
  },
  handler: async (args) => {
    const client = await ensureDaemon(args.session ?? "default", undefined, {
      createIfMissing: false,
    });

    const response = await client.command({
      type: "resize",
      width: args.width,
      height: args.height,
    });

    if (!response.success) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    if (args.json) {
      console.log(JSON.stringify({ width: args.width, height: args.height }));
    } else {
      console.log(`Viewport resized to ${args.width}x${args.height}`);
    }
  },
});

// --- close ---
const closeCommand = command({
  name: "close",
  description: "Close the browser session or shutdown daemon",
  args: {
    session: sessionOption,
    all: flag({
      long: "all",
      description: "Close all sessions and shutdown daemon",
    }),
  },
  handler: async (args) => {
    const client = new DaemonClient(args.session);

    if (!(await client.ping())) {
      console.log("Daemon not running.");
      cleanupDaemonFiles();
      return;
    }

    try {
      if (args.all) {
        await client.shutdown();
        console.log("All sessions closed. Daemon stopped.");
      } else {
        const sessionId = args.session ?? "default";
        const response = await client.closeSession(sessionId);
        if (response.success) {
          console.log(`Session "${sessionId}" closed.`);
        } else {
          console.error("Error:", response.error);
          process.exit(1);
        }
      }
    } catch {
      cleanupDaemonFiles();
      console.log("Session closed.");
    }
  },
});

// --- sessions ---
const sessionsCommand = command({
  name: "sessions",
  description: "List all active browser sessions",
  args: {
    json: jsonFlag,
  },
  handler: async (args) => {
    const client = new DaemonClient();

    if (!(await client.ping())) {
      if (args.json) {
        console.log(JSON.stringify({ sessions: [] }, null, 2));
      } else {
        console.log("Daemon not running. No active sessions.");
      }
      return;
    }

    const response = await client.list();

    if (!response.success) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    const data = response.data as {
      sessions: Array<{
        id: string;
        url: string;
        title: string;
        busy: boolean;
        lastUsed: number;
      }>;
    };

    if (args.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      if (data.sessions.length === 0) {
        console.log("No active sessions.");
      } else {
        console.log(`Sessions (${data.sessions.length}):\n`);
        for (const s of data.sessions) {
          const status = s.busy ? "[busy]" : "[idle]";
          console.log(`  ${s.id} ${status}`);
          console.log(`    ${s.title || "(no title)"}`);
          console.log(`    ${s.url}`);
          console.log();
        }
      }
    }
  },
});

// --- status ---
const statusCommand = command({
  name: "status",
  description: "Check if daemon is running",
  args: {},
  handler: async () => {
    const running = isDaemonRunning();
    if (running) {
      console.log("Daemon is running.");
      // Try to list sessions
      const client = new DaemonClient();
      if (await client.ping()) {
        const response = await client.list();
        if (response.success) {
          const data = response.data as {
            sessions: Array<{
              id: string;
              url: string;
              title: string;
              busy: boolean;
            }>;
          };
          if (data.sessions.length === 0) {
            console.log("No active sessions.");
          } else {
            console.log(`\nSessions (${data.sessions.length}):`);
            for (const s of data.sessions) {
              const status = s.busy ? "[busy]" : "[idle]";
              console.log(`  ${s.id} ${status}`);
              console.log(`    ${s.title || "(no title)"}`);
              console.log(`    ${s.url}`);
            }
          }
        }
      }
    } else {
      console.log("Daemon is not running.");
    }
  },
});

// --- server (renamed from start) ---
const serverCommand = command({
  name: "server",
  description: "Start the HTTP server (multi-session mode)",
  args: {
    configPath: configOption,
    host: option({
      long: "host",
      type: string,
      defaultValue: () => "",
      description: "Hostname to bind (default: localhost)",
    }),
    port: option({
      long: "port",
      type: number,
      defaultValue: () => 0,
      description: "Port to bind (default: 3790)",
    }),
    sessionTtlMs: option({
      long: "session-ttl",
      type: number,
      defaultValue: () => 0,
      description: "Session TTL in ms (0 = no expiry)",
    }),
    headless: headlessFlag,
    headed: headedFlag,
    viewportWidth: option({
      long: "viewport-width",
      type: number,
      defaultValue: () => 0,
      description: "Viewport width (default: 1280)",
    }),
    viewportHeight: option({
      long: "viewport-height",
      type: number,
      defaultValue: () => 0,
      description: "Viewport height (default: 720)",
    }),
    executablePath: option({
      long: "executable-path",
      type: optional(string),
      description: "Path to Chrome executable",
    }),
    userDataDir: option({
      long: "user-data-dir",
      type: optional(string),
      description: "Path to Chrome user data directory",
    }),
    timeout: option({
      long: "timeout",
      type: number,
      defaultValue: () => 0,
      description: "Default timeout in ms (default: 30000)",
    }),
    noNetwork: flag({
      long: "no-network",
      description: "Disable network request capture",
    }),
    networkLogLimit: option({
      long: "network-log-limit",
      type: number,
      defaultValue: () => 0,
      description: "Max network events to keep (default: 100)",
    }),
    storageStatePath: option({
      long: "storage-state",
      type: optional(string),
      description: "Path to storage state JSON file",
    }),
    bundled: flag({
      long: "bundled",
      description: "Use bundled Playwright Chromium",
    }),
  },
  handler: (args) =>
    withLog({ command: "server" }, async () => {
      const configPath = await findConfigPath(args.configPath);
      const config = configPath ? await loadConfig(configPath) : undefined;
      if (configPath) {
        console.log(`Using config: ${configPath}`);
      }

      let headless: boolean | undefined;
      if (args.headed) {
        headless = false;
      } else if (args.headless) {
        headless = true;
      } else {
        headless = config?.headless;
      }

      const useSystemChrome = args.bundled ? false : config?.useSystemChrome;

      const browserOptions: AgentBrowserOptions = {
        headless,
        executablePath: args.executablePath ?? config?.executablePath,
        useSystemChrome,
        allowSystemChromeHeadless: config?.allowSystemChromeHeadless,
        viewportWidth: args.viewportWidth || config?.viewportWidth,
        viewportHeight: args.viewportHeight || config?.viewportHeight,
        userDataDir: args.userDataDir ?? config?.userDataDir,
        timeout: args.timeout || config?.timeout,
        captureNetwork: args.noNetwork ? false : config?.captureNetwork,
        networkLogLimit: args.networkLogLimit || config?.networkLogLimit,
        storageStatePath: args.storageStatePath ?? config?.storageStatePath,
      };

      const host = args.host.trim() || config?.serverHost || "localhost";
      const port = args.port || config?.serverPort || 3790;
      const sessionTtlMs = args.sessionTtlMs || config?.serverSessionTtlMs;

      const server = startBrowserServer({
        host,
        port,
        sessionTtlMs,
        browserOptions,
      });

      const serverUrl = `http://${server.host}:${server.port}`;
      console.log(`Browser server running at ${serverUrl}`);
      console.log(`Create session: POST ${serverUrl}/session`);

      const shutdown = async () => {
        console.log("\nShutting down...");
        await server.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await new Promise(() => {});
    }),
});

// start is now just an alias - use server directly in the subcommands

// --- install-skill (kept for backwards compat, use setup instead) ---
const installSkillCommand = command({
  name: "install-skill",
  description:
    "Install skill files only (prefer 'setup' for full installation)",
  args: {
    target: option({
      long: "target",
      short: "t",
      type: optional(string),
      description: "Target directory (default: cwd)",
    }),
  },
  handler: async (args) => {
    const targetDir = args.target ?? process.cwd();
    const installed = await installSkillFiles(targetDir);
    if (installed) {
      console.log(
        `Installed skills to ${targetDir}/.claude/skills/agent-browser-loop/`,
      );
    } else {
      console.error("Could not find skill files");
      process.exit(1);
    }
  },
});

// ============================================================================
// Profile Commands
// ============================================================================

const profileListCommand = command({
  name: "list",
  description: "List all available profiles",
  args: {
    json: jsonFlag,
  },
  handler: async (args) => {
    const profiles = listProfiles();

    if (args.json) {
      console.log(JSON.stringify(profiles, null, 2));
    } else {
      if (profiles.length === 0) {
        console.log("No profiles found.");
        console.log("\nCreate a profile with:");
        console.log("  agent-browser profile login <name> --url <login-url>");
        console.log("  agent-browser profile save <name>");
        return;
      }

      console.log(`Profiles (${profiles.length}):\n`);
      for (const p of profiles) {
        const scopeLabel =
          p.scope === "global"
            ? "[global]"
            : p.scope === "local-private"
              ? "[private]"
              : "[local]";
        console.log(`  ${p.name} ${scopeLabel}`);
        if (p.meta?.description) {
          console.log(`    ${p.meta.description}`);
        }
        if (p.meta?.origins?.length) {
          console.log(`    Origins: ${p.meta.origins.join(", ")}`);
        }
        if (p.meta?.lastUsedAt) {
          console.log(`    Last used: ${p.meta.lastUsedAt}`);
        }
        console.log();
      }
    }
  },
});

const profileShowCommand = command({
  name: "show",
  description: "Show profile contents",
  args: {
    name: positional({ type: string, displayName: "name" }),
    json: jsonFlag,
  },
  handler: async (args) => {
    const profile = loadProfile(args.name);
    if (!profile) {
      console.error(`Profile not found: ${args.name}`);
      process.exit(1);
    }

    if (args.json) {
      console.log(JSON.stringify(profile, null, 2));
    } else {
      const resolved = resolveProfilePath(args.name);
      console.log(`Profile: ${args.name}`);
      console.log(`Path: ${resolved?.path}`);
      console.log(`Scope: ${resolved?.scope}`);
      console.log();
      if (profile._meta?.description) {
        console.log(`Description: ${profile._meta.description}`);
      }
      if (profile._meta?.origins?.length) {
        console.log(`Origins: ${profile._meta.origins.join(", ")}`);
      }
      if (profile._meta?.createdAt) {
        console.log(`Created: ${profile._meta.createdAt}`);
      }
      if (profile._meta?.lastUsedAt) {
        console.log(`Last used: ${profile._meta.lastUsedAt}`);
      }
      console.log();
      console.log(`Cookies: ${profile.cookies.length}`);
      for (const cookie of profile.cookies) {
        console.log(`  - ${cookie.name} (${cookie.domain})`);
      }
      console.log();
      console.log(`LocalStorage origins: ${profile.origins.length}`);
      for (const origin of profile.origins) {
        console.log(
          `  - ${origin.origin}: ${origin.localStorage.length} items`,
        );
      }
    }
  },
});

const profileSaveCommand = command({
  name: "save",
  description: "Save current session storage to a profile",
  args: {
    name: positional({ type: string, displayName: "name" }),
    session: sessionOption,
    global: globalFlag,
    private: privateFlag,
    description: option({
      long: "description",
      short: "d",
      type: optional(string),
      description: "Profile description",
    }),
  },
  handler: async (args) => {
    const client = await ensureDaemon(args.session ?? "default", undefined, {
      createIfMissing: false,
    });

    // Get storage state from session via command
    const response = await client.command({
      type: "saveStorageState",
    });

    if (!response.success) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    const storageState = response.data as StorageState;

    // Extract origins from storage state
    const origins = [
      ...new Set([
        ...storageState.cookies.map((c) => c.domain),
        ...storageState.origins.map((o) => o.origin),
      ]),
    ].filter(Boolean);

    const savedPath = saveProfile(args.name, storageState, {
      global: args.global,
      private: args.private,
      description: args.description,
      origins,
    });

    console.log(`Profile saved: ${args.name}`);
    console.log(`Path: ${savedPath}`);
    console.log(`Cookies: ${storageState.cookies.length}`);
    console.log(`LocalStorage origins: ${storageState.origins.length}`);
  },
});

const profileDeleteCommand = command({
  name: "delete",
  description: "Delete a profile",
  args: {
    name: positional({ type: string, displayName: "name" }),
  },
  handler: async (args) => {
    const resolved = resolveProfilePath(args.name);
    if (!resolved) {
      console.error(`Profile not found: ${args.name}`);
      process.exit(1);
    }

    const deleted = deleteProfile(args.name);
    if (deleted) {
      console.log(`Deleted profile: ${args.name}`);
      console.log(`Path: ${resolved.path}`);
    } else {
      console.error(`Failed to delete profile: ${args.name}`);
      process.exit(1);
    }
  },
});

const profileImportCommand = command({
  name: "import",
  description: "Import a profile from a storage state JSON file",
  args: {
    name: positional({ type: string, displayName: "name" }),
    path: positional({ type: string, displayName: "path" }),
    global: globalFlag,
    private: privateFlag,
  },
  handler: async (args) => {
    try {
      const savedPath = importProfile(args.name, args.path, {
        global: args.global,
        private: args.private,
      });
      console.log(`Imported profile: ${args.name}`);
      console.log(`Path: ${savedPath}`);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});

const profileCaptureCommand = command({
  name: "capture",
  description: "Open browser, interact manually, then save session to profile",
  args: {
    name: positional({ type: string, displayName: "name" }),
    url: option({
      long: "url",
      type: string,
      description: "URL to navigate to",
    }),
    headed: headedFlag,
    headless: headlessFlag,
    config: configOption,
    global: globalFlag,
    private: privateFlag,
    description: option({
      long: "description",
      short: "d",
      type: optional(string),
      description: "Profile description",
    }),
  },
  handler: async (args) => {
    console.log(`Capturing session for profile: ${args.name}`);
    console.log(`URL: ${args.url}`);
    console.log();
    console.log("Browser will open. Log in or do whatever you need.");
    console.log("Press Enter here when done to save and close.");
    console.log();

    // Force headed mode for interactive login
    const browserOptions = await resolveBrowserOptions({
      ...args,
      configPath: args.config,
      headed: true,
      headless: false,
    });

    // Create a new session for login
    const client = await ensureDaemonNewSession(browserOptions);
    const sessionId = client.getSessionId();

    // Navigate to login URL
    const navResponse = await client.act([{ type: "navigate", url: args.url }]);
    if (!navResponse.success) {
      console.error("Error navigating:", navResponse.error);
      await client.closeSession(sessionId!);
      process.exit(1);
    }

    // Wait for user to press Enter
    process.stdout.write("Press Enter when login is complete...");
    await new Promise<void>((resolve) => {
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
      process.stdin.once("data", () => {
        resolve();
      });
    });
    console.log();

    // Save storage state
    const saveResponse = await client.command({
      type: "saveStorageState",
    });

    if (!saveResponse.success) {
      console.error("Error saving storage state:", saveResponse.error);
      await client.closeSession(sessionId!);
      process.exit(1);
    }

    const storageState = saveResponse.data as StorageState;

    // Extract origins from storage state
    const origins = [
      ...new Set([
        ...storageState.cookies.map((c) => c.domain),
        ...storageState.origins.map((o) => o.origin),
      ]),
    ].filter(Boolean);

    const savedPath = saveProfile(args.name, storageState, {
      global: args.global,
      private: args.private,
      description: args.description,
      origins,
    });

    // Close the session
    await client.closeSession(sessionId!);

    console.log();
    console.log(`Profile saved: ${args.name}`);
    console.log(`Path: ${savedPath}`);
    console.log(`Cookies: ${storageState.cookies.length}`);
    console.log(`LocalStorage origins: ${storageState.origins.length}`);
  },
});

const profileCommand = subcommands({
  name: "profile",
  cmds: {
    list: profileListCommand,
    show: profileShowCommand,
    save: profileSaveCommand,
    delete: profileDeleteCommand,
    import: profileImportCommand,
    capture: profileCaptureCommand,
  },
});

// ============================================================================
// Main CLI
// ============================================================================

const cli = subcommands({
  name: "agent-browser",
  version: VERSION,
  cmds: {
    // Primary CLI commands (daemon-based)
    open: openCommand,
    act: actCommand,
    wait: waitCommand,
    state: stateCommand,
    screenshot: screenshotCommand,
    resize: resizeCommand,
    close: closeCommand,
    sessions: sessionsCommand,
    status: statusCommand,

    // Profile management
    profile: profileCommand,

    // Setup & configuration
    setup: setupCommand,
    "install-skill": installSkillCommand,

    // HTTP server mode
    server: serverCommand,
    start: serverCommand, // backwards compat alias
  },
});

run(cli, process.argv.slice(2)).catch((error) => {
  // Print clean error message for user-facing errors
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
