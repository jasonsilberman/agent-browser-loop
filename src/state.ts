import type { BrowserContext, Page } from "playwright";
import type { ElementRefStore, ElementSelectors } from "./ref-store";
import type {
  BrowserState,
  GetStateOptions,
  InteractiveElement,
  ScrollPosition,
  TabInfo,
} from "./types";

/** Selectors for interactive elements */
const INTERACTIVE_SELECTORS = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="searchbox"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  "[onclick]",
  "[tabindex]",
].join(", ");

interface RawElementInfo {
  tag: string;
  role: string;
  name: string;
  text: string;
  visible: boolean;
  enabled: boolean;
  attributes: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  // Selector info for server-side storage
  xpath: string;
  cssPath: string;
  fingerprint: string | null;
  // For generating ref
  refBase: string;
  // Fingerprint data for validation
  fingerprintData: {
    tagName: string;
    role?: string;
    type?: string;
    name?: string;
    placeholder?: string;
  };
}

/**
 * Extract interactive elements from the page WITHOUT modifying the DOM
 * Returns raw element info including selectors for server-side ref storage
 */
async function extractInteractiveElementsRaw(
  page: Page,
): Promise<RawElementInfo[]> {
  return await page.evaluate((selector) => {
    // Helper functions (must be inside evaluate)
    const generateXPath = (element: Element): string => {
      const parts: string[] = [];
      let current: Element | null = element;

      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let index = 1;
        let sibling: Element | null = current.previousElementSibling;

        while (sibling) {
          if (sibling.tagName === current.tagName) {
            index++;
          }
          sibling = sibling.previousElementSibling;
        }

        const tagName = current.tagName.toLowerCase();
        parts.unshift(`${tagName}[${index}]`);
        current = current.parentElement;
      }

      return `/${parts.join("/")}`;
    };

    const generateCssPath = (element: Element): string => {
      const parts: string[] = [];
      let current: Element | null = element;

      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let selector = current.tagName.toLowerCase();

        const id = current.getAttribute("id");
        if (id) {
          try {
            if (document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
              parts.unshift(`#${CSS.escape(id)}`);
              break;
            }
          } catch {
            // Invalid ID, skip
          }
        }

        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children);
          const sameTagSiblings = siblings.filter(
            (s) => s.tagName === current!.tagName,
          );
          if (sameTagSiblings.length > 1) {
            const index = sameTagSiblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }

        parts.unshift(selector);
        current = current.parentElement;
      }

      return parts.join(" > ");
    };

    const generateFingerprint = (element: Element): string | null => {
      const tag = element.tagName.toLowerCase();
      const attrs: string[] = [];

      const type = element.getAttribute("type");
      const name = element.getAttribute("name");
      const placeholder = element.getAttribute("placeholder");
      const role = element.getAttribute("role");
      const ariaLabel = element.getAttribute("aria-label");
      const dataTestId = element.getAttribute("data-testid");

      if (dataTestId) {
        return `[data-testid="${CSS.escape(dataTestId)}"]`;
      }

      if (type) attrs.push(`[type="${CSS.escape(type)}"]`);
      if (name) attrs.push(`[name="${CSS.escape(name)}"]`);
      if (placeholder) attrs.push(`[placeholder="${CSS.escape(placeholder)}"]`);
      if (role) attrs.push(`[role="${CSS.escape(role)}"]`);
      if (ariaLabel) attrs.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);

      if (attrs.length === 0) {
        return null;
      }

      return tag + attrs.join("");
    };

    const normalizeText = (value?: string | null) =>
      value?.replace(/\s+/g, " ").trim() ?? "";

    const getAriaLabelledbyText = (el: HTMLElement) => {
      const ids = el.getAttribute("aria-labelledby");
      if (!ids) {
        return "";
      }
      const parts = ids
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((node): node is HTMLElement => Boolean(node))
        .map((node) => normalizeText(node.textContent))
        .filter(Boolean);
      return parts.join(" ");
    };

    const getAssociatedLabel = (el: HTMLElement) => {
      const inputEl = el as HTMLInputElement;
      if ("labels" in inputEl && inputEl.labels?.length) {
        const labels = Array.from(inputEl.labels)
          .map((label) => normalizeText(label.textContent))
          .filter(Boolean);
        if (labels.length) {
          return labels.join(" ");
        }
      }

      const wrapped = el.closest("label");
      if (wrapped) {
        const text = normalizeText(wrapped.textContent);
        if (text) {
          return text;
        }
      }

      const id = el.getAttribute("id");
      if (id) {
        const selector = `label[for="${CSS.escape(id)}"]`;
        const label = document.querySelector(selector);
        if (label) {
          const text = normalizeText(label.textContent);
          if (text) {
            return text;
          }
        }
      }

      return "";
    };

    const normalizeBase = (value: string) => {
      const trimmed = value.trim().toLowerCase();
      const normalized = trimmed.replace(/[^a-z0-9_-]+/g, "-");
      return normalized.length > 0 ? normalized : "element";
    };

    const getElementBase = (el: HTMLElement) => {
      const role = el.getAttribute("role");
      if (role) {
        return normalizeBase(role);
      }
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "input") {
        const type = (el as HTMLInputElement).type;
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "submit" || type === "button") return "button";
        return "input";
      }
      if (tag === "textarea") return "textarea";
      if (tag === "select") return "select";
      return normalizeBase(tag);
    };

    const elements = Array.from(document.querySelectorAll(selector));
    const results: RawElementInfo[] = [];

    for (const el of elements) {
      const htmlEl = el as HTMLElement;

      // Skip hidden elements
      const style = window.getComputedStyle(htmlEl);
      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }

      const rect = htmlEl.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        const tag = htmlEl.tagName.toLowerCase();
        if (!["input", "textarea", "select"].includes(tag)) {
          continue;
        }
      }

      const isVisible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        (rect.width > 0 || rect.height > 0);

      // Determine role
      let role = htmlEl.getAttribute("role") || "";
      if (!role) {
        const tag = htmlEl.tagName.toLowerCase();
        if (tag === "a") role = "link";
        else if (tag === "button") role = "button";
        else if (tag === "input") {
          const type = (htmlEl as HTMLInputElement).type;
          if (type === "checkbox") role = "checkbox";
          else if (type === "radio") role = "radio";
          else if (type === "submit" || type === "button") role = "button";
          else role = "textbox";
        } else if (tag === "textarea") role = "textbox";
        else if (tag === "select") role = "combobox";
        else role = tag;
      }

      const ariaLabel = htmlEl.getAttribute("aria-label") || "";
      const labelledBy = getAriaLabelledbyText(htmlEl);
      const labelText = getAssociatedLabel(htmlEl);
      const placeholder = htmlEl.getAttribute("placeholder") || "";
      const title = htmlEl.getAttribute("title") || "";
      const fieldName = htmlEl.getAttribute("name") || "";
      let valueText = "";
      let isChecked = false;

      if (htmlEl instanceof HTMLInputElement) {
        if (htmlEl.type === "checkbox" || htmlEl.type === "radio") {
          isChecked = htmlEl.checked;
        } else {
          valueText = htmlEl.value || "";
        }
      } else if (htmlEl instanceof HTMLTextAreaElement) {
        valueText = htmlEl.value || "";
      } else if (htmlEl instanceof HTMLSelectElement) {
        const selected = Array.from(htmlEl.selectedOptions)
          .map((option) => option.value || option.textContent || "")
          .filter(Boolean);
        valueText = selected.join(", ");
      }

      if (valueText.length > 120) {
        valueText = `${valueText.slice(0, 120)}...`;
      }

      // Get accessible name
      const name =
        ariaLabel ||
        labelledBy ||
        labelText ||
        title ||
        placeholder ||
        fieldName ||
        (htmlEl as HTMLInputElement).value ||
        "";

      // Get visible text
      const text = htmlEl.textContent?.trim().slice(0, 100) || "";

      // Get relevant attributes
      const attributes: Record<string, string> = {};
      if (htmlEl.getAttribute("href"))
        attributes.href = htmlEl.getAttribute("href")!;
      if (placeholder) attributes.placeholder = placeholder;
      if (labelText) attributes.label = labelText;
      if (htmlEl.getAttribute("type"))
        attributes.type = htmlEl.getAttribute("type")!;
      if (fieldName) attributes.name = fieldName;
      if (htmlEl.getAttribute("id")) attributes.id = htmlEl.getAttribute("id")!;
      if (valueText) attributes.value = valueText;
      if (isChecked) attributes.checked = "true";

      // Generate selectors
      const xpath = generateXPath(htmlEl);
      const cssPath = generateCssPath(htmlEl);
      const fingerprint = generateFingerprint(htmlEl);

      results.push({
        tag: htmlEl.tagName.toLowerCase(),
        role,
        name: name || text.slice(0, 50),
        text,
        visible: isVisible,
        enabled: !(htmlEl as HTMLInputElement).disabled,
        attributes,
        boundingBox: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        xpath,
        cssPath,
        fingerprint,
        refBase: getElementBase(htmlEl),
        fingerprintData: {
          tagName: htmlEl.tagName.toLowerCase(),
          role: role || undefined,
          type: htmlEl.getAttribute("type") || undefined,
          name: fieldName || undefined,
          placeholder: placeholder || undefined,
        },
      });
    }

    return results;
  }, INTERACTIVE_SELECTORS);
}

