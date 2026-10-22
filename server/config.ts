import fs from "node:fs";
import path from "node:path";

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const rootDir = process.cwd();
loadDotEnv(path.join(rootDir, ".env"));

const numberFromEnv = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  rootDir,
  version: "0.3.0",
  port: numberFromEnv("PORT", 8787),
  host: process.env.HOST || "127.0.0.1",
  appOrigin: process.env.APP_ORIGIN || "http://127.0.0.1:5173",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  dataDir: path.resolve(rootDir, process.env.DATA_DIR || "data"),
  appSecret: process.env.APP_SECRET || process.env.LUMEN_MASTER_KEY || "",
  defaultProvider: process.env.DEFAULT_PROVIDER || "mock",
  concurrency: Math.max(1, Math.min(4, numberFromEnv("GENERATION_CONCURRENCY", 2))),
  maxUploadBytes: numberFromEnv("MAX_UPLOAD_MB", 20) * 1024 * 1024,
  maxBatchUploadBytes: numberFromEnv("MAX_BATCH_UPLOAD_MB", 120) * 1024 * 1024,
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  pollIntervalMs: numberFromEnv("PROVIDER_POLL_MS", 2500),
  imageTimeoutMs: numberFromEnv("TASK_TIMEOUT_IMAGE_SEC", 180) * 1000,
  videoTimeoutMs: numberFromEnv("TASK_TIMEOUT_VIDEO_SEC", 900) * 1000,
  storyboardTimeoutMs: numberFromEnv("TASK_TIMEOUT_STORYBOARD_SEC", 1800) * 1000,
  mediaRetentionDays: numberFromEnv("MEDIA_RETENTION_DAYS", 7),
};

export const paths = {
  providers: path.join(config.dataDir, "providers.json"),
  jobs: path.join(config.dataDir, "jobs.json"),
  masterKey: path.join(config.dataDir, "master.key"),
  assets: path.join(config.dataDir, "assets"),
  uploads: path.join(config.dataDir, "uploads"),
  outputs: path.join(config.dataDir, "outputs"),
  tmp: path.join(config.dataDir, "tmp"),
};

export function ensureDataDirs() {
  for (const dir of [config.dataDir, paths.assets, paths.uploads, paths.outputs, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function mediaUrl(kind: "uploads" | "outputs" | "assets", relativePath: string) {
  const clean = relativePath.split(path.sep).join("/").replace(/^\/+/, "");
  const base = config.publicBaseUrl || "";
  return `${base}/media/${kind}/${clean}`;
}

export function absoluteUrl(url: string) {
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  const base = config.publicBaseUrl || `http://127.0.0.1:${config.port}`;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}
