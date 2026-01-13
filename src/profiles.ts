import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { StorageState } from "./types";

// ============================================================================
// Profile Schema & Types
// ============================================================================

const profileMetaSchema = z.object({
  createdAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
  description: z.string().optional(),
  origins: z.array(z.string()).optional(),
});

const storageStateSchema = z.object({
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string(),
        expires: z.number(),
        httpOnly: z.boolean(),
        secure: z.boolean(),
        sameSite: z.enum(["Strict", "Lax", "None"]),
      }),
    )
    .default([]),
  origins: z
    .array(
      z.object({
        origin: z.string(),
        localStorage: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .default([]),
      }),
    )
    .default([]),
});

const profileSchema = z.object({
  _meta: profileMetaSchema.optional(),
  cookies: storageStateSchema.shape.cookies,
  origins: storageStateSchema.shape.origins,
});

export type ProfileMeta = z.infer<typeof profileMetaSchema>;
export type Profile = z.infer<typeof profileSchema>;

export interface ProfileInfo {
  name: string;
  scope: "local" | "local-private" | "global";
  path: string;
  meta?: ProfileMeta;
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the global profiles directory
 * Uses XDG_CONFIG_HOME or falls back to ~/.config
 */
function getGlobalProfilesDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  const base = xdgConfig || path.join(os.homedir(), ".config");
  return path.join(base, "agent-browser", "profiles");
}

/**
 * Get the local profiles directory (project-scoped)
 */
function getLocalProfilesDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), ".agent-browser", "profiles");
}

/**
 * Get the local private profiles directory (gitignored)
 */
function getLocalPrivateProfilesDir(cwd?: string): string {
  return path.join(getLocalProfilesDir(cwd), ".private");
}

/**
 * Resolve profile path by name, checking local first then global
 * Returns null if not found
 */
export function resolveProfilePath(
  name: string,
  cwd?: string,
): { path: string; scope: "local" | "local-private" | "global" } | null {
  // Check local private first
  const localPrivatePath = path.join(
    getLocalPrivateProfilesDir(cwd),
    `${name}.json`,
  );
  if (fs.existsSync(localPrivatePath)) {
    return { path: localPrivatePath, scope: "local-private" };
  }

  // Check local
  const localPath = path.join(getLocalProfilesDir(cwd), `${name}.json`);
  if (fs.existsSync(localPath)) {
    return { path: localPath, scope: "local" };
  }

  // Check global
  const globalPath = path.join(getGlobalProfilesDir(), `${name}.json`);
  if (fs.existsSync(globalPath)) {
    return { path: globalPath, scope: "global" };
  }

  return null;
}

/**
 * Get the path where a new profile should be saved
 */
export function getProfileSavePath(
  name: string,
  options?: { global?: boolean; private?: boolean; cwd?: string },
): string {
  if (options?.global) {
    return path.join(getGlobalProfilesDir(), `${name}.json`);
  }
  if (options?.private) {
    return path.join(getLocalPrivateProfilesDir(options?.cwd), `${name}.json`);
  }
  return path.join(getLocalProfilesDir(options?.cwd), `${name}.json`);
}

// ============================================================================
// Profile CRUD Operations
// ============================================================================

/**
 * List all available profiles (local + global)
 */
export function listProfiles(cwd?: string): ProfileInfo[] {
  const profiles: ProfileInfo[] = [];
  const seen = new Set<string>();

  // Helper to scan a directory
  const scanDir = (
    dir: string,
    scope: "local" | "local-private" | "global",
  ) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      // Skip .private directory when scanning local
      if (file === ".private") continue;

      const name = file.replace(/\.json$/, "");
      if (seen.has(name)) continue; // Local takes precedence
      seen.add(name);

      const profilePath = path.join(dir, file);
      try {
        const content = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
        const parsed = profileSchema.safeParse(content);
        profiles.push({
          name,
          scope,
          path: profilePath,
          meta: parsed.success ? parsed.data._meta : undefined,
        });
      } catch {
        // Invalid profile, still list it
        profiles.push({
          name,
          scope,
          path: profilePath,
        });
      }
    }
  };

  // Scan in order of precedence
  scanDir(getLocalPrivateProfilesDir(cwd), "local-private");
  scanDir(getLocalProfilesDir(cwd), "local");
  scanDir(getGlobalProfilesDir(), "global");

  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load a profile by name
 */
