import { existsSync } from "node:fs";
import { platform } from "node:os";

/**
 * Find Chrome/Chromium executable path based on platform
 */
export function findChromeExecutable(): string | undefined {
  const os = platform();

  if (os === "darwin") {
    // macOS - prefer Chromium/Canary over Chrome (easier to distinguish)
    const macPaths = [
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      `${process.env.HOME}/Applications/Chromium.app/Contents/MacOS/Chromium`,
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
    for (const p of macPaths) {
      if (existsSync(p)) return p;
    }
  } else if (os === "linux") {
    const linuxPaths = [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/snap/bin/chromium",
    ];
    for (const p of linuxPaths) {
      if (existsSync(p)) return p;
    }
  } else if (os === "win32") {
    const winPaths = [
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    for (const p of winPaths) {
      if (p && existsSync(p)) return p;
    }
  }

  return undefined;
}
