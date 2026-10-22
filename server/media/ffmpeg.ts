import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config, paths } from "../config.js";

export class ProcessError extends Error {
  stdout: string;
  stderr: string;
  code: number | null;
  constructor(message: string, stdout: string, stderr: string, code: number | null) {
    super(message);
    this.name = "ProcessError";
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
  }
}

export function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || config.rootDir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(new ProcessError(`failed to spawn ${command}: ${error.message}`, stdout, stderr, null));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new ProcessError(
            killed ? `${command} timed out` : `${command} exited with code ${code}: ${tail(stderr, 1200)}`,
            stdout,
            stderr,
            code
          )
        );
    });
  });
}

const tail = (value: string, size: number) => (value.length > size ? value.slice(-size) : value);

let ffmpegVersion: string | null | undefined;

export async function ffmpegAvailable(): Promise<boolean> {
  if (ffmpegVersion !== undefined) return Boolean(ffmpegVersion);
  try {
    const { stdout } = await runProcess(config.ffmpegPath, ["-version"], { timeoutMs: 5000 });
    ffmpegVersion = stdout.split("\n")[0]?.trim() || "unknown";
  } catch {
    ffmpegVersion = null;
  }
  return Boolean(ffmpegVersion);
}

export function getFfmpegVersion() {
  return ffmpegVersion ?? null;
}

export interface ProbeResult {
  width?: number;
  height?: number;
  durationSec?: number;
  mime?: string;
  videoCodec?: string;
  audioCodec?: string;
}

