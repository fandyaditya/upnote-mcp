import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const BASE = "upnote://x-callback-url/";

// The URL length UpNote accepts is not documented; keep a conservative, overridable cap.
// Windows passes the URL on a command line (limit 32767 chars), so its default is lower. Not verified there.
export const MAX_URL_LENGTH = Number(process.env.UPNOTE_MAX_URL_LENGTH ?? (process.platform === "win32" ? 30_000 : 100_000));

export function buildUrl(action: string, params: Record<string, string | boolean | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${BASE}${action}${qs ? `?${qs}` : ""}`;
  if (url.length > MAX_URL_LENGTH) {
    throw new Error(
      `Encoded URL is ${url.length} chars (limit ${MAX_URL_LENGTH}). Split the content into several notes.`,
    );
  }
  return url;
}

/**
 * Hands the URL to the OS, which starts UpNote with it.
 * macOS (verified): `open`; `-g` keeps UpNote from stealing focus.
 * Windows and Linux (not verified): the default URL handler. They have no background option, so UpNote may take focus.
 */
export async function openUrl(url: string, background = true): Promise<void> {
  if (process.platform === "darwin") await run("open", background ? ["-g", url] : [url]);
  else if (process.platform === "win32") await run("rundll32", ["url.dll,FileProtocolHandler", url]);
  else await run("xdg-open", [url]);
}
