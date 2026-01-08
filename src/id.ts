/**
 * Friendly ID generator using common words (similar to GitHub's style)
 * Generates IDs like "swift-fox", "calm-river", "bold-star"
 * When all combinations are used, appends numbers: "swift-fox-1", "swift-fox-2"
 */

const ADJECTIVES = [
  "swift",
  "calm",
  "bold",
  "warm",
  "cool",
  "dark",
  "pale",
  "keen",
  "soft",
  "wild",
  "pure",
  "deep",
  "fair",
  "glad",
  "kind",
  "safe",
  "wise",
  "fast",
  "free",
  "true",
  "blue",
  "gold",
  "gray",
  "pink",
  "teal",
];

const NOUNS = [
  "fox",
  "owl",
  "bee",
  "elm",
  "oak",
  "sun",
  "sky",
  "bay",
  "gem",
  "arc",
  "orb",
  "fin",
  "ray",
  "dew",
  "ash",
  "ivy",
  "jet",
  "ink",
  "fog",
  "ice",
  "fir",
  "cod",
  "eel",
  "ant",
  "bat",
];

export type IdGenerator = {
  next: () => string;
  release: (id: string) => void;
};

/**
 * Creates a friendly ID generator that tracks used IDs
 * and ensures uniqueness within the given set
 */
export function createIdGenerator(existingIds?: Set<string>): IdGenerator {
  const used = new Set<string>(existingIds);

  function next(): string {
    // Try random combinations first (up to reasonable attempts)
    const maxAttempts = ADJECTIVES.length * NOUNS.length * 2;
    for (let i = 0; i < maxAttempts; i++) {
      const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
      const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
      const id = `${adj}-${noun}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }

    // Most combinations used, try systematically with numbers
    let counter = 1;
    while (true) {
      for (let i = 0; i < maxAttempts; i++) {
        const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
        const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        const id = `${adj}-${noun}-${counter}`;
        if (!used.has(id)) {
          used.add(id);
          return id;
        }
      }
      counter++;
    }
  }

  function release(id: string): void {
    used.delete(id);
  }

  return { next, release };
}
