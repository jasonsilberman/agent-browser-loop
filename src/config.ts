import { z } from "zod";
import type { BrowserCliConfig } from "./types";

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

export const browserCliConfigSchema = z.looseObject({
  headless: z.boolean().optional(),
  executablePath: z.string().optional(),
  useSystemChrome: z.boolean().optional(),
  viewportWidth: z.number().int().optional(),
  viewportHeight: z.number().int().optional(),
  userDataDir: z.string().optional(),
  timeout: z.number().int().optional(),
  captureNetwork: z.boolean().optional(),
  networkLogLimit: z.number().int().optional(),
  storageState: z.union([z.string(), storageStateSchema]).optional(),
  storageStatePath: z.string().optional(),
  saveStorageStatePath: z.string().optional(),
  serverHost: z.string().optional(),
  serverPort: z.number().int().optional(),
  serverSessionTtlMs: z.number().int().optional(),
});

export function defineBrowserConfig<T extends BrowserCliConfig>(config: T): T {
  return config;
}

export function parseBrowserConfig(input: unknown): BrowserCliConfig {
  const parsed = browserCliConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid browser config: ${parsed.error.message}`);
  }
  return parsed.data;
}
