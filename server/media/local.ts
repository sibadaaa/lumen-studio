import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config, paths } from "../config.js";

export interface LocalMedia {
  file: string;
  mime: string;
  buffer?: Buffer;
}

const imageMimeByExt: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function mimeFor(file: string) {
  return imageMimeByExt[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function inside(base: string, target: string) {
  const relative = path.relative(base, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Resolve a same-origin media URL to a file on disk. Returns null for remote URLs. */
export function resolveLocalMedia(url: string): LocalMedia | null {
  if (!url || /^https?:\/\//i.test(url)) return null;
  const pathname = url.split("?")[0].split("#")[0];
  if (pathname.startsWith("data:")) {
    const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(url);
    if (!match) return null;
    const mime = match[1] || "application/octet-stream";
    const buffer = /;base64,/i.test(url) ? Buffer.from(match[2], "base64") : Buffer.from(decodeURIComponent(match[2]));
    return { file: "", mime, buffer };
  }

  let base: string;
  let relative: string;
  if (pathname.startsWith("/media/")) {
    const [, , kind, ...rest] = pathname.split("/");
    const roots: Record<string, string> = {
      uploads: paths.uploads,
      outputs: paths.outputs,
      assets: paths.assets,
    };
    const root = roots[kind];
    if (!root) return null;
    base = root;
    relative = rest.join("/");
  } else if (pathname.startsWith("/assets/")) {
    base = path.join(config.rootDir, "public", "assets");
    relative = pathname.slice("/assets/".length);
  } else if (pathname.startsWith("/")) {
    base = path.join(config.rootDir, "public");
    relative = pathname.slice(1);
  } else {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const file = path.resolve(base, decoded);
  if (!inside(base, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return { file, mime: mimeFor(file) };
}

export function safeMediaFile(kind: string, relativePath: string): string | null {
  const roots: Record<string, string> = {
    uploads: paths.uploads,
    outputs: paths.outputs,
    assets: paths.assets,
  };
  const base = roots[kind];
  if (!base) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }
  const file = path.resolve(base, decoded);
  if (!inside(base, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

export async function safeFetch(url: string, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  let current = url;
  for (let index = 0; index <= maxRedirects; index += 1) {
    assertFetchableUrl(current);
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`媒体重定向缺少 Location（HTTP ${response.status}）`);
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error("媒体重定向次数过多");
}

export function assertFetchableUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("无效的媒体 URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("媒体 URL 必须使用 http(s)");
  if (isPrivateHost(parsed.hostname) && process.env.LUMEN_ALLOW_PRIVATE_FETCH !== "true") {
    throw new Error("出于 SSRF 防护，拒绝访问私网媒体 URL（可设置 LUMEN_ALLOW_PRIVATE_FETCH=true 用于本地调试）");
  }
}

export async function readMediaBytes(url: string, maxBytes = 512 * 1024 * 1024): Promise<LocalMedia & { buffer: Buffer }> {
  const local = resolveLocalMedia(url);
  if (local) {
    if (local.buffer) return { ...local, buffer: local.buffer };
    const stat = fs.statSync(local.file);
    if (stat.size > maxBytes) throw new Error(`媒体文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`);
    return { ...local, buffer: fs.readFileSync(local.file) };
  }
  const response = await safeFetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`下载媒体失败：HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error(`媒体文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error("媒体文件超过限制");
  return {
    file: "",
    mime: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream",
    buffer,
  };
}

export async function readImageDataUrl(url: string, maxBytes = 20 * 1024 * 1024): Promise<string> {
  const media = await readMediaBytes(url, maxBytes);
  if (!media.mime.startsWith("image/")) throw new Error(`需要图片素材，收到 ${media.mime}`);
  return `data:${media.mime};base64,${media.buffer.toString("base64")}`;
}

export async function downloadToFile(
  url: string,
  destination: string,
  options: { headers?: Record<string, string>; maxBytes?: number } = {}
) {
  const maxBytes = options.maxBytes ?? 1024 * 1024 * 1024;
  const response = await safeFetch(url, {
    headers: options.headers,
    signal: AbortSignal.timeout(30 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载生成结果失败：HTTP ${response.status}`);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("生成结果超过本地存储限制");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, fs.createWriteStream(destination));
  return {
    size: fs.statSync(destination).size,
    mime: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream",
  };
}

export function writeBuffer(destination: string, buffer: Buffer) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
  return buffer.byteLength;
}
