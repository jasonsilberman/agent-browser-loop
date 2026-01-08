import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import * as actions from "./actions";
import { findChromeExecutable } from "./chrome";
import { log } from "./log";
import { formatStateText, getState } from "./state";
import type {
  BrowserConfig,
  BrowserState,
  ClickOptions,
  DumpNetworkOptions,
  DumpStateOptions,
  DumpStateTextOptions,
  GetStateOptions,
  NavigateOptions,
  NetworkEvent,
  TypeOptions,
} from "./types";

export type AgentBrowserOptions = BrowserConfig;

/**
 * Main browser automation class
 */
export class AgentBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserConfig;
  private consoleLogs: string[] = [];
  private networkLogs: NetworkEvent[] = [];
  private networkCaptureEnabled = false;
  private networkLogLimit: number;
  private usePersistentContext = false;
  private lastState: BrowserState | null = null;

  constructor(options: AgentBrowserOptions = {}) {
    this.config = {
      headless: options.headless ?? true,
      executablePath: options.executablePath,
      useSystemChrome: options.useSystemChrome ?? true,
      viewportWidth: options.viewportWidth ?? 1280,
      viewportHeight: options.viewportHeight ?? 720,
      userDataDir: options.userDataDir,
      timeout: options.timeout ?? 30000,
      captureNetwork: options.captureNetwork ?? true,
      networkLogLimit: options.networkLogLimit,
      storageState: options.storageState,
      storageStatePath: options.storageStatePath,
    };
    this.networkLogLimit =
      options.networkLogLimit ?? this.config.networkLogLimit ?? 500;
  }

  /**
   * Start the browser
   */
  async start(): Promise<void> {
    if (this.browser) {
      throw new Error("Browser already started");
    }

    const resolvedExecutablePath = this.config.useSystemChrome
      ? this.config.executablePath || findChromeExecutable()
      : undefined;

    log
      .withMetadata({
        headless: this.config.headless,
        useSystemChrome: this.config.useSystemChrome,
        executablePath: resolvedExecutablePath,
        userDataDir: this.config.userDataDir,
      })
      .debug("Launching browser");

    if (this.config.userDataDir) {
      this.usePersistentContext = true;
      const launchOptions = {
        headless: this.config.headless,
        executablePath: resolvedExecutablePath,
        viewport: {
          width: this.config.viewportWidth!,
          height: this.config.viewportHeight!,
        },
        timeout: this.config.timeout,
      };
      try {
        this.context = await chromium.launchPersistentContext(
          this.config.userDataDir,
          launchOptions,
        );
      } catch (error) {
        log
          .withError(error)
          .warn("Persistent context launch failed, retrying without path");
        if (!resolvedExecutablePath) {
          throw error;
        }
        this.context = await chromium.launchPersistentContext(
          this.config.userDataDir,
          { ...launchOptions, executablePath: undefined },
        );
      }
      this.browser = this.context.browser();
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
    } else {
      try {
        this.browser = await chromium.launch({
          headless: this.config.headless,
          executablePath: resolvedExecutablePath,
        });
      } catch (error) {
        log
          .withError(error)
          .warn("Browser launch failed, retrying without path");
        if (!resolvedExecutablePath) {
          throw error;
        }
        this.browser = await chromium.launch({
          headless: this.config.headless,
          executablePath: undefined,
        });
      }

      this.context = await this.browser.newContext({
        viewport: {
          width: this.config.viewportWidth!,
          height: this.config.viewportHeight!,
        },
        storageState: this.config.storageStatePath ?? this.config.storageState,
      });

      this.page = await this.context.newPage();
    }

    this.page.setDefaultTimeout(this.config.timeout!);

    // Set up console capture
    this.consoleLogs = actions.setupConsoleCapture(this.page);

    if (this.config.captureNetwork) {
      this.enableNetworkCapture();
    }
  }

  /**
   * Stop the browser
   */
  async stop(): Promise<void> {
    if (this.context) {
      await this.context.close();
    }
    if (this.browser && !this.usePersistentContext) {
      await this.browser.close();
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.consoleLogs = [];
    this.networkLogs = [];
    this.networkCaptureEnabled = false;
    this.usePersistentContext = false;
  }

  /**
   * Get current page (throws if not started)
   */
  private getPage(): Page {
    if (!this.page) {
      throw new Error("Browser not started. Call start() first.");
    }
    return this.page;
  }

  /**
   * Get current context (throws if not started)
   */
  private getContext(): BrowserContext {
    if (!this.context) {
      throw new Error("Browser not started. Call start() first.");
    }
    return this.context;
  }

  /**
   * Navigate to a URL
   */
  async navigate(
    url: string,
    options?: Omit<NavigateOptions, "url">,
  ): Promise<void> {
    await actions.navigate(this.getPage(), { url, ...options });
  }

  /**
   * Get rich state of the current page
   * Also injects data-ref attributes for element targeting
   */
  async getState(options?: GetStateOptions): Promise<BrowserState> {
    // getState now handles ref injection internally
    const state = await getState(this.getPage(), this.getContext(), options);
    const result = {
      ...state,
      errors: {
        console: this.getConsoleErrors(),
        network: this.getNetworkErrors(),
      },
    };
    this.lastState = result;
    return result;
  }

  /**
   * Get the last cached state (non-blocking)
   * Returns null if getState() hasn't been called yet
   */
  getLastState(): BrowserState | null {
    return this.lastState;
  }

  /**
   * Dump current state to a JSON file
   */
  async dumpState(options: DumpStateOptions): Promise<void> {
    const state = await this.getState(options.state);
    const pretty = options.pretty ?? true;
    const json = JSON.stringify(state, null, pretty ? 2 : undefined);
    await Bun.write(options.path, json);
  }

  /**
   * Dump current state text to a file
   */
  async dumpStateText(options: DumpStateTextOptions): Promise<void> {
    const state = await this.getState(options.state);
    const text = formatStateText(state);
    await Bun.write(options.path, text);
  }

  /**
   * Dump network logs to a file
   */
  async dumpNetworkLogs(options: DumpNetworkOptions): Promise<void> {
    const pretty = options.pretty ?? true;
    const json = JSON.stringify(
      this.getNetworkLogs(),
      null,
      pretty ? 2 : undefined,
    );
    await Bun.write(options.path, json);
  }

  /**
   * Click an element
   */
  async click(options: ClickOptions): Promise<void> {
    await actions.click(this.getPage(), options);
  }

  /**
   * Type text into an element
   */
  async type(options: TypeOptions): Promise<void> {
    await actions.type(this.getPage(), options);
  }

  /**
   * Press a keyboard key
   */
  async press(key: string): Promise<void> {
    await actions.press(this.getPage(), key);
  }

  /**
   * Scroll the page
   */
  async scroll(direction: "up" | "down", amount?: number): Promise<void> {
    await actions.scroll(this.getPage(), direction, amount);
  }

  /**
   * Wait for navigation to complete
   */
  async waitForNavigation(options?: { timeoutMs?: number }): Promise<void> {
    await actions.waitForNavigation(this.getPage(), options);
  }

  /**
   * Wait for an element
   */
  async waitForElement(
    selector: string,
    options?: { timeoutMs?: number; state?: "attached" | "visible" },
  ): Promise<void> {
    await actions.waitForElement(this.getPage(), selector, options);
  }

  /**
   * Wait for simple conditions (selector/text/url) with optional abort support
   */
  async waitFor(params: {
    selector?: string;
    text?: string;
    url?: string;
    notSelector?: string;
    notText?: string;
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  }): Promise<void> {
    const {
      selector,
      text,
      url,
      notSelector,
      notText,
      timeoutMs,
      intervalMs,
      signal,
    } = params;
    if (!selector && !text && !url && !notSelector && !notText) {
      throw new Error("Wait condition required");
    }

    const timeout = timeoutMs ?? this.config.timeout ?? 30000;
    const interval = intervalMs ?? 200;
    const page = this.getPage();
    const start = Date.now();
    let aborted = false;
    const onAbort = () => {
      aborted = true;
    };

    if (signal) {
      if (signal.aborted) {
        throw new Error("Request aborted");
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      while (true) {
        if (aborted) {
          throw new Error("Request aborted");
        }
        if (Date.now() - start > timeout) {
          throw new Error(`Wait timed out after ${timeout}ms`);
        }

        const matched = await page.evaluate(
          ({ selector, text, url, notSelector, notText }) => {
            const isVisible = (target: string) => {
              try {
                const el = document.querySelector(target);
                if (!el) {
                  return false;
                }
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  (rect.width > 0 || rect.height > 0)
                );
              } catch {
                return false;
              }
            };

            const selectorMatches = selector ? isVisible(selector) : true;
            const notSelectorMatches = notSelector
              ? !isVisible(notSelector)
              : true;
            const bodyText = document.body?.innerText ?? "";
            const textMatches = text ? bodyText.includes(text) : true;
            const notTextMatches = notText ? !bodyText.includes(notText) : true;
            const urlMatches = url ? window.location.href.includes(url) : true;
            return (
              selectorMatches &&
              notSelectorMatches &&
              textMatches &&
              notTextMatches &&
              urlMatches
            );
          },
          { selector, text, url, notSelector, notText },
        );

        if (matched) {
          return;
        }

        await page.waitForTimeout(interval);
      }
    } finally {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  /**
   * Wait for text to appear in the document body
   */
  async waitForText(
    text: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.getPage().waitForFunction(
      (value) => document.body?.innerText?.includes(value) ?? false,
      text,
      { timeout: options?.timeoutMs ?? 30000 },
    );
  }

  /**
   * Wait for the URL to match
   */
  async waitForUrl(
    url: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.getPage().waitForURL(url, {
      timeout: options?.timeoutMs ?? 30000,
    });
  }

  /**
   * Hover over an element
   */
  async hover(options: { ref?: string; index?: number }): Promise<void> {
    await actions.hover(this.getPage(), options);
  }

  /**
   * Select from a dropdown
   */
  async select(options: {
    ref?: string;
    index?: number;
    value: string | string[];
  }): Promise<void> {
    await actions.select(this.getPage(), options);
  }

  /**
   * Take a screenshot
   */
  async screenshot(options?: {
    fullPage?: boolean;
    path?: string;
  }): Promise<string> {
    return actions.screenshot(this.getPage(), options);
  }

  /**
   * Get captured console logs
   */
  getConsoleLogs(): string[] {
    return [...this.consoleLogs];
  }

  /**
   * Clear captured console logs
   */
  clearConsoleLogs(): void {
    this.consoleLogs.length = 0;
  }

  /**
   * Get recent console errors/warnings
   */
  getConsoleErrors(): string[] {
    return this.consoleLogs.filter((entry) =>
      /^\[(error|warning)\]/i.test(entry),
    );
  }

  /**
   * Get captured network logs
   */
  getNetworkLogs(): NetworkEvent[] {
    return [...this.networkLogs];
  }

  /**
   * Clear captured network logs
   */
  clearNetworkLogs(): void {
    this.networkLogs.length = 0;
  }

  /**
   * Get recent network errors (failed requests or HTTP 4xx/5xx)
   */
  getNetworkErrors(): NetworkEvent[] {
    return this.networkLogs.filter((event) => {
      if (event.type === "failed") {
        return true;
      }
      if (event.status && event.status >= 400) {
        return true;
      }
      if (event.ok === false) {
        return true;
      }
      return false;
    });
  }

  /**
   * Enable network capture
   */
  enableNetworkCapture(): void {
    if (this.networkCaptureEnabled) {
      return;
    }
    const page = this.getPage();
    this.networkCaptureEnabled = true;
    actions.setupNetworkCapture(page, this.networkLogs, this.networkLogLimit);
  }

  /**
   * Get the underlying Playwright page for advanced usage
   */
  get rawPage(): Page {
    return this.getPage();
  }

  /**
   * Get the underlying Playwright context for advanced usage
   */
  get rawContext(): BrowserContext {
    return this.getContext();
  }

  /**
   * Get the underlying Playwright browser for advanced usage
   */
  get rawBrowser(): Browser {
    if (!this.browser) {
      throw new Error("Browser not started. Call start() first.");
    }
    return this.browser;
  }

  /**
   * Save storage state to a file (and return the state)
   */
  async saveStorageState(path?: string): Promise<unknown> {
    const state = await this.getContext().storageState();
    if (path) {
      await Bun.write(path, JSON.stringify(state, null, 2));
    }
    return state;
  }
}

/**
 * Create a browser instance
 */
export function createBrowser(options?: AgentBrowserOptions): AgentBrowser {
  return new AgentBrowser(options);
}
