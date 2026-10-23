import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AssetSaveResult, Work } from "../../shared/contracts.js";
import { paths } from "../config.js";
import { createThumbnail } from "./ffmpeg.js";
import { monthDir } from "./upload.js";
import { assetStore } from "../storage/assets.js";

const now = () => new Date().toISOString();

function sha256File(file: string) {
  const buffer = fs.readFileSync(file);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Resolve a work output URL to a file under data/outputs. */
function resolveOutputFile(url: string): string | null {
  let pathname = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      pathname = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  if (pathname.startsWith("data:")) return null;
  const prefix = "/media/outputs/";
  if (!pathname.startsWith(prefix)) return null;
  const relative = decodeURIComponent(pathname.slice(prefix.length));
  const file = path.resolve(paths.outputs, relative);
  if (!file.startsWith(paths.outputs) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

function safeFilename(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return cleaned || "work";
}

/**
 * Copy a finished work into the asset library. Idempotent: repeated calls
 * return the existing asset instead of duplicating files.
 */
export async function importWorkAsAsset(work: Work): Promise<AssetSaveResult> {
  const existing = assetStore.findBySource("work", work.id);
  if (existing) return { asset: existing, created: false };

  const sourceFile = resolveOutputFile(work.url);
  if (!sourceFile) {
    throw Object.assign(new Error("作品文件不存在或已清理"), { code: "WORK_FILE_MISSING", status: 410 });
  }

  const id = assetStore.newId();
  const relativeDir = monthDir();
  const ext = path.extname(sourceFile).slice(1).toLowerCase() || (work.kind === "video" ? "mp4" : "jpg");
  const dir = path.join(paths.assets, relativeDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destination = path.join(dir, `${id}.${ext}`);
  fs.copyFileSync(sourceFile, destination);
  fs.chmodSync(destination, 0o600);

  let thumbnailUrl: string | undefined;
  try {
    const thumbPath = path.join(dir, `${id}_thumb.jpg`);
    await createThumbnail(destination, thumbPath);
    thumbnailUrl = `/media/assets/${[relativeDir, `${id}_thumb.jpg`].join("/")}`;
  } catch {
    /* detail view falls back to the original file */
  }

  const record = {
    id,
    kind: work.kind,
    mime: work.mime,
    size: fs.statSync(destination).size,
    width: work.width,
    height: work.height,
    durationSec: work.durationSec,
    url: `/media/assets/${[relativeDir, `${id}.${ext}`].join("/")}`,
    thumbnailUrl,
    originalName: `${safeFilename(work.title || work.id)}.${ext}`,
    createdAt: now(),
  };
  const asset = assetStore.addWithMeta(record, {
    projectId: work.projectId ?? null,
    source: "work",
    sourceRef: work.id,
    sha256: sha256File(destination),
  });
  return { asset, created: true };
}
