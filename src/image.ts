import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function looksLikeImage(b: Buffer, mime: string): boolean {
  const hex = (n: number) => b.subarray(0, n).toString("hex");
  if (mime === "image/png") return hex(8) === "89504e470d0a1a0a";
  if (mime === "image/jpeg") return hex(3) === "ffd8ff";
  if (mime === "image/gif") return b.subarray(0, 4).toString("latin1") === "GIF8";
  return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
}

type Resizer = (input: string, size: number, out: string) => Promise<void>;

const exists = (cmd: string, args: string[]) => run(cmd, args).then(() => true, () => false);

/** `sips` ships with macOS. Elsewhere use ImageMagick 7 (`magick`) or 6 (`convert`) when installed. */
async function findResizer(): Promise<Resizer | undefined> {
  if (process.platform === "darwin")
    return (input, size, out) =>
      run("sips", ["-Z", String(size), "-s", "format", "jpeg", "-s", "formatOptions", "70", input, "--out", out]).then(() => undefined);
  // On Windows `convert` is a system disk tool, not ImageMagick, so only `magick` is tried there.
  for (const cmd of process.platform === "win32" ? ["magick"] : ["magick", "convert"]) {
    if (!(await exists(cmd, ["-version"]))) continue;
    return (input, size, out) =>
      run(cmd, [input, "-resize", `${size}x${size}>`, "-background", "white", "-alpha", "remove", "-alpha", "off", "-quality", "70", out]).then(() => undefined);
  }
  return undefined;
}

// base64 is 4/3 of the bytes and percent-encoding the +, / and = adds roughly another 6%.
const ENCODED_PER_RAW_BYTE = 1.45;

/**
 * Reads a local image and returns a data: URI no larger than `maxRawBytes` of source data.
 * Oversized images are downscaled/recompressed to JPEG (transparency is lost) with macOS `sips`,
 * or with ImageMagick on other systems.
 */
export async function imageToDataUri(path: string, maxRawBytes: number): Promise<{ uri: string; note?: string }> {
  const ext = extname(path).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`Unsupported image type "${ext}" (use png, jpg, gif or webp): ${path}`);

  let bytes = await readFile(path);
  if (!looksLikeImage(bytes, mime))
    throw new Error(`${path} is not really a ${mime} (file signature mismatch); refusing to import it.`);
  if (bytes.length <= maxRawBytes) return { uri: `data:${mime};base64,${bytes.toString("base64")}` };

  const resizer = await findResizer();
  if (!resizer)
    throw new Error(
      `Image is ${bytes.length} bytes (limit ${maxRawBytes}). Shrink it first, or install ImageMagick so it can be downscaled.`,
    );
  const dir = await mkdtemp(join(tmpdir(), "upnote-mcp-"));
  try {
    for (const size of [1600, 1200, 900, 700, 500, 350]) {
      const out = join(dir, `out-${size}.jpg`);
      await resizer(path, size, out);
      bytes = await readFile(out);
      if (bytes.length <= maxRawBytes)
        return {
          uri: `data:image/jpeg;base64,${bytes.toString("base64")}`,
          note: `downscaled to max ${size}px JPEG (${bytes.length} bytes) to fit the URL limit`,
        };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  throw new Error(`Cannot shrink ${path} below ${maxRawBytes} bytes; use a smaller image.`);
}

export const rawBudget = (maxUrlLength: number, count: number) =>
  Math.floor((maxUrlLength - 3000) / count / ENCODED_PER_RAW_BYTE);

const INTERNAL = "http://localhost:9425/images/";

/**
 * Expands `![alt](http://localhost:9425/images/<id>.png){width=40% align=center}` into the HTML
 * UpNote preserves. Width only sticks on images UpNote already stores (see import_images).
 */
export function expandImageShortcuts(md: string): string {
  return md.replace(
    /!\[([^\]]*)\]\((http:\/\/localhost:9425\/images\/[^)\s]+)\)\{([^}]*)\}/g,
    (_m, alt: string, url: string, attrs: string) => {
      const width = /width\s*=\s*(\d{1,3})%?/.exec(attrs)?.[1];
      const align = /align\s*=\s*(left|center|right)/.exec(attrs)?.[1];
      const img = `<img src="${url}"${alt ? ` alt="${alt.replace(/"/g, "&quot;")}"` : ""}${width ? ` width="${width}%"` : ""}>`;
      return align && align !== "left" ? `<div style="text-align:${align}">${img}</div>` : img;
    },
  );
}

export const internalImageUrls = (html: string): string[] =>
  [...html.matchAll(/<img[^>]*\ssrc="(http:\/\/localhost:9425\/images\/[^"]+)"/g)].map((m) => m[1]!).filter((u) => u.startsWith(INTERNAL));
