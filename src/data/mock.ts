import type { AnimationMode, Bitrate, BoardState, BoardRow, Mode, ModeConfig, Resolution } from "../types";

export const IMG = {
  dunes: "/assets/1470071459604-3b5ec3a7fe05.jpg",
  glass: "/assets/1541701494587-cb58502866ab.jpg",
  nebula: "/assets/1462331940025-496dfbfc7564.jpg",
  pastel: "/assets/1618005198919-d3d4b5a92ead.jpg",
  tide: "/assets/1634017839464-5c339ebe3cb4.jpg",
};

export const MODE_ORDER: Mode[] = ["t2i", "t2v", "i2i", "i2v", "multi"];

export const MODES: Record<Mode, ModeConfig> = {
  t2i: {
    prompt: "深海与熔融玻璃的交界，蓝色潮汐里浮起一枚琥珀色的发光体，超现实电影静帧，体积光，细腻颗粒，冷蓝与暖橙对撞",
    model: "Seedream 4.0",
    modelDesc: "图像生成 · 最高 4K",
    tags: ["中文理解", "快速", "4K"],
    cta: "生成图像",
    eta: "约 18 秒",
    attach: false,
    attachLabel: "添加参考图",
    duration: false,
  },
  t2v: {
    prompt: "深空中的紫色星云缓慢旋转，一颗黑色巨石从星尘中浮现，镜头低角度缓慢推进，超现实电影质感，细腻颗粒",
    model: "Seedance 1.0 Pro",
    modelDesc: "视频生成 · 1080p / 24fps",
    tags: ["文生视频", "1080p", "有声"],
    cta: "生成视频",
    eta: "约 45 秒",
    attach: false,
    attachLabel: "添加首帧",
    duration: true,
  },
  i2i: {
    prompt: "将参考图转化为流动的液态玻璃雕塑，保留主体轮廓，加入琥珀色内光与细微色散，深色背景，棚拍质感",
    model: "Seedream 4.0",
    modelDesc: "图像编辑 · 参考图驱动",
    tags: ["图生图", "参考强度", "2K"],
    cta: "生成图像",
    eta: "约 22 秒",
    attach: true,
    attachLabel: "添加参考图",
    duration: false,
  },
  i2v: {
    prompt: "让画面中的云层漫过山脊，晨雾沿着山谷缓慢流动，镜头向右环绕，日光穿过薄雾，电影级动态模糊",
    model: "Seedance 1.0 Pro",
    modelDesc: "图生视频 · 首尾帧 / 动画",
    tags: ["首帧驱动", "动画模式", "1080p"],
    cta: "生成视频",
    eta: "约 60 秒",
    attach: true,
    attachLabel: "替换首帧",
    duration: true,
  },
  multi: {
    prompt: "四个镜头讲述一次雾中的玻璃仪式：远景进入、玻璃结构特写、潮汐剪影、回到远景。统一青灰与琥珀色调，35mm 胶片质感，镜头之间自然衔接",
    model: "Seedance 1.0 Pro",
    modelDesc: "多图分镜 · 自动合成",
    tags: ["图组视频", "4 分镜", "自动配乐"],
    cta: "合成视频",
    eta: "约 2–3 分钟",
    attach: true,
    attachLabel: "批量添加图片",
    duration: true,
  },
};

export const SHOT_SIZES = ["远景", "全景", "中景", "近景", "特写", "微距"];
export const MOTIONS = ["固定", "缓慢推进", "缓慢拉远", "横移", "环绕", "仰拍", "俯拍", "手持"];

export const ANIMATION_LABELS: Record<AnimationMode, string> = {
  live: "实拍",
  "2d": "2D 动画",
  "3d": "3D 动画",
  stop: "定格动画",
};

