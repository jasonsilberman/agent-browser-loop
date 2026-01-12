import type { Locator, Page } from "playwright";

/**
 * Selector strategies for locating an element
 * Multiple strategies provide resilience if one fails
 */
export interface ElementSelectors {
  /** XPath from document root */
  xpath: string;
  /** CSS selector path */
  cssPath: string;
  /** Fingerprint-based selector using stable attributes */
  fingerprint?: string;
}

/**
 * Stored reference to an element
 */
export interface StoredElementRef {
  /** The ref string (e.g., "button_0") */
  ref: string;
  /** Sequential index */
  index: number;
  /** Multiple selector strategies */
  selectors: ElementSelectors;
  /** Element fingerprint for validation */
  fingerprint: {
    tagName: string;
    role?: string;
    type?: string;
    name?: string;
    placeholder?: string;
  };
}

/**
 * Server-side store for element references
 * Avoids DOM modification that causes React hydration errors
 */
export class ElementRefStore {
  private refMap = new Map<string, StoredElementRef>();
  private indexMap = new Map<number, StoredElementRef>();
  private snapshotVersion = 0;

  /**
   * Clear all stored refs (call before new snapshot)
   */
  clear(): void {
    this.refMap.clear();
    this.indexMap.clear();
    this.snapshotVersion++;
  }

  /**
   * Get current snapshot version
   */
  getVersion(): number {
    return this.snapshotVersion;
  }

  /**
   * Store a ref for an element
   */
  set(
    ref: string,
    index: number,
    selectors: ElementSelectors,
    fingerprint: StoredElementRef["fingerprint"],
  ): void {
    const stored: StoredElementRef = { ref, index, selectors, fingerprint };
    this.refMap.set(ref, stored);
    this.indexMap.set(index, stored);
  }

  /**
   * Get stored ref by ref string
   */
  getByRef(ref: string): StoredElementRef | undefined {
    return this.refMap.get(ref);
  }

  /**
   * Get stored ref by index
   */
  getByIndex(index: number): StoredElementRef | undefined {
    return this.indexMap.get(index);
  }

  /**
   * Resolve a Playwright locator for an element by ref or index
   */
  async resolveLocator(
    page: Page,
    options: { ref?: string; index?: number },
  ): Promise<Locator> {
    let stored: StoredElementRef | undefined;

    if (options.ref) {
      stored = this.refMap.get(options.ref);
      if (!stored) {
        throw new Error(
          `Unknown ref: ${options.ref}. Call getState() first to snapshot elements.`,
        );
      }
    } else if (options.index !== undefined) {
      stored = this.indexMap.get(options.index);
      if (!stored) {
        throw new Error(
          `Unknown index: ${options.index}. Call getState() first to snapshot elements.`,
        );
      }
    } else {
      throw new Error("Must provide either ref or index");
    }

    const pickMatching = async (locator: Locator): Promise<Locator | null> => {
      const count = await locator.count();
      if (count === 0) {
        return null;
      }

      for (let i = 0; i < count; i++) {
        const candidate = locator.nth(i);
        const matches = await candidate.evaluate((el, fingerprint) => {
          const element = el as HTMLElement;
          if (
            fingerprint.tagName &&
            element.tagName.toLowerCase() !== fingerprint.tagName
          ) {
            return false;
          }
          if (
            fingerprint.role &&
            element.getAttribute("role") !== fingerprint.role
          ) {
            return false;
          }
          if (
            fingerprint.type &&
            element.getAttribute("type") !== fingerprint.type
          ) {
            return false;
          }
          if (
            fingerprint.name &&
            element.getAttribute("name") !== fingerprint.name
          ) {
            return false;
          }
          if (
            fingerprint.placeholder &&
            element.getAttribute("placeholder") !== fingerprint.placeholder
          ) {
            return false;
          }
          return true;
        }, stored!.fingerprint);

        if (matches) {
          return candidate;
        }
      }

      return null;
    };

    const selectors = stored.selectors;

    const xpathLocator = page.locator(`xpath=${selectors.xpath}`);
    const xpathMatch = await pickMatching(xpathLocator);
    if (xpathMatch) {
      return xpathMatch;
    }

    const cssLocator = page.locator(selectors.cssPath);
    const cssMatch = await pickMatching(cssLocator);
    if (cssMatch) {
      return cssMatch;
    }

    let fingerprintLocator: Locator | null = null;
    if (selectors.fingerprint) {
      const tagPrefix = stored.fingerprint.tagName || "";
      const fingerprintSelector = selectors.fingerprint.startsWith("[")
        ? `${tagPrefix}${selectors.fingerprint}`
        : selectors.fingerprint;
      fingerprintLocator = page.locator(fingerprintSelector);
      const fingerprintMatch = await pickMatching(fingerprintLocator);
      if (fingerprintMatch) {
        return fingerprintMatch;
      }
    }

    // Last resort: fall back to first match from the best available selector.
    if (await xpathLocator.count()) {
      return xpathLocator.first();
    }
    if (await cssLocator.count()) {
      return cssLocator.first();
    }
    if (fingerprintLocator && (await fingerprintLocator.count())) {
      return fingerprintLocator.first();
    }

    throw new Error(
      `Unable to resolve element for ref ${stored.ref}. Call getState() again to refresh element refs.`,
    );
  }

  /**
   * Get all stored refs
   */
  getAllRefs(): StoredElementRef[] {
    return Array.from(this.refMap.values());
  }
}