export function loadProfile(name: string, cwd?: string): Profile | null {
  const resolved = resolveProfilePath(name, cwd);
  if (!resolved) return null;

  try {
    const content = JSON.parse(fs.readFileSync(resolved.path, "utf-8"));
    const parsed = profileSchema.parse(content);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Get storage state from a profile (strips _meta for Playwright)
 */
export function getStorageStateFromProfile(profile: Profile): StorageState {
  return {
    cookies: profile.cookies,
    origins: profile.origins,
  };
}

/**
 * Load storage state by profile name
 */
export function loadStorageState(
  name: string,
  cwd?: string,
): StorageState | null {
  const profile = loadProfile(name, cwd);
  if (!profile) return null;
  return getStorageStateFromProfile(profile);
}

/**
 * Save a profile
 */
export function saveProfile(
  name: string,
  storageState: StorageState,
  options?: {
    global?: boolean;
    private?: boolean;
    cwd?: string;
    description?: string;
    origins?: string[];
  },
): string {
  const savePath = getProfileSavePath(name, options);
  const dir = path.dirname(savePath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // If saving to .private, ensure it's gitignored
  if (options?.private) {
    ensurePrivateDirGitignored(options?.cwd);
  }

  // Check if profile already exists to preserve metadata
  let existingMeta: ProfileMeta | undefined;
  if (fs.existsSync(savePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(savePath, "utf-8"));
      existingMeta = existing._meta;
    } catch {
      // Ignore
    }
  }

  const profile: Profile = {
    _meta: {
      createdAt: existingMeta?.createdAt || new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      description: options?.description || existingMeta?.description,
      origins: options?.origins || existingMeta?.origins,
    },
    cookies: storageState.cookies,
    origins: storageState.origins,
  };

  fs.writeFileSync(savePath, JSON.stringify(profile, null, 2));
  return savePath;
}

/**
 * Delete a profile
 */
export function deleteProfile(name: string, cwd?: string): boolean {
  const resolved = resolveProfilePath(name, cwd);
  if (!resolved) return false;

  try {
    fs.unlinkSync(resolved.path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Import a profile from an external file
 */
export function importProfile(
  name: string,
  sourcePath: string,
  options?: { global?: boolean; private?: boolean; cwd?: string },
): string {
  const content = fs.readFileSync(sourcePath, "utf-8");
  const parsed = JSON.parse(content);

  // Validate it's a valid storage state or profile
  const asProfile = profileSchema.safeParse(parsed);
  const asStorageState = storageStateSchema.safeParse(parsed);

  let storageState: StorageState;
  if (asProfile.success) {
    storageState = getStorageStateFromProfile(asProfile.data);
  } else if (asStorageState.success) {
    storageState = asStorageState.data;
  } else {
    throw new Error(
      `Invalid profile format: ${asProfile.error?.message || asStorageState.error?.message}`,
    );
  }

  return saveProfile(name, storageState, options);
}

/**
 * Update profile's lastUsedAt timestamp
 */
export function touchProfile(name: string, cwd?: string): void {
  const resolved = resolveProfilePath(name, cwd);
  if (!resolved) return;

  try {
    const content = JSON.parse(fs.readFileSync(resolved.path, "utf-8"));
    const parsed = profileSchema.parse(content);

    parsed._meta = {
      ...parsed._meta,
      lastUsedAt: new Date().toISOString(),
    };

    fs.writeFileSync(resolved.path, JSON.stringify(parsed, null, 2));
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Gitignore Helper
// ============================================================================

/**
 * Ensure .private directory is gitignored
 */
function ensurePrivateDirGitignored(cwd?: string): void {
  const agentBrowserDir = path.join(cwd || process.cwd(), ".agent-browser");
  const gitignorePath = path.join(agentBrowserDir, ".gitignore");

  // Check if .gitignore exists and contains .private
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (content.includes("profiles/.private")) {
      return;
    }
    // Append to existing
    fs.appendFileSync(
      gitignorePath,
      "\n# Private profiles (contains auth tokens)\nprofiles/.private/\n",
    );
  } else {
    // Create new .gitignore
    if (!fs.existsSync(agentBrowserDir)) {
      fs.mkdirSync(agentBrowserDir, { recursive: true });
    }
    fs.writeFileSync(
      gitignorePath,
      "# Private profiles (contains auth tokens)\nprofiles/.private/\n",
    );
  }
}

// ============================================================================
// Profile Resolution for Browser Options
// ============================================================================

/**
 * Resolve storage state from profile name or path
 * Returns the storage state to pass to browser context
 */
export function resolveStorageStateOption(
  profile?: string,
  storageStatePath?: string,
  cwd?: string,
): StorageState | string | undefined {
  // Profile takes precedence
  if (profile) {
    const storageState = loadStorageState(profile, cwd);
    if (!storageState) {
      throw new Error(`Profile not found: ${profile}`);
    }
    // Touch the profile to update lastUsedAt
    touchProfile(profile, cwd);
    return storageState;
  }

  // Fall back to storageStatePath
  if (storageStatePath) {
    return storageStatePath;
  }

  return undefined;
}