export const ANIMATION_HINTS: Record<AnimationMode, string> = {
  live: "保留实拍质感，按真实运镜生成",
  "2d": "逐帧转为二维动画，首帧作为构图参考",
  "3d": "转为三维动画渲染，保留主体轮廓",
  stop: "定格动画节奏，12fps 抽帧质感",
};

export const ANIMATION_TOKEN_FACTOR: Record<AnimationMode, number> = {
  live: 1,
  "2d": 1.12,
  "3d": 1.2,
  stop: 1.08,
};

export const DEFAULT_RESOLUTION: Record<Mode, Resolution> = {
  t2i: "2K",
  t2v: "1080p",
  i2i: "2K",
  i2v: "1080p",
  multi: "1080p",
};

export const DEFAULT_VIEWS: Partial<Record<Mode, "preview" | "storyboard">> = {
  t2v: "preview",
  multi: "storyboard",
};

const boardRow = (row: Omit<BoardRow, "id">, index: number): BoardRow => ({
  ...row,
  id: `row-${index}-${Math.random().toString(36).slice(2, 7)}`,
});

export const DEFAULT_BOARDS: Record<"t2v" | "multi", BoardState> = {
  t2v: {
    title: "星云 · 分镜脚本",
    rows: [
      { img: IMG.nebula, shot: "远景", motion: "缓慢推进", desc: "深空中的紫色星云缓慢旋转，一颗黑色巨石从星尘中浮现", audio: "低频嗡鸣渐入", dur: 3 },
      { img: IMG.glass, shot: "特写", motion: "环绕", desc: "黑石表面的刻纹被星光照亮，细微尘埃在光束中漂浮", audio: "金属摩擦声", dur: 3 },
      { img: IMG.tide, shot: "全景", motion: "横移", desc: "星尘汇聚成银色潮汐，缓慢漫过黑石底座", audio: "潮汐声 · 渐强", dur: 3 },
      { img: IMG.pastel, shot: "中景", motion: "仰拍", desc: "黑石升入星云中心，边缘被逆光勾出一圈冷白轮廓", audio: "低频鼓点", dur: 3 },
      { img: IMG.dunes, shot: "远景", motion: "缓慢拉远", desc: "星云收束成一道光环，黑石沉入黑暗，画面归于寂静", audio: "余响 · 淡出", dur: 3 },
    ].map(boardRow),
  },
  multi: {
    title: "雾中玻璃仪式",
    rows: [
      { img: IMG.dunes, shot: "远景", motion: "缓慢横移", desc: "晨雾漫过山脊，远处出现透明的玻璃拱门结构", audio: "风声 · 远处钟声", dur: 5 },
      { img: IMG.pastel, shot: "特写", motion: "微距推进", desc: "玻璃结构折射冷光，表面凝结的雾气缓慢滑落", audio: "玻璃共鸣", dur: 5 },
      { img: IMG.glass, shot: "中景", motion: "环绕", desc: "潮汐里浮起琥珀色光体，人物剪影站在水雾中央", audio: "潮汐 · 呼吸声", dur: 5 },
      { img: IMG.tide, shot: "远景", motion: "缓慢拉远", desc: "雾散，玻璃结构回到山脊尽头，余晖收束画面", audio: "余响 · 淡出", dur: 5 },
    ].map(boardRow),
  },
};

export const DEFAULT_PROMPTS: Record<Mode, string> = {
  t2i: MODES.t2i.prompt,
  t2v: MODES.t2v.prompt,
  i2i: MODES.i2i.prompt,
  i2v: MODES.i2v.prompt,
  multi: MODES.multi.prompt,
};

export const BITRATE_LABELS: Record<Bitrate, string> = {
  auto: "自动",
  "8": "8 Mbps",
  "16": "16 Mbps",
  custom: "自定义",
};

export const IMAGE_RESOLUTIONS: Resolution[] = ["1K", "2K", "4K", "custom"];
export const VIDEO_RESOLUTIONS: Resolution[] = ["720p", "1080p", "4K", "custom"];