export async function probeMedia(file: string): Promise<ProbeResult> {
  const { stdout } = await runProcess(
    config.ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { timeoutMs: 30_000 }
  );
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>;
    format?: { duration?: string; format_name?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(parsed.format?.duration || video?.duration || 0);
  return {
    width: video?.width,
    height: video?.height,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    mime: parsed.format?.format_name?.includes("mp4") ? "video/mp4" : undefined,
  };
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

export function normalizeDimensions(width?: number, height?: number, fallback = { width: 1920, height: 1080 }) {
  return {
    width: even(Math.min(8192, Math.max(256, width || fallback.width))),
    height: even(Math.min(8192, Math.max(256, height || fallback.height))),
  };
}

export interface ComposeOptions {
  output: string;
  width: number;
  height: number;
  fps: number;
  durations: number[];
  transition?: "dissolve" | "push" | "fade_black" | "none";
  transitionSec?: number;
  bitrateKbps?: number;
  motion?: string[];
}

function transitionName(transition: ComposeOptions["transition"]) {
  if (transition === "push") return "slideleft";
  if (transition === "fade_black") return "fadeblack";
  if (transition === "none") return "fade";
  return "fade";
}

function transitionDuration(transition: ComposeOptions["transition"], shotDuration: number) {
  if (transition === "none") return 0.05;
  return Math.max(0.05, Math.min(0.8, shotDuration * 0.16));
}

function bitrateArgs(bitrateKbps?: number) {
  if (!bitrateKbps || bitrateKbps <= 0) {
    return ["-crf", "20", "-maxrate", "24M", "-bufsize", "48M"];
  }
  const kbps = Math.max(2000, Math.min(80000, Math.round(bitrateKbps)));
  return ["-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`];
}

function zoomExpression(motion = "") {
  if (motion.includes("拉远")) return { z: "if(lte(zoom,1.0),1.08,max(1.001,zoom-0.0005))", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
  if (motion.includes("横移")) return { z: "1.06", x: "if(lte(on,1),0,(iw-iw/zoom)*on/240)", y: "ih/2-(ih/zoom/2)" };
  if (motion.includes("固定")) return { z: "1.0", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
  return { z: "min(zoom+0.00045,1.08)", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
}

/**
 * Compose still images into one H.264 MP4 with per-shot durations, a subtle
 * Ken Burns move and xfade transitions. Every input is normalized in one
 * filter graph so mixed image sizes are safe.
 */
export async function composeImageSlideshow(images: string[], options: ComposeOptions): Promise<void> {
  if (!images.length) throw new Error("no images to compose");
  const { width, height } = normalizeDimensions(options.width, options.height);
  const fps = options.fps;
  if (images.length === 1) {
    const duration = Math.max(1, options.durations[0] || 5);
    await composeSingleImage(images[0], options.output, { width, height, fps, duration, bitrateKbps: options.bitrateKbps });
    return;
  }
  const inputs = images.flatMap((image, index) => ["-loop", "1", "-t", String(Math.max(1, options.durations[index] || 5)), "-i", image]);
  const filters: string[] = [];
  images.forEach((_, index) => {
    const duration = Math.max(1, options.durations[index] || 5);
    const motion = zoomExpression(options.motion?.[index]);
    filters.push(
      `[${index}:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},` +
        `zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':d=1:s=${width}x${height}:fps=${fps},` +
        `trim=duration=${duration},setpts=PTS-STARTPTS,settb=AVTB,format=yuv420p[v${index}]`
    );
  });
  let previous = "v0";
  let accumulated = Math.max(1, options.durations[0] || 5);
  for (let index = 1; index < images.length; index += 1) {
    const duration = Math.max(1, options.durations[index] || 5);
    const transition = transitionDuration(options.transition, Math.min(accumulated, duration));
    const offset = Math.max(0, accumulated - transition);
    const out = index === images.length - 1 ? "vout" : `vx${index}`;
    filters.push(
      `[${previous}][v${index}]xfade=transition=${transitionName(options.transition)}:duration=${transition.toFixed(2)}:offset=${offset.toFixed(2)}[${out}]`
    );
    previous = out;
    accumulated = accumulated + duration - transition;
  }
  const args = [
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...bitrateArgs(options.bitrateKbps),
    "-movflags",
    "+faststart",
    "-an",
    options.output,
  ];
  await runProcess(config.ffmpegPath, args, { timeoutMs: 20 * 60_000 });
}

export async function composeSingleImage(
  image: string,
  output: string,
  options: { width: number; height: number; fps: number; duration: number; bitrateKbps?: number; motion?: string }
) {
  const { width, height } = normalizeDimensions(options.width, options.height);
  const fps = options.fps;
  const duration = Math.max(1, options.duration);
  const motion = zoomExpression(options.motion);
  const filter =
    `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},` +
    `zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':d=1:s=${width}x${height}:fps=${fps},` +
    `trim=duration=${duration},setpts=PTS-STARTPTS,format=yuv420p`;
  await runProcess(
    config.ffmpegPath,
    [
      "-y",
      "-loop",
      "1",
      "-i",
      image,
      "-t",
      String(duration),
      "-vf",
      filter,
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      ...bitrateArgs(options.bitrateKbps),
      "-movflags",
      "+faststart",
      "-an",
      output,
    ],
    { timeoutMs: 15 * 60_000 }
  );
}

/** Compose generated shot videos into one normalized MP4. */
export async function composeVideoClips(clips: string[], options: ComposeOptions): Promise<void> {
  if (!clips.length) throw new Error("no clips to compose");
  const { width, height } = normalizeDimensions(options.width, options.height);
  const fps = options.fps;
  if (clips.length === 1) {
    await normalizeVideo(clips[0], options.output, {
      width,
      height,
      fps,
      bitrateKbps: options.bitrateKbps,
      maxDurationSec: options.durations[0],
    });
    return;
  }
  const inputs = clips.flatMap((clip) => ["-i", clip]);
  const filters: string[] = [];
  clips.forEach((_, index) => {
    const duration = Math.max(0.5, options.durations[index] || 5);
    filters.push(
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},trim=duration=${duration},` +
        `setpts=PTS-STARTPTS,settb=AVTB,format=yuv420p[v${index}]`
    );
  });
  let previous = "v0";
  let accumulated = Math.max(0.5, options.durations[0] || 5);
  for (let index = 1; index < clips.length; index += 1) {
    const duration = Math.max(0.5, options.durations[index] || 5);
    const transition = transitionDuration(options.transition, Math.min(accumulated, duration));
    const offset = Math.max(0, accumulated - transition);
    const out = index === clips.length - 1 ? "vout" : `vx${index}`;
    filters.push(
      `[${previous}][v${index}]xfade=transition=${transitionName(options.transition)}:duration=${transition.toFixed(2)}:offset=${offset.toFixed(2)}[${out}]`
    );
    previous = out;
    accumulated = accumulated + duration - transition;
  }
  await runProcess(
    config.ffmpegPath,
    [
      "-y",
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[vout]",
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      ...bitrateArgs(options.bitrateKbps),
      "-movflags",
      "+faststart",
      "-an",
      options.output,
    ],
    { timeoutMs: 30 * 60_000 }
  );
}

export async function normalizeVideo(
  input: string,
  output: string,
  options: { width: number; height: number; fps: number; bitrateKbps?: number; maxDurationSec?: number }
) {
  const { width, height } = normalizeDimensions(options.width, options.height);
  const fps = options.fps;
  const args = [
    "-y",
    "-i",
    input,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`,
  ];
  if (options.maxDurationSec) args.push("-t", String(Math.max(0.5, options.maxDurationSec)));
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...bitrateArgs(options.bitrateKbps),
    "-movflags",
    "+faststart",
    "-an",
    output
  );
  await runProcess(config.ffmpegPath, args, { timeoutMs: 20 * 60_000 });
}

export async function normalizeImage(input: string, output: string, width: number, height: number) {
  const dims = normalizeDimensions(width, height);
  await runProcess(
    config.ffmpegPath,
    [
      "-y",
      "-i",
      input,
      "-vf",
      `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height},eq=saturation=1.06:contrast=1.02`,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      output,
    ],
    { timeoutMs: 60_000 }
  );
}

export async function createThumbnail(input: string, output: string) {
  const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(input);
  const args = ["-y", ...(isVideo ? ["-ss", "1"] : []), "-i", input];
  args.push("-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "3", output);
  await runProcess(config.ffmpegPath, args, { timeoutMs: 60_000 });
}

export function outputPath(jobId: string, suffix: string, ext: string) {
  const safe = `${jobId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  return path.join(paths.outputs, `${safe}.${ext}`);
}

export function mimeExtension(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "bin";
}

export function extensionMime(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  return "application/octet-stream";
}

export function fileSize(file: string) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
