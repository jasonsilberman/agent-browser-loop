import type { Page, Request } from "playwright";
import type {
  ClickOptions,
  NavigateOptions,
  NetworkEvent,
  TypeOptions,
} from "./types";

/**
 * Get a locator for an element by ref or index
 * After calling getState(), elements have data-ref attributes injected
 */
function getLocator(page: Page, options: { ref?: string; index?: number }) {
  if (options.ref) {
    return page.locator(`[data-ref="${options.ref}"]`);
  }
  if (options.index !== undefined) {
    // Use data-index (injected by getState). Fallback to legacy e{index} refs.
    return page.locator(
      `[data-index="${options.index}"], [data-ref="e${options.index}"]`,
    );
  }
  throw new Error("Must provide either ref or index");
}

/**
 * Click an element
 */
export async function click(page: Page, options: ClickOptions): Promise<void> {
  const locator = getLocator(page, options);

  const clickOptions: Parameters<typeof locator.click>[0] = {
    button: options.button,
    modifiers: options.modifiers,
  };

  if (options.double) {
    await locator.dblclick(clickOptions);
  } else {
    await locator.click(clickOptions);
  }
}

/**
 * Type text into an element
 */
export async function type(page: Page, options: TypeOptions): Promise<void> {
  const locator = getLocator(page, options);

  // Clear existing text if requested
  if (options.clear) {
    await locator.clear();
  }

  // Type the text
  if (options.delay) {
    await locator.type(options.text, { delay: options.delay });
  } else {
    await locator.fill(options.text);
  }

  // Press Enter if submit requested
  if (options.submit) {
    await locator.press("Enter");
  }
}

/**
 * Navigate to a URL
 */
export async function navigate(
  page: Page,
  options: NavigateOptions,
): Promise<void> {
  await page.goto(options.url, {
    waitUntil: options.waitUntil || "load",
  });
}

/**
 * Press a keyboard key
 */
export async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}

/**
 * Scroll the page
 */
export async function scroll(
  page: Page,
  direction: "up" | "down",
  amount: number = 500,
): Promise<void> {
  const delta = direction === "down" ? amount : -amount;
  await page.mouse.wheel(0, delta);
  // Wait for any lazy-loaded content
  await page.waitForTimeout(100);
}

/**
 * Wait for navigation to complete
 */
export async function waitForNavigation(
  page: Page,
  options?: { timeoutMs?: number },
): Promise<void> {
  await page.waitForLoadState("networkidle", {
    timeout: options?.timeoutMs || 30000,
  });
}

/**
 * Wait for an element to appear
 */
export async function waitForElement(
  page: Page,
  selector: string,
  options?: { timeoutMs?: number; state?: "attached" | "visible" },
): Promise<void> {
  await page.locator(selector).waitFor({
    timeout: options?.timeoutMs || 30000,
    state: options?.state || "visible",
  });
}

/**
 * Hover over an element
 */
export async function hover(
  page: Page,
  options: { ref?: string; index?: number },
): Promise<void> {
  const locator = getLocator(page, options);
  await locator.hover();
}

/**
 * Select an option from a dropdown
 */
export async function select(
  page: Page,
  options: { ref?: string; index?: number; value: string | string[] },
): Promise<void> {
  const locator = getLocator(page, options);
  await locator.selectOption(options.value);
}

/**
 * Take a screenshot
 */
export async function screenshot(
  page: Page,
  options?: { fullPage?: boolean; path?: string },
): Promise<string> {
  const buffer = await page.screenshot({
    type: "jpeg",
    quality: 80,
    fullPage: options?.fullPage,
    path: options?.path,
  });
  return buffer.toString("base64");
}

/**
 * Get console logs from the page
 */
export function setupConsoleCapture(page: Page): string[] {
  const logs: string[] = [];

  page.on("console", (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  page.on("pageerror", (error) => {
    logs.push(`[error] ${error.message}`);
  });

  return logs;
}

function pushNetworkEvent(
  events: NetworkEvent[],
  event: NetworkEvent,
  limit: number,
) {
  events.push(event);
  if (events.length > limit) {
    events.splice(0, events.length - limit);
  }
}

/**
 * Capture network activity from the page
 */
export function setupNetworkCapture(
  page: Page,
  events: NetworkEvent[],
  limit = 500,
): void {
  let counter = 0;
  const requestMap = new Map<Request, { id: string; startedAt: number }>();

  page.on("request", (request) => {
    const id = `req-${counter++}`;
    const startedAt = Date.now();
    requestMap.set(request, { id, startedAt });
    pushNetworkEvent(
      events,
      {
        id,
        type: "request",
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        timestamp: startedAt,
      },
      limit,
    );
  });

  page.on("response", (response) => {
    const request = response.request();
    const cached = requestMap.get(request);
    const id = cached?.id ?? `req-${counter++}`;
    const startedAt = cached?.startedAt ?? Date.now();
    const timestamp = Date.now();
    pushNetworkEvent(
      events,
      {
        id,
        type: "response",
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        status: response.status(),
        ok: response.ok(),
        timestamp,
        durationMs: timestamp - startedAt,
      },
      limit,
    );
    requestMap.delete(request);
  });

  page.on("requestfailed", (request) => {
    const cached = requestMap.get(request);
    const id = cached?.id ?? `req-${counter++}`;
    const startedAt = cached?.startedAt ?? Date.now();
    const timestamp = Date.now();
    pushNetworkEvent(
      events,
      {
        id,
        type: "failed",
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failureText: request.failure()?.errorText,
        timestamp,
        durationMs: timestamp - startedAt,
      },
      limit,
    );
    requestMap.delete(request);
  });
}
