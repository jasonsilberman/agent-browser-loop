import { z } from "zod";
import type { AgentBrowser } from "./browser";
import { formatStateText } from "./state";
import type { BrowserState, GetStateOptions } from "./types";

// ============================================================================
// Command Schemas
// ============================================================================

// Base option schemas
const navigateOptionsSchema = z.object({
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
});

const clickOptionsSchema = z.object({
  ref: z.string().optional(),
  index: z.number().int().optional(),
  double: z.boolean().optional(),
  button: z.enum(["left", "right", "middle"]).optional(),
  modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
});

const typeOptionsSchema = z.object({
  ref: z.string().optional(),
  index: z.number().int().optional(),
  text: z.string(),
  submit: z.boolean().optional(),
  clear: z.boolean().optional(),
  delay: z.number().int().optional(),
});

const waitForNavigationOptionsSchema = z.object({
  timeoutMs: z.number().int().optional(),
});

const waitForElementOptionsSchema = z.object({
  timeoutMs: z.number().int().optional(),
  state: z.enum(["attached", "visible"]).optional(),
});

export const getStateOptionsSchema = z.object({
  includeScreenshot: z.boolean().optional(),
  viewportOnly: z.boolean().optional(),
  includeElements: z.boolean().optional(),
  includeTree: z.boolean().optional(),
  elementsLimit: z.number().int().optional(),
  elementsHead: z.number().int().optional(),
  elementsTail: z.number().int().optional(),
  treeLimit: z.number().int().optional(),
  treeHead: z.number().int().optional(),
  treeTail: z.number().int().optional(),
});

const dumpStateOptionsSchema = z.object({
  path: z.string(),
  pretty: z.boolean().optional(),
  state: getStateOptionsSchema.optional(),
});

const dumpStateTextOptionsSchema = z.object({
  path: z.string(),
  state: getStateOptionsSchema.optional(),
});

const dumpNetworkOptionsSchema = z.object({
  path: z.string(),
  pretty: z.boolean().optional(),
});

// Command schemas
const navigateCommandSchema = z
  .object({ type: z.literal("navigate"), url: z.string() })
  .extend({ options: navigateOptionsSchema.optional() });

const clickCommandSchema = z
  .object({ type: z.literal("click") })
  .extend(clickOptionsSchema.shape);

const typeCommandSchema = z
  .object({ type: z.literal("type") })
  .extend(typeOptionsSchema.shape);

const pressCommandSchema = z.object({
  type: z.literal("press"),
  key: z.string(),
});

const scrollCommandSchema = z.object({
  type: z.literal("scroll"),
  direction: z.enum(["up", "down"]),
  amount: z.number().int().optional(),
});

const hoverCommandSchema = z.object({
  type: z.literal("hover"),
  ref: z.string().optional(),
  index: z.number().int().optional(),
});

const selectCommandSchema = z.object({
  type: z.literal("select"),
  ref: z.string().optional(),
  index: z.number().int().optional(),
  value: z.union([z.string(), z.array(z.string())]),
});

const waitForNavigationCommandSchema = z.object({
  type: z.literal("waitForNavigation"),
  options: waitForNavigationOptionsSchema.optional(),
});

const waitForElementCommandSchema = z.object({
  type: z.literal("waitForElement"),
  selector: z.string(),
  options: waitForElementOptionsSchema.optional(),
});

const screenshotCommandSchema = z.object({
  type: z.literal("screenshot"),
  fullPage: z.boolean().optional(),
  path: z.string().optional(),
});

