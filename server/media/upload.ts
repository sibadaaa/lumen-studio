import fs from "node:fs";
import path from "node:path";
import type { MediaAsset } from "../../shared/contracts.js";
import { config, paths } from "../config.js";
import { createThumbnail, extensionMime, normalizeImage, probeMedia } from "./ffmpeg.js";
import { buildAssetUrl, assetStore, createAssetRecord } from "../storage/assets.js";

const IMAGE_TYPES = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

function sniffImage(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

function monthDir() {
  const date = new Date();
  return path.join(String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"));
}

export async function storeImageUpload(file: File, purpose = "reference", projectId?: string | null): Promise<MediaAsset> {
  if (file.size > config.maxUploadBytes) {
    throw Object.assign(new Error(`单张图片不能超过 ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB`), {
      code: "UPLOAD_TOO_LARGE",
      status: 413,
    });
  }
  if (file.type && !IMAGE_TYPES.has(file.type)) {
    throw Object.assign(new Error("仅支持 PNG / JPEG / WebP"), { code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > config.maxUploadBytes) {
    throw Object.assign(new Error("上传内容超过限制"), { code: "UPLOAD_TOO_LARGE", status: 413 });
  }
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    throw Object.assign(new Error("文件内容不是受支持的图片格式"), { code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
  }

  const id = assetStore.newId();
  const relativeDir = monthDir();
  const dir = path.join(paths.assets, relativeDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filename = `${id}.${sniffed.ext}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, buffer, { mode: 0o600 });
  const relativePath = path.join(relativeDir, filename);

  let width: number | undefined;
  let height: number | undefined;
  let thumbnailUrl: string | undefined;
  try {
    const probe = await probeMedia(absolutePath);
    width = probe.width;
    height = probe.height;
    if ((width && width < 64) || (height && height < 64)) {
      fs.unlinkSync(absolutePath);
      throw Object.assign(new Error("图片尺寸过小（最小 64px）"), { code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
    }
    const thumbName = `${id}_thumb.jpg`;
    const thumbPath = path.join(dir, thumbName);
    await createThumbnail(absolutePath, thumbPath);
    thumbnailUrl = buildAssetUrl(path.join(relativeDir, thumbName));
  } catch (error) {
    if ((error as { status?: number }).status) throw error;
    // A probe or thumbnail failure must not reject a valid upload; the browser
    // can still show the original, and FFmpeg will re-encode on composition.
  }

  const record = createAssetRecord({
    id,
    kind: "image",
    mime: sniffed.mime,
    size: buffer.byteLength,
    width,
    height,
    url: buildAssetUrl(relativePath),
    thumbnailUrl,
    originalName: file.name ? path.basename(file.name).slice(0, 160) : undefined,
  });
  assetStore.add(record, projectId ?? null);

  // Strip metadata by re-encoding in the background only after the source is
  // safely stored. This keeps the upload response fast.
  const normalized = path.join(dir, `${id}_clean.jpg`);
  void normalizeImage(absolutePath, normalized, width || 2048, height || 1152)
    .then(() => {
      const cleanRecord = {
        ...record,
        url: buildAssetUrl(path.join(relativeDir, `${id}_clean.jpg`)),
        mime: "image/jpeg",
        size: fs.statSync(normalized).size,
      };
      assetStore.add(cleanRecord, projectId ?? null);
    })
    .catch(() => {
      /* keep the original */
    });

  void purpose;
  return record;
}

export function uploadPathFor(id: string, mime: string) {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const relative = path.join(monthDir(), `${id}.${ext}`);
  return {
    relative,
    absolute: path.join(paths.uploads, relative),
    mime,
  };
}

export function mimeFromFile(file: string) {
  return extensionMime(file);
}
