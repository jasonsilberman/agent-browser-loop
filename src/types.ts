import type { Browser, BrowserContext, Page } from "playwright";

export interface BrowserConfig {
  /** Run browser without visible UI (default: true) */
  headless?: boolean;
  /** Path to Chrome/Chromium executable (auto-detected if not provided) */
  executablePath?: string;
  /** Prefer system Chrome/Chromium over bundled Playwright (default: true) */
  useSystemChrome?: boolean;
  /** Allow system Chrome in headless mode on macOS (default: false) */
  allowSystemChromeHeadless?: boolean;
  /** Viewport width (default: 1280) */
  viewportWidth?: number;
  /** Viewport height (default: 720) */
  viewportHeight?: number;
  /** User data directory for persistent sessions */
  userDataDir?: string;
  /** Timeout for operations in ms (default: 30000) */
  timeout?: number;
  /** Enable network request capture */
  captureNetwork?: boolean;
  /** Max network events to store */
  networkLogLimit?: number;
  /** Storage state to initialize the context */
  storageState?: string | StorageState;
  /** Storage state file path to initialize the context */
  storageStatePath?: string;
}

export interface BrowserCliConfig extends BrowserConfig {
  /** Save storage state to this path after running */
  saveStorageStatePath?: string;
  /** Server host to bind */
  serverHost?: string;
  /** Server port to bind */
  serverPort?: number;
  /** Server session TTL in milliseconds */
  serverSessionTtlMs?: number;
}

export interface InteractiveElement {
  /** Index for referencing this element in actions */
  index: number;
  /** ARIA role (button, textbox, link, etc.) */
  role: string;
  /** Element's accessible name/label */
  name: string;
  /** Visible text content */
  text: string;
  /** aria-ref for precise targeting */
  ref: string;
  /** Whether element is currently visible */
  visible: boolean;
  /** Whether element is enabled/not disabled */
  enabled: boolean;
  /** Bounding box if available */
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Element attributes (href, placeholder, etc.) */
  attributes: Record<string, string>;
}

export interface TabInfo {
  /** Tab/page ID */
  id: string;
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Whether this is the active tab */
  active: boolean;
}

export interface ScrollPosition {
  /** Pixels scrolled from top */
  scrollTop: number;
  /** Pixels available above viewport */
  pixelsAbove: number;
  /** Pixels available below viewport */
  pixelsBelow: number;
  /** Total scrollable height */
  totalHeight: number;
  /** Viewport height */
  viewportHeight: number;
}

export interface BrowserState {
  /** Current page URL */
  url: string;
  /** Page title */
  title: string;
  /** List of open tabs */
  tabs: TabInfo[];
  /** Interactive elements on the page with indices */
  elements: InteractiveElement[];
  /** ARIA accessibility tree as text */
  accessibilityTree: string;
  /** Current scroll position */
  scrollPosition: ScrollPosition;
  /** Screenshot as base64 (optional, call with includeScreenshot: true) */
  screenshot?: string;
  /** Recent console + network errors (if available) */
  errors?: {
    console: string[];
    network: NetworkEvent[];
  };
}

export interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface NetworkEvent {
  id: string;
  type: "request" | "response" | "failed";
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  ok?: boolean;
  failureText?: string;
  timestamp: number;
  durationMs?: number;
}

export interface ClickOptions {
  /** Element reference (aria-ref) */
  ref?: string;
  /** Element index from state.elements */
  index?: number;
  /** Double click */
  double?: boolean;
  /** Mouse button */
  button?: "left" | "right" | "middle";
  /** Modifier keys */
  modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">;
}

export interface TypeOptions {
  /** Element reference (aria-ref) */
  ref?: string;
  /** Element index from state.elements */
  index?: number;
  /** Text to type */
  text: string;
  /** Press Enter after typing */
  submit?: boolean;
  /** Clear existing text first */
  clear?: boolean;
  /** Type slowly (delay between keystrokes in ms) */
  delay?: number;
}

export interface NavigateOptions {
  /** URL to navigate to */
  url: string;
  /** Wait until this load state */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

export interface GetStateOptions {
  /** Include base64 screenshot (increases response size) */
  includeScreenshot?: boolean;
  /** Only include elements in current viewport */
  viewportOnly?: boolean;
  /** Include interactive elements */
  includeElements?: boolean;
  /** Include accessibility tree */
  includeTree?: boolean;
  /** Limit number of elements returned (from start) */
  elementsLimit?: number;
  /** Return first N elements */
  elementsHead?: number;
  /** Return last N elements */
  elementsTail?: number;
  /** Limit number of tree lines returned (from start) */
  treeLimit?: number;
  /** Return first N tree lines */
  treeHead?: number;
  /** Return last N tree lines */
  treeTail?: number;
}

export interface DumpStateOptions {
  /** File path to write the state JSON */
  path: string;
  /** Pretty-print JSON output */
  pretty?: boolean;
  /** getState() options for trimming output */
  state?: GetStateOptions;
}

export interface DumpStateTextOptions {
  /** File path to write the state text */
  path: string;
  /** getState() options for trimming output */
  state?: GetStateOptions;
}

export interface DumpNetworkOptions {
  /** File path to write the network logs */
  path: string;
  /** Pretty-print JSON output */
  pretty?: boolean;
}

export interface BrowserInstance {
  /** Underlying Playwright browser */
  browser: Browser;
  /** Browser context */
  context: BrowserContext;
  /** Current page */
  page: Page;
}