const resizeCommandSchema = z.object({
  type: z.literal("resize"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const saveStorageStateCommandSchema = z.object({
  type: z.literal("saveStorageState"),
  path: z.string().optional(),
});

const getStateCommandSchema = z.object({
  type: z.literal("getState"),
  options: getStateOptionsSchema.optional(),
});

const dumpStateCommandSchema = z
  .object({ type: z.literal("dumpState") })
  .extend(dumpStateOptionsSchema.shape);

const dumpStateTextCommandSchema = z
  .object({ type: z.literal("dumpStateText") })
  .extend(dumpStateTextOptionsSchema.shape);

const dumpNetworkLogsCommandSchema = z
  .object({ type: z.literal("dumpNetworkLogs") })
  .extend(dumpNetworkOptionsSchema.shape);

const getConsoleLogsCommandSchema = z.object({
  type: z.literal("getConsoleLogs"),
});

const clearConsoleLogsCommandSchema = z.object({
  type: z.literal("clearConsoleLogs"),
});

const getNetworkLogsCommandSchema = z.object({
  type: z.literal("getNetworkLogs"),
});

const clearNetworkLogsCommandSchema = z.object({
  type: z.literal("clearNetworkLogs"),
});

const enableNetworkCaptureCommandSchema = z.object({
  type: z.literal("enableNetworkCapture"),
});

const closeCommandSchema = z.object({ type: z.literal("close") });

// Step actions - subset that can be batched
export const stepActionSchema = z.discriminatedUnion("type", [
  navigateCommandSchema,
  clickCommandSchema,
  typeCommandSchema,
  pressCommandSchema,
  scrollCommandSchema,
  hoverCommandSchema,
  selectCommandSchema,
  waitForNavigationCommandSchema,
  waitForElementCommandSchema,
  screenshotCommandSchema,
  saveStorageStateCommandSchema,
  resizeCommandSchema,
]);

// All commands
export const commandSchema = z.discriminatedUnion("type", [
  navigateCommandSchema,
  clickCommandSchema,
  typeCommandSchema,
  pressCommandSchema,
  scrollCommandSchema,
  hoverCommandSchema,
  selectCommandSchema,
  waitForNavigationCommandSchema,
  waitForElementCommandSchema,
  getStateCommandSchema,
  dumpStateCommandSchema,
  dumpStateTextCommandSchema,
  dumpNetworkLogsCommandSchema,
  screenshotCommandSchema,
  getConsoleLogsCommandSchema,
  clearConsoleLogsCommandSchema,
  getNetworkLogsCommandSchema,
  clearNetworkLogsCommandSchema,
  enableNetworkCaptureCommandSchema,
  saveStorageStateCommandSchema,
  resizeCommandSchema,
  closeCommandSchema,
]);

// Wait condition schema
export const waitConditionSchema = z.object({
  selector: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  notSelector: z.string().min(1).optional(),
  notText: z.string().min(1).optional(),
});

// Derive types
export type StepAction = z.infer<typeof stepActionSchema>;
export type Command = z.infer<typeof commandSchema>;
export type WaitCondition = z.infer<typeof waitConditionSchema>;

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Execute a single command against an AgentBrowser.
 * Returns data for query commands, undefined for action commands.
 */
export async function executeCommand(
  browser: AgentBrowser,
  command: Command,
): Promise<unknown | undefined> {
  switch (command.type) {
    case "navigate":
      await browser.navigate(command.url, command.options);
      return;
    case "click":
      await browser.click(command);
      return;
    case "type":
      await browser.type(command);
      return;
    case "press":
      await browser.press(command.key);
      return;
    case "scroll":
      await browser.scroll(command.direction, command.amount);
      return;
    case "hover":
      await browser.hover(command);
      return;
    case "select":
      await browser.select(command);
      return;
    case "waitForNavigation":
      await browser.waitForNavigation(command.options);
      return;
    case "waitForElement":
      await browser.waitForElement(command.selector, command.options);
      return;
    case "dumpState":
      await browser.dumpState(command);
      return;
    case "dumpStateText":
      await browser.dumpStateText(command);
      return;
    case "dumpNetworkLogs":
      await browser.dumpNetworkLogs(command);
      return;
    case "clearConsoleLogs":
      browser.clearConsoleLogs();
      return;
    case "clearNetworkLogs":
      browser.clearNetworkLogs();
      return;
    case "enableNetworkCapture":
      browser.enableNetworkCapture();
      return;
    case "close":
      await browser.stop();
      return;
    case "resize":
      await browser.resize(command.width, command.height);
      return;
    // Commands that return data
    case "getState":
      return browser.getState(command.options);
    case "screenshot":
      return browser.screenshot(command);
    case "getConsoleLogs":
      return browser.getConsoleLogs();
    case "getNetworkLogs":
      return browser.getNetworkLogs();
    case "saveStorageState":
      return browser.saveStorageState(command.path);
  }
}

/**
 * Result from executing a single action
 */
export interface ActionResult {
  action: StepAction;
  result?: unknown;
  error?: string;
}

/**
 * Execute multiple actions sequentially
 */
export async function executeActions(
  browser: AgentBrowser,
  actions: StepAction[],
  options: { haltOnError?: boolean } = {},
): Promise<ActionResult[]> {
  const { haltOnError = true } = options;
  const results: ActionResult[] = [];

  for (const action of actions) {
    try {
      const result = await executeCommand(browser, action);
      results.push({ action, result: result ?? undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ action, error: message });
      if (haltOnError) {
        break;
      }
    }
  }

  return results;
}

/**
 * Execute a wait condition
 */
export async function executeWait(
  browser: AgentBrowser,
  condition: WaitCondition,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const { selector, text, url, notSelector, notText } = condition;

  if (!selector && !text && !url && !notSelector && !notText) {
    throw new Error("Wait condition required");
  }

  await browser.waitFor({
    selector,
    text,
    url,
    notSelector,
    notText,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}

// ============================================================================
// Response Formatting
// ============================================================================

/**
 * Format step results as human-readable text
 */
export function formatStepText(params: {
  results: ActionResult[];
  stateText?: string;
}): string {
  const lines: string[] = [];
  lines.push("Step results:");
  for (const result of params.results) {
    const hasError = result.error != null;
    const status = hasError ? "error" : "ok";
    const action = JSON.stringify(result.action);
    lines.push(`- ${status} ${action}`);
    if (hasError) {
      lines.push(`  ${result.error}`);
    }
  }

  if (params.stateText) {
    lines.push("");
    lines.push("State:");
    lines.push(params.stateText);
  }

  return lines.join("\n");
}

/**
 * Format wait result as human-readable text
 */
export function formatWaitText(params: {
  condition: WaitCondition;
  stateText?: string;
}): string {
  const lines: string[] = [];
  const conditions: string[] = [];
  if (params.condition.selector) {
    conditions.push(`selector=${params.condition.selector}`);
  }
  if (params.condition.text) {
    conditions.push(`text=${params.condition.text}`);
  }
  if (params.condition.url) {
    conditions.push(`url=${params.condition.url}`);
  }
  if (params.condition.notSelector) {
    conditions.push(`notSelector=${params.condition.notSelector}`);
  }
  if (params.condition.notText) {
    conditions.push(`notText=${params.condition.notText}`);
  }

  lines.push(
    `Wait: ok${conditions.length > 0 ? ` (${conditions.join(", ")})` : ""}`,
  );

  if (params.stateText) {
    lines.push("");
    lines.push("State:");
    lines.push(params.stateText);
  }

  return lines.join("\n");
}

/**
 * Get state and optionally format as text
 */
export async function getStateWithFormat(
  browser: AgentBrowser,
  options: {
    stateOptions?: GetStateOptions;
    includeState?: boolean;
    includeStateText?: boolean;
  } = {},
): Promise<{ state?: BrowserState; stateText?: string }> {
  const {
    stateOptions,
    includeState = false,
    includeStateText = true,
  } = options;

  if (!includeState && !includeStateText) {
    return {};
  }

  const state = await browser.getState(stateOptions);

  return {
    state: includeState ? state : undefined,
    stateText: includeStateText ? formatStateText(state) : undefined,
  };
}