/**
 * Extract interactive elements and store refs in the provided store
 * Returns InteractiveElement array with assigned refs
 */
export async function extractInteractiveElements(
  page: Page,
  refStore: ElementRefStore,
): Promise<InteractiveElement[]> {
  const rawElements = await extractInteractiveElementsRaw(page);

  // Clear and rebuild the ref store
  refStore.clear();

  // Track used refs and counters for generating unique refs
  const counters: Record<string, number> = {};

  return rawElements.map((raw, index) => {
    // Generate unique ref
    const base = raw.refBase;
    const counter = counters[base] ?? 0;
    const ref = `${base}_${counter}`;
    counters[base] = counter + 1;

    // Store selectors for later resolution
    const selectors: ElementSelectors = {
      xpath: raw.xpath,
      cssPath: raw.cssPath,
      fingerprint: raw.fingerprint ?? undefined,
    };

    refStore.set(ref, index, selectors, raw.fingerprintData);

    return {
      index,
      role: raw.role,
      name: raw.name,
      text: raw.text,
      ref,
      visible: raw.visible,
      enabled: raw.enabled,
      boundingBox: raw.boundingBox === null ? undefined : raw.boundingBox,
      attributes: raw.attributes,
    };
  });
}

/**
 * Build a text representation of the page structure
 */
