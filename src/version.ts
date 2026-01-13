// Version is read from package.json at build/runtime
// This provides a single source of truth for the package version

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function loadVersion(): string {
  try {
    // Try to read from package.json relative to this file
    const packagePath = join(dirname(import.meta.dirname), "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
    return pkg.version;
  } catch {
    // Fallback if package.json can't be read
    return "0.0.0";
  }
}

export const VERSION = loadVersion();