async function buildAccessibilityTree(
  page: Page,
  maxLines?: number,
): Promise<string> {
  return await page.evaluate((limit) => {
    const lines: string[] = [];

    function traverse(node: Element, depth: number): void {
      const indent = "  ".repeat(depth);
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute("role") || "";

      // Skip script, style, etc
      if (["script", "style", "noscript", "svg", "path"].includes(tag)) {
        return;
      }

      // Build line
      let line = `${indent}- ${role || tag}`;

      // Add text content for leaf nodes
      if (node.children.length === 0) {
        const text = node.textContent?.trim().slice(0, 50);
        if (text) {
          line += ` "${text}"`;
        }
      } else {
        // For non-leaf, show aria-label or similar
        const label =
          node.getAttribute("aria-label") || node.getAttribute("title");
        if (label) {
          line += ` "${label}"`;
        }
      }

      // Add relevant attributes
      const id = node.getAttribute("id");
      if (id) line += ` #${id}`;

      const className = node.className;
      if (className && typeof className === "string") {
        const classes = className.split(" ").slice(0, 2).join(".");
        if (classes) line += ` .${classes}`;
      }

      lines.push(line);

      // Recurse children (limit depth for performance)
      if (depth < 6) {
        for (const child of Array.from(node.children)) {
          traverse(child, depth + 1);
        }
      }
    }

    traverse(document.body, 0);
    if (!limit || limit <= 0) {
      return lines.join("\n");
    }
    return lines.slice(0, limit).join("\n");
  }, maxLines ?? 0);
}

/**
 * Get scroll position information
 */
async function getScrollPosition(page: Page): Promise<ScrollPosition> {
  return await page.evaluate(() => {
    const scrollTop = window.scrollY;
    const viewportHeight = window.innerHeight;
    const totalHeight = document.documentElement.scrollHeight;

    return {
      scrollTop,
      pixelsAbove: scrollTop,
      pixelsBelow: Math.max(0, totalHeight - scrollTop - viewportHeight),
      totalHeight,
      viewportHeight,
    };
  });
}

/**
 * Get information about all open tabs/pages
 */
async function getTabsInfo(
  context: BrowserContext,
  currentPage: Page,
): Promise<TabInfo[]> {
  const pages = context.pages();
  const tabs: TabInfo[] = [];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    tabs.push({
      id: `tab-${i}`,
      url: p.url(),
      title: await p.title().catch(() => ""),
      active: p === currentPage,
    });
  }

  return tabs;
}

export function formatStateText(state: BrowserState): string {
  const lines: string[] = [
    `URL: ${state.url}`,
    `Title: ${state.title}`,
    `Tabs: ${state.tabs.length}`,
    "",
    `Scroll: ${state.scrollPosition.pixelsAbove}px above, ${state.scrollPosition.pixelsBelow}px below`,
    "",
    "Interactive Elements:",
  ];

  if (state.elements.length === 0) {
    lines.push("  (none)");
  } else {
    for (const el of state.elements) {
      const attrs = Object.entries(el.attributes)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      lines.push(
        `  [${el.index}] ref=${el.ref} ${el.role} "${el.name || el.text}"${attrs ? ` (${attrs})` : ""}${el.enabled ? "" : " [disabled]"}`,
      );
    }
  }

  if (state.accessibilityTree) {
    lines.push("", "Accessibility Tree:");
    lines.push(state.accessibilityTree);
  }

  const consoleErrors = state.errors?.console ?? [];
  const networkErrors = state.errors?.network ?? [];
  if (consoleErrors.length > 0 || networkErrors.length > 0) {
    lines.push("", "Errors:");
    if (consoleErrors.length > 0) {
      lines.push("Console:");
      for (const entry of consoleErrors.slice(-10)) {
        lines.push(`  - ${entry}`);
      }
    }
    if (networkErrors.length > 0) {
      lines.push("Network:");
      for (const event of networkErrors.slice(-10)) {
        if (event.type === "failed") {
          lines.push(
            `  - failed ${event.method} ${event.url}${event.failureText ? ` (${event.failureText})` : ""}`,
          );
        } else if (event.status) {
          lines.push(`  - ${event.status} ${event.method} ${event.url}`);
        } else {
          lines.push(`  - ${event.type} ${event.method} ${event.url}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Get the current state of the browser/page
 * Now requires a refStore to store element references server-side
 */
export async function getState(
  page: Page,
  context: BrowserContext,
  refStore: ElementRefStore,
  options: GetStateOptions = {},
): Promise<BrowserState> {
  const {
    includeScreenshot = false,
    includeElements = true,
    includeTree = true,
    elementsLimit,
    elementsHead,
    elementsTail,
    treeLimit,
    treeHead,
    treeTail,
  } = options;

  // Wait for page to be stable
  await page.waitForLoadState("domcontentloaded");

  // Extract state in parallel - NO DOM MODIFICATION
  // Always rebuild refs even if elements aren't returned.
  const [
    url,
    title,
    elementsSnapshot,
    accessibilityTree,
    scrollPosition,
    tabs,
  ] = await Promise.all([
    page.url(),
    page.title(),
    extractInteractiveElements(page, refStore),
    includeTree ? buildAccessibilityTree(page, treeLimit) : "",
    getScrollPosition(page),
    getTabsInfo(context, page),
  ]);
  const elements = includeElements ? elementsSnapshot : [];

  // Optional screenshot
  let screenshot: string | undefined;
  if (includeScreenshot) {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 80,
    });
    screenshot = buffer.toString("base64");
  }

  return {
    url,
    title,
    tabs,
    elements: sliceList(elements, {
      head: elementsHead,
      tail: elementsTail,
      limit: elementsLimit,
    }),
    accessibilityTree: sliceTree(accessibilityTree, {
      head: treeHead,
      tail: treeTail,
      limit: treeLimit,
    }),
    scrollPosition,
    screenshot,
  };
}

function sliceList<T>(
  items: T[],
  options: { head?: number; tail?: number; limit?: number },
): T[] {
  const total = items.length;
  const head = options.head;
  const tail = options.tail;
  const limit = options.limit;

  if (head && tail) {
    const headItems = items.slice(0, head);
    const tailStart = Math.max(total - tail, headItems.length);
    const tailItems = items.slice(tailStart);
    return [...headItems, ...tailItems];
  }

  if (head) {
    return items.slice(0, head);
  }

  if (tail) {
    return items.slice(Math.max(0, total - tail));
  }

  if (limit) {
    return items.slice(0, limit);
  }

  return items;
}

function sliceTree(
  tree: string,
  options: { head?: number; tail?: number; limit?: number },
): string {
  if (!tree) {
    return tree;
  }

  const lines = tree.split("\n");
  const sliced = sliceList(lines, options);
  return sliced.join("\n");
}

/**
 * @deprecated No longer injects refs into DOM - refs are now stored server-side
 * This function is kept for backwards compatibility but does nothing
 */
export async function injectElementRefs(_page: Page): Promise<number> {
  // No-op: refs are now stored server-side in ElementRefStore
  // This function is kept for API compatibility but should not be used
  return 0;
}
