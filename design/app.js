(() => {
  "use strict";

  const MODES = {
    t2i: {
      prompt: "深海与熔融玻璃的交界，蓝色潮汐里浮起一枚琥珀色的发光体，超现实电影静帧，体积光，细腻颗粒，冷蓝与暖橙对撞",
      model: "Seedream 4.0",
      modelDesc: "图像生成 · 最高 4K",
      tags: ["中文理解", "快速", "4K"],
      cta: "生成图像",
      tokens: 3240,
      eta: "约 18 秒",
      attach: false,
      attachLabel: "添加参考图",
      duration: false
    },
    t2v: {
      prompt: "深空中的紫色星云缓慢旋转，一颗黑色巨石从星尘中浮现，镜头低角度缓慢推进，超现实电影质感，细腻颗粒",
      model: "Seedance 1.0 Pro",
      modelDesc: "视频生成 · 1080p / 24fps",
      tags: ["文生视频", "1080p", "有声"],
      cta: "生成视频",
      tokens: 18600,
      eta: "约 45 秒",
      attach: false,
      attachLabel: "添加首帧",
      duration: true
    },
    i2i: {
      prompt: "将参考图转化为流动的液态玻璃雕塑，保留主体轮廓，加入琥珀色内光与细微色散，深色背景，棚拍质感",
      model: "Seedream 4.0",
      modelDesc: "图像编辑 · 参考图驱动",
      tags: ["图生图", "参考强度", "2K"],
      cta: "生成图像",
      tokens: 4120,
      eta: "约 22 秒",
      attach: true,
      attachLabel: "添加参考图",
      duration: false
    },
    i2v: {
      prompt: "让画面中的云层漫过山脊，晨雾沿着山谷缓慢流动，镜头向右环绕，日光穿过薄雾，电影级动态模糊",
      model: "Seedance 1.0 Pro",
      modelDesc: "图生视频 · 首尾帧 / 动画",
      tags: ["首帧驱动", "动画模式", "1080p"],
      cta: "生成视频",
      tokens: 24800,
      eta: "约 60 秒",
      attach: true,
      attachLabel: "替换首帧",
      duration: true
    },
    multi: {
      prompt: "四个镜头讲述一次雾中的玻璃仪式：远景进入、玻璃结构特写、潮汐剪影、回到远景。统一青灰与琥珀色调，35mm 胶片质感，镜头之间自然衔接",
      model: "Seedance 1.0 Pro",
      modelDesc: "多图分镜 · 自动合成",
      tags: ["图组视频", "4 分镜", "自动配乐"],
      cta: "合成视频",
      tokens: 62400,
      eta: "约 2–3 分钟",
      attach: true,
      attachLabel: "批量添加图片",
      duration: true
    }
  };

  const DRAFTS = Object.fromEntries(Object.entries(MODES).map(([key, value]) => [key, value.prompt]));

  const SHOT_SIZES = ["远景", "全景", "中景", "近景", "特写", "微距"];
  const MOTIONS = ["固定", "缓慢推进", "缓慢拉远", "横移", "环绕", "仰拍", "俯拍", "手持"];

  const DEFAULT_BOARDS = {
    t2v: {
      title: "星云 · 分镜脚本",
      rows: [
        { img: "./assets/1462331940025-496dfbfc7564.jpg", shot: "远景", motion: "缓慢推进", desc: "深空中的紫色星云缓慢旋转，一颗黑色巨石从星尘中浮现", audio: "低频嗡鸣渐入", dur: 3 },
        { img: "./assets/1541701494587-cb58502866ab.jpg", shot: "特写", motion: "环绕", desc: "黑石表面的刻纹被星光照亮，细微尘埃在光束中漂浮", audio: "金属摩擦声", dur: 3 },
        { img: "./assets/1634017839464-5c339ebe3cb4.jpg", shot: "全景", motion: "横移", desc: "星尘汇聚成银色潮汐，缓慢漫过黑石底座", audio: "潮汐声 · 渐强", dur: 3 },
        { img: "./assets/1618005198919-d3d4b5a92ead.jpg", shot: "中景", motion: "仰拍", desc: "黑石升入星云中心，边缘被逆光勾出一圈冷白轮廓", audio: "低频鼓点", dur: 3 },
        { img: "./assets/1470071459604-3b5ec3a7fe05.jpg", shot: "远景", motion: "缓慢拉远", desc: "星云收束成一道光环，黑石沉入黑暗，画面归于寂静", audio: "余响 · 淡出", dur: 3 }
      ]
    },
    multi: {
      title: "雾中玻璃仪式",
      rows: [
        { img: "./assets/1470071459604-3b5ec3a7fe05.jpg", shot: "远景", motion: "缓慢横移", desc: "晨雾漫过山脊，远处出现透明的玻璃拱门结构", audio: "风声 · 远处钟声", dur: 5 },
        { img: "./assets/1618005198919-d3d4b5a92ead.jpg", shot: "特写", motion: "微距推进", desc: "玻璃结构折射冷光，表面凝结的雾气缓慢滑落", audio: "玻璃共鸣", dur: 5 },
        { img: "./assets/1541701494587-cb58502866ab.jpg", shot: "中景", motion: "环绕", desc: "潮汐里浮起琥珀色光体，人物剪影站在水雾中央", audio: "潮汐 · 呼吸声", dur: 5 },
        { img: "./assets/1634017839464-5c339ebe3cb4.jpg", shot: "远景", motion: "缓慢拉远", desc: "雾散，玻璃结构回到山脊尽头，余晖收束画面", audio: "余响 · 淡出", dur: 5 }
      ]
    }
  };

  const BOARDS = JSON.parse(JSON.stringify(DEFAULT_BOARDS));
  const MODE_VIEWS = { t2v: "preview", multi: "storyboard" };

  const body = document.body;
  const tabs = [...document.querySelectorAll(".mode-tab")];
  const panels = [...document.querySelectorAll(".panel")];
  const promptEl = document.getElementById("prompt");
  const charCount = document.getElementById("charCount");
  const cta = document.getElementById("cta");
  const ctaLabel = document.getElementById("ctaLabel");
  const tokenValue = document.getElementById("tokenValue");
  const inlineTokens = document.getElementById("inlineTokens");
  const inlineEta = document.getElementById("inlineEta");
  const genTokenHint = document.getElementById("genTokenHint");
  const viewSwitch = document.getElementById("viewSwitch");
  const viewButtons = [...document.querySelectorAll("#viewSwitch button")];
  const storyboardView = document.getElementById("storyboardView");
  const boardRows = document.getElementById("boardRows");
  const boardTitle = document.getElementById("boardTitle");
  const boardSub = document.getElementById("boardSub");
  const boardTotal = document.getElementById("boardTotal");
  const boardCount = document.getElementById("boardCount");
  const boardTokens = document.getElementById("boardTokens");
  const boardTimeline = document.getElementById("boardTimeline");
  const tokenChip = document.getElementById("tokenChip");
  const sessionTokenValue = document.querySelector(".token-value");
  const durationField = document.getElementById("durationField");
  const motionField = document.getElementById("motionField");
  const boardTitleText = document.getElementById("boardTitleText");
  const studioPage = document.querySelector(".studio");
  const workspacePage = document.getElementById("workspacePage");
  const workspaceHome = document.getElementById("workspaceHome");
  const projectPage = document.getElementById("projectPage");
  const railWorkspace = document.getElementById("railWorkspace");
  const pageJump = document.getElementById("pageJump");
  const breadcrumbs = document.getElementById("breadcrumbs");
  const agentEntry = document.getElementById("agentEntry");
  const wsThread = document.getElementById("wsThread");
  const wsTitle = document.getElementById("wsTitle");
  const wsPrompt = document.getElementById("wsPrompt");
  const wsSearch = document.getElementById("wsSearch");
  const resValue = document.getElementById("resValue");
  const resSeg = document.getElementById("resSeg");
  const customResPanel = document.getElementById("customResPanel");
  const customWidth = document.getElementById("customWidth");
  const customHeight = document.getElementById("customHeight");
  const customPixels = document.getElementById("customPixels");
  const customAlign = document.getElementById("customAlign");
  const ratioLock = document.getElementById("ratioLock");
  const resPresets = document.getElementById("resPresets");
  const bitrateSeg = document.getElementById("bitrateSeg");
  const bitrateValue = document.getElementById("bitrateValue");
  const customBitratePanel = document.getElementById("customBitratePanel");
  const bitrateInput = document.getElementById("bitrateInput");
  const animSeg = document.getElementById("animSeg");
  const animValue = document.getElementById("animValue");
  const animHint = document.getElementById("animHint");
  const animTag = document.getElementById("animTag");
  const t2iResMeta = document.getElementById("t2iResMeta");
  const t2vResMeta = document.getElementById("t2vResMeta");
  const t2vBitrateMeta = document.getElementById("t2vBitrateMeta");
  const i2vResMeta = document.getElementById("i2vResMeta");
  const modelName = document.getElementById("modelName");
  const modelDesc = document.getElementById("modelDesc");
  const modelTags = document.getElementById("modelTags");
  const attachBtn = document.getElementById("attachBtn");
  const attachLabel = document.getElementById("attachLabel");
  const fileInput = document.getElementById("fileInput");
  const attachments = document.getElementById("attachments");
  const ratioValue = document.getElementById("ratioValue");
  const durationValue = document.getElementById("durationValue");
  const strengthValue = document.getElementById("strengthValue");
  const strengthRange = document.getElementById("strengthRange");
  const roleFields = [...document.querySelectorAll("[data-modes]")];
  const generationOverlay = document.getElementById("generationOverlay");
  const genStage = document.getElementById("genStage");
  const genPercent = document.getElementById("genPercent");
  const genBar = document.getElementById("genBar");
  const toastWrap = document.getElementById("toastWrap");
  const apiModal = document.getElementById("apiModal");
  const testState = document.getElementById("testState");
  const testConnection = document.getElementById("testConnection");
  const apiKey = document.getElementById("apiKey");
  const videoPlay = document.getElementById("videoPlay");
  const timelineTrack = document.getElementById("timelineTrack");
  const timelineFill = timelineTrack?.querySelector(".timeline-fill");
  const timelineHead = timelineTrack?.querySelector(".timeline-head");
  const videoTime = document.getElementById("videoTime");

  const MODE_RESOLUTION = { t2i: "2K", t2v: "1080p", i2i: "2K", i2v: "1080p", multi: "1080p" };
  const CUSTOM_SIZES = {
    image: { width: 2048, height: 1152 },
    video: { width: 1920, height: 1080 }
  };
  const ANIMATION_LABELS = { live: "实拍", "2d": "2D 动画", "3d": "3D 动画", stop: "定格动画" };
  const ANIMATION_HINTS = {
    live: "保留实拍质感，按真实运镜生成",
    "2d": "逐帧转为二维动画，首帧作为构图参考",
    "3d": "转为三维动画渲染，保留主体轮廓",
    stop: "定格动画节奏，12fps 抽帧质感"
  };
  const ANIMATION_TOKEN_FACTOR = { live: 1, "2d": 1.12, "3d": 1.2, stop: 1.08 };

  let currentMode = "t2i";
  let currentView = "preview";
  let resolution = "2K";
  let duration = 5;
  let currentRatio = "16:9";
  let ratioLocked = true;
  let bitrate = "auto";
  let customBitrate = 16;
  let animationMode = "live";
  let isGenerating = false;
  let sessionTokens = 128420;
  let pendingThumbRow = null;
  let videoTimer = null;
  let videoProgress = 0;
  let isDraggingCompare = false;

  function formatTokenCount(value) {
    return Math.round(value).toLocaleString("en-US");
  }

  function compactTokenCount(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(2)}m`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(Math.round(value));
  }

  function boardDuration(mode = currentMode) {
    return (BOARDS[mode]?.rows || []).reduce((sum, row) => sum + Number(row.dur || 0), 0);
  }

  function getBoardTokens(mode = currentMode) {
    const rows = BOARDS[mode]?.rows || [];
    const total = rows.reduce((sum, row) => sum + Number(row.dur || 0), 0);
    const perSecond = mode === "t2v" ? 3200 : 2800;
    const perShot = mode === "t2v" ? 1200 : 800;
    return Math.round((total * perSecond + rows.length * perShot) * resolutionFactor(mode));
  }

  function isVideoMode(mode = currentMode) {
    return ["t2v", "i2v", "multi"].includes(mode);
  }

  function sizeKind(mode = currentMode) {
    return isVideoMode(mode) ? "video" : "image";
  }

  function ratioNumber() {
    const [w, h] = currentRatio.split(":").map(Number);
    return w / h || 16 / 9;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function resolutionFactor(mode = currentMode) {
    const kind = sizeKind(mode);
    if (resolution === "custom") {
      const dims = CUSTOM_SIZES[kind];
      const megapixels = (dims.width * dims.height) / 1000000;
      return kind === "video"
        ? clamp(megapixels / 2.07, 0.4, 3.4)
        : clamp(megapixels / 2.36, 0.4, 4);
    }
    if (kind === "video") {
      return { "720p": 0.7, "1080p": 1, "4K": 1.8 }[resolution] || 1;
    }
    return { "1K": 0.65, "2K": 1, "4K": 2.4 }[resolution] || 1;
  }

  function getBaseTokens(mode = currentMode) {
    const factor = resolutionFactor(mode);
    let tokens = 0;
    if (mode === "t2i") tokens = 3240 * factor;
    else if (mode === "i2i") tokens = 4120 * factor;
    else if (mode === "t2v") tokens = 18600 * (duration / 5) * factor;
    else if (mode === "i2v") tokens = 24800 * (duration / 5) * factor;
    else if (mode === "multi") tokens = 62400 * (duration / 5) * factor;
    if (mode === "i2v") tokens *= ANIMATION_TOKEN_FACTOR[animationMode] || 1;
    return tokens;
  }

  function currentDimensions(mode = currentMode) {
    const kind = sizeKind(mode);
    if (resolution === "custom") return { ...CUSTOM_SIZES[kind] };
    if (kind === "video") {
      return {
        "720p": { width: 1280, height: 720 },
        "1080p": { width: 1920, height: 1080 },
        "4K": { width: 3840, height: 2160 }
      }[resolution] || { width: 1920, height: 1080 };
    }
    return {
      "1K": { width: 1280, height: 720 },
      "2K": { width: 2048, height: 1152 },
      "4K": { width: 3840, height: 2160 }
    }[resolution] || { width: 2048, height: 1152 };
  }

  function bitrateLabel() {
    if (bitrate === "auto") return "自动";
    if (bitrate === "custom") return `${customBitrate} Mbps`;
    return `${bitrate} Mbps`;
  }

  function updateStageMeta() {
    const dims = currentDimensions();
    const label = `${dims.width} × ${dims.height}`;
    if (t2iResMeta) t2iResMeta.textContent = label;
    if (t2vResMeta) t2vResMeta.textContent = resolution === "custom" ? label : resolution;
    if (i2vResMeta) i2vResMeta.textContent = `· ${label}`;
    if (t2vBitrateMeta) t2vBitrateMeta.textContent = bitrate === "auto" ? "自动码率" : bitrateLabel();
    if (animTag) {
      const show = currentMode === "i2v" && animationMode !== "live";
      animTag.hidden = !show;
      if (show) {
        const short = { "2d": "2D", "3d": "3D", stop: "定格" }[animationMode] || "";
        animTag.textContent = `动画 · ${short}`;
      }
    }
  }

  function isBoardView() {
    return ["t2v", "multi"].includes(currentMode) && currentView === "storyboard";
  }

  function getTokens() {
    return Math.round((isBoardView() ? getBoardTokens() : getBaseTokens()) / 10) * 10;
  }

  function updateCtaLabel() {
    if (isBoardView()) {
      ctaLabel.textContent = "生成分镜视频";
    } else if (currentMode === "i2v" && animationMode !== "live") {
      ctaLabel.textContent = "生成动画视频";
    } else {
      ctaLabel.textContent = MODES[currentMode].cta;
    }
  }

  function updateEstimate() {
    const tokens = getTokens();
    const formatted = formatTokenCount(tokens);
    tokenValue.textContent = formatted;
    inlineTokens.textContent = formatted;
    if (genTokenHint) genTokenHint.textContent = `预计 ${formatted} tokens`;
    if (isBoardView()) {
      inlineEta.textContent = currentMode === "multi" ? "约 3–4 分钟" : "约 90 秒";
    } else {
      inlineEta.textContent = MODES[currentMode].eta;
    }
    if (currentMode === "multi") {
      durationValue.textContent = isBoardView()
        ? `表内 ${BOARDS.multi.rows.length} 镜`
        : `单镜 ${duration} 秒`;
    } else if (MODES[currentMode].duration) {
      durationValue.textContent = `${duration} 秒`;
    }
    if (isBoardView() && boardTokens) boardTokens.textContent = formatted;
    updateCtaLabel();
    updateStageMeta();
  }

  function renderResolutionSeg() {
    const kind = sizeKind();
    const options = kind === "video"
      ? [["720p", "720p"], ["1080p", "1080p"], ["4K", "4K"], ["custom", "自定义"]]
      : [["1K", "1K"], ["2K", "2K"], ["4K", "4K"], ["custom", "自定义"]];
    resSeg.innerHTML = options
      .map(([value, label]) => `<button data-res="${value}" class="${resolution === value ? "is-active" : ""}">${label}</button>`)
      .join("");
    resValue.textContent = resolution === "custom" ? "自定义" : resolution;
  }

  function updateCustomResolutionUI() {
    const isCustom = resolution === "custom";
    customResPanel.hidden = !isCustom;
    if (!isCustom) {
      updateStageMeta();
      return;
    }
    const kind = sizeKind();
    const dims = CUSTOM_SIZES[kind];
    const step = 2;
    customWidth.min = kind === "video" ? 640 : 512;
    customWidth.max = kind === "video" ? 3840 : 8192;
    customHeight.min = kind === "video" ? 360 : 512;
    customHeight.max = kind === "video" ? 2160 : 8192;
    customWidth.step = step;
    customHeight.step = step;
    customWidth.value = dims.width;
    customHeight.value = dims.height;
    customPixels.textContent = `${((dims.width * dims.height) / 1000000).toFixed(2)} MP`;
    customAlign.textContent = "建议 8px 对齐";
    const presets = kind === "video"
      ? [[1920, 1080, "1080p"], [3840, 2160, "4K"], [1080, 1920, "竖屏"]]
      : [[2048, 1152, "2K"], [3840, 2160, "4K"], [1080, 1920, "竖屏"]];
    resPresets.innerHTML = presets
      .map(([w, h, label]) => `<button type="button" data-w="${w}" data-h="${h}">${label}</button>`)
      .join("");
    updateStageMeta();
  }

  function refreshCustomMeta() {
    const kind = sizeKind();
    const dims = CUSTOM_SIZES[kind];
    customPixels.textContent = `${((dims.width * dims.height) / 1000000).toFixed(2)} MP`;
    updateStageMeta();
    updateEstimate();
  }

  function fitCustomToRatio() {
    if (resolution !== "custom") return;
    const kind = sizeKind();
    const dims = CUSTOM_SIZES[kind];
    const step = 2;
    const minW = kind === "video" ? 640 : 512;
    const maxW = kind === "video" ? 3840 : 8192;
    const minH = kind === "video" ? 360 : 512;
    const maxH = kind === "video" ? 2160 : 8192;
    const snap = (value) => Math.max(1, Math.round(value / step) * step);
    const base = Math.min(dims.width, dims.height);
    dims.width = clamp(snap(base), minW, maxW);
    dims.height = clamp(snap(dims.width / ratioNumber()), minH, maxH);
    customWidth.value = dims.width;
    customHeight.value = dims.height;
    refreshCustomMeta();
  }

  function setCustomDimension(axis, rawValue) {
    const kind = sizeKind();
    const dims = CUSTOM_SIZES[kind];
    const step = 2;
    const minW = kind === "video" ? 640 : 512;
    const maxW = kind === "video" ? 3840 : 8192;
    const minH = kind === "video" ? 360 : 512;
    const maxH = kind === "video" ? 2160 : 8192;
    const snap = (value) => Math.max(1, Math.round(value / step) * step);
    if (axis === "width") {
      dims.width = clamp(snap(Number(rawValue) || dims.width), minW, maxW);
      if (ratioLocked) dims.height = clamp(snap(dims.width / ratioNumber()), minH, maxH);
      customHeight.value = dims.height;
    } else {
      dims.height = clamp(snap(Number(rawValue) || dims.height), minH, maxH);
      if (ratioLocked) dims.width = clamp(snap(dims.height * ratioNumber()), minW, maxW);
      customWidth.value = dims.width;
    }
    refreshCustomMeta();
  }

  function updateBitrateUI() {
    bitrateSeg.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.bitrate === bitrate);
    });
    customBitratePanel.hidden = bitrate !== "custom";
    bitrateValue.textContent = bitrateLabel();
    if (t2vBitrateMeta) {
      t2vBitrateMeta.textContent = bitrate === "auto" ? "自动码率" : `${bitrate === "custom" ? customBitrate : bitrate} Mbps`;
    }
  }

  function updateAnimationUI() {
    animSeg.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.anim === animationMode);
    });
    animValue.textContent = ANIMATION_LABELS[animationMode];
    animHint.textContent = ANIMATION_HINTS[animationMode];
    updateCtaLabel();
    updateStageMeta();
    updateEstimate();
  }

  function updateSessionTokensDisplay() {
    if (sessionTokenValue) sessionTokenValue.textContent = compactTokenCount(sessionTokens);
    if (tokenChip) {
      tokenChip.title = `本会话 ${formatTokenCount(sessionTokens)} tokens · 本地会话累计`;
    }
  }

  function addSessionTokens(tokens) {
    sessionTokens += Math.round(tokens);
    updateSessionTokensDisplay();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function updateRange(el, suffix = "") {
    if (!el) return;
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    const value = Number(el.value);
    const percentage = ((value - min) / (max - min)) * 100;
    el.style.setProperty("--range-fill", `${percentage}%`);
    const label = el === strengthRange ? strengthValue : null;
    if (label) label.textContent = `${value}%${suffix}`;
  }

  function syncFieldVisibility() {
    const available = (el) => el && el.dataset.modes.split(" ").includes(currentMode);
    if (durationField) durationField.hidden = !available(durationField) || isBoardView();
    if (motionField) motionField.hidden = !available(motionField) || isBoardView();
  }

  function optionList(items, selected) {
    return items
      .map((item) => `<option value="${item}"${item === selected ? " selected" : ""}>${item}</option>`)
      .join("");
  }

  function boardThumbHtml(row, index) {
    if (row.img) {
      return `<div class="board-thumb">
        <img src="${row.img}" alt="镜头 ${index + 1} 画面" />
        <button type="button" class="thumb-replace" data-action="replace" data-row="${index}" aria-label="替换第 ${index + 1} 镜画面"><span>替换</span></button>
      </div>`;
    }
    return `<div class="board-thumb is-empty" data-action="replace" data-row="${index}" role="button" tabindex="0" aria-label="为第 ${index + 1} 镜添加画面"><span>+ 首帧</span></div>`;
  }

  function boardRowHtml(row, index) {
    return `<div class="board-row" data-row="${index}">
      <div class="board-num"><span class="grip" title="拖拽排序（原型演示）">⠿</span><span class="idx">${String(index + 1).padStart(2, "0")}</span></div>
      ${boardThumbHtml(row, index)}
      <select class="board-cell-select" data-field="shot" data-row="${index}" aria-label="第 ${index + 1} 镜景别">${optionList(SHOT_SIZES, row.shot)}</select>
      <select class="board-cell-select" data-field="motion" data-row="${index}" aria-label="第 ${index + 1} 镜运镜">${optionList(MOTIONS, row.motion)}</select>
      <textarea class="board-cell-desc" data-field="desc" data-row="${index}" rows="2" maxlength="240" aria-label="第 ${index + 1} 镜画面描述">${escapeHtml(row.desc)}</textarea>
      <input class="board-cell-input" data-field="audio" data-row="${index}" value="${escapeHtml(row.audio)}" maxlength="80" aria-label="第 ${index + 1} 镜台词或音效" />
      <div class="board-duration"><input type="number" data-field="dur" data-row="${index}" min="1" max="8" step="0.5" value="${Number(row.dur)}" aria-label="第 ${index + 1} 镜时长" /><span>s</span></div>
      <div class="board-ops">
        <button type="button" class="board-op" data-action="duplicate" data-row="${index}" title="复制镜头" aria-label="复制第 ${index + 1} 镜"><svg viewBox="0 0 16 16" fill="none"><rect x="5.2" y="5.2" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.1"/><path d="M3 11V3.8C3 3.2 3.2 3 3.8 3H11" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></button>
        <button type="button" class="board-op is-danger" data-action="delete" data-row="${index}" title="删除镜头" aria-label="删除第 ${index + 1} 镜"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 4.5h9M6 4.5V3.2h4v1.3M5 6.2l.5 6.2h5l.5-6.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>`;
  }

  function updateBoardSummary() {
    const board = BOARDS[currentMode];
    if (!board) return;
    const rows = board.rows;
    const total = rows.reduce((sum, row) => sum + Number(row.dur || 0), 0);
    const tokens = getBoardTokens();
    if (boardCount) boardCount.textContent = String(rows.length);
    if (boardTotal) boardTotal.textContent = `${total.toFixed(1)}s`;
    if (boardTokens) boardTokens.textContent = formatTokenCount(tokens);
    if (boardSub) boardSub.textContent = `${rows.length} 镜 · ${total.toFixed(1)}s`;
    if (boardTimeline) {
      boardTimeline.innerHTML = rows
        .map((row) => `<span style="flex:${Math.max(1, Number(row.dur || 1))}"></span>`)
        .join("");
    }
    if (isBoardView()) updateEstimate();
  }

  function renderBoard() {
    const board = BOARDS[currentMode];
    if (!board || !boardRows) return;
    boardTitleText.textContent = board.title;
    boardRows.innerHTML = board.rows.map(boardRowHtml).join("");
    updateBoardSummary();
  }

  function setView(view) {
    const supportsViews = ["t2v", "multi"].includes(currentMode);
    if (!supportsViews) view = "preview";
    currentView = view;
    MODE_VIEWS[currentMode] = view;
    body.dataset.view = view;

    viewSwitch.hidden = !supportsViews;
    viewButtons.forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });

    const board = supportsViews && view === "storyboard";
    storyboardView.hidden = !board;
    panels.forEach((panel) => {
      const active = panel.dataset.panel === currentMode;
      panel.hidden = board || !active;
      panel.classList.toggle("is-active", active && !board);
    });

    syncFieldVisibility();
    if (board) renderBoard();
    updateEstimate();
    pauseVideo();
    if (!isGenerating) hideGeneration();
  }

  // storyboard table events
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  boardRows?.addEventListener("input", (event) => {
    const field = event.target.closest("[data-field]");
    if (!field) return;
    const row = Number(field.dataset.row);
    const board = BOARDS[currentMode];
    if (!board || Number.isNaN(row) || !board.rows[row]) return;
    if (field.dataset.field === "dur") {
      const next = Math.min(8, Math.max(1, Number(field.value) || 1));
      board.rows[row].dur = next;
      updateBoardSummary();
      return;
    }
    board.rows[row][field.dataset.field] = field.value;
  });

  boardRows?.addEventListener("change", (event) => {
    const field = event.target.closest("[data-field]");
    if (!field || field.tagName !== "SELECT") return;
    const row = Number(field.dataset.row);
    const board = BOARDS[currentMode];
    if (board?.rows[row]) board.rows[row][field.dataset.field] = field.value;
  });

  const boardFileInput = document.createElement("input");
  boardFileInput.type = "file";
  boardFileInput.accept = "image/png,image/jpeg,image/webp";
  boardFileInput.hidden = true;
  document.body.appendChild(boardFileInput);
  boardFileInput.addEventListener("change", () => {
    const file = boardFileInput.files?.[0];
    if (!file || pendingThumbRow === null) return;
    const url = URL.createObjectURL(file);
    const board = BOARDS[currentMode];
    if (board?.rows[pendingThumbRow]) {
      board.rows[pendingThumbRow].img = url;
      board.rows[pendingThumbRow].shot = board.rows[pendingThumbRow].shot || "中景";
      renderBoard();
      showToast(`已替换第 ${pendingThumbRow + 1} 镜画面`, "success");
    }
    boardFileInput.value = "";
    pendingThumbRow = null;
  });

  boardRows?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const row = Number(action.dataset.row);
    const board = BOARDS[currentMode];
    if (!board || !board.rows[row]) return;
    if (action.dataset.action === "replace") {
      pendingThumbRow = row;
      boardFileInput.click();
      return;
    }
    if (action.dataset.action === "duplicate") {
      board.rows.splice(row + 1, 0, { ...board.rows[row] });
      renderBoard();
      showToast("已复制镜头", "success");
      return;
    }
    if (action.dataset.action === "delete") {
      const minRows = currentMode === "multi" ? 2 : 1;
      if (board.rows.length <= minRows) {
        showToast(currentMode === "multi" ? "图组视频至少保留 2 个镜头" : "至少保留 1 个镜头");
        return;
      }
      board.rows.splice(row, 1);
      renderBoard();
      showToast("已删除镜头");
    }
  });

  document.getElementById("addBoardRow")?.addEventListener("click", () => {
    const board = BOARDS[currentMode];
    if (!board) return;
    if (board.rows.length >= 9) {
      showToast("最多支持 9 个镜头");
      return;
    }
    const last = board.rows[board.rows.length - 1] || {};
    board.rows.push({
      img: null,
      shot: "中景",
      motion: "缓慢推进",
      desc: "",
      audio: "",
      dur: Math.min(8, Math.max(2, Number(last.dur) || 3))
    });
    renderBoard();
    boardRows.lastElementChild?.classList.add("is-new");
    showToast("已添加一个镜头，可直接编辑");
  });

  document.getElementById("aiBreakdown")?.addEventListener("click", () => {
    BOARDS[currentMode] = JSON.parse(JSON.stringify(DEFAULT_BOARDS[currentMode]));
    renderBoard();
    showToast(`已根据提示词拆分为 ${BOARDS[currentMode].rows.length} 个镜头`, "success");
  });

  document.getElementById("exportCsv")?.addEventListener("click", () => {
    const board = BOARDS[currentMode];
    if (!board) return;
    const header = ["镜号", "景别", "运镜", "画面描述", "台词/音效", "时长(s)"];
    const lines = board.rows.map((row, index) =>
      [String(index + 1).padStart(2, "0"), row.shot, row.motion, row.desc, row.audio, row.dur]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );
    const csv = `\ufeff${header.join(",")}\n${lines.join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lumen-storyboard-${currentMode}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("分镜表已导出 CSV", "success");
  });

  function setMode(mode, options = {}) {
    if (!MODES[mode] || isGenerating) return;
    const previous = currentMode;
    if (previous && promptEl.value.trim()) DRAFTS[previous] = promptEl.value;
    currentMode = mode;
    body.dataset.mode = mode;
    if (!options.keepDraft) promptEl.value = DRAFTS[mode] || "";
    resolution = MODE_RESOLUTION[mode] || (isVideoMode(mode) ? "1080p" : "2K");
    renderResolutionSeg();
    updateCustomResolutionUI();
    updateBitrateUI();

    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    roleFields.forEach((field) => {
      field.hidden = !field.dataset.modes.split(" ").includes(mode);
    });

    const config = MODES[mode];
    modelName.textContent = config.model;
    modelDesc.textContent = config.modelDesc;
    modelTags.innerHTML = config.tags.map((tag) => `<span>${tag}</span>`).join("");
    attachBtn.hidden = !config.attach;
    attachLabel.textContent = config.attachLabel;
    promptEl.placeholder =
      mode === "multi"
        ? "描述整段视频的主题、叙事节奏与视觉风格…"
        : mode === "i2v"
          ? "描述希望画面如何运动…"
          : "描述你想生成的画面…";

    attachments.innerHTML = "";
    updateCharCount();
    const initialView = ["t2v", "multi"].includes(mode)
      ? MODE_VIEWS[mode] || (mode === "multi" ? "storyboard" : "preview")
      : "preview";
    setView(initialView);
  }

  function updateCharCount() {
    charCount.textContent = String(promptEl.value.length);
  }

  promptEl.addEventListener("input", () => {
    DRAFTS[currentMode] = promptEl.value;
    updateCharCount();
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  document.querySelectorAll(".history-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".history-card").forEach((item) => item.classList.remove("is-active"));
      card.classList.add("is-active");
      setMode(card.dataset.modeTarget);
    });
  });

  document.querySelectorAll("#ratioRow button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#ratioRow button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      const ratio = button.dataset.ratio;
      currentRatio = ratio;
      ratioValue.textContent = ratio;
      const nextRatio = ratio.split(":").reduce((a, b) => Number(a) / Number(b));
      document.querySelectorAll(".artboard").forEach((board) => {
        board.style.setProperty("--ar", ratio.replace(":", " / "));
        board.style.setProperty("--ratio", String(nextRatio));
      });
      if (resolution === "custom") {
        if (ratioLocked) fitCustomToRatio();
        else refreshCustomMeta();
      }
      showToast(`画面比例已切换为 ${ratio}`);
    });
  });

  resSeg.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-res]");
    if (!button) return;
    resolution = button.dataset.res;
    MODE_RESOLUTION[currentMode] = resolution;
    renderResolutionSeg();
    updateCustomResolutionUI();
    updateEstimate();
  });

  ratioLock.addEventListener("click", () => {
    ratioLocked = !ratioLocked;
    ratioLock.classList.toggle("is-active", ratioLocked);
    ratioLock.setAttribute("aria-pressed", String(ratioLocked));
    if (ratioLocked && resolution === "custom") {
      setCustomDimension("width", customWidth.value);
    }
  });

  customWidth.addEventListener("input", () => setCustomDimension("width", customWidth.value));
  customHeight.addEventListener("input", () => setCustomDimension("height", customHeight.value));
  customWidth.addEventListener("blur", () => { customWidth.value = CUSTOM_SIZES[sizeKind()].width; });
  customHeight.addEventListener("blur", () => { customHeight.value = CUSTOM_SIZES[sizeKind()].height; });

  resPresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-w]");
    if (!button) return;
    const kind = sizeKind();
    CUSTOM_SIZES[kind] = { width: Number(button.dataset.w), height: Number(button.dataset.h) };
    ratioLocked = false;
    ratioLock.classList.remove("is-active");
    ratioLock.setAttribute("aria-pressed", "false");
    customWidth.value = CUSTOM_SIZES[kind].width;
    customHeight.value = CUSTOM_SIZES[kind].height;
    refreshCustomMeta();
  });

  bitrateSeg.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-bitrate]");
    if (!button) return;
    bitrate = button.dataset.bitrate;
    updateBitrateUI();
    if (bitrate === "custom") {
      customBitratePanel.hidden = false;
      bitrateInput.focus();
    }
  });

  bitrateInput.addEventListener("input", () => {
    customBitrate = clamp(Number(bitrateInput.value) || 16, 2, 80);
    updateBitrateUI();
  });
  bitrateInput.addEventListener("blur", () => {
    bitrateInput.value = customBitrate;
  });

  animSeg.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-anim]");
    if (!button) return;
    animationMode = button.dataset.anim;
    updateAnimationUI();
  });

  document.querySelectorAll("#durationSeg button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#durationSeg button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      duration = Number(button.dataset.duration);
      updateEstimate();
    });
  });

  document.querySelectorAll("#composeSeg button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#composeSeg button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      showToast(button.textContent.trim() === "AI 分镜" ? "已切换为 AI 分镜合成" : "已切换为快剪模板");
    });
  });

  strengthRange.addEventListener("input", () => {
    updateRange(strengthRange);
  });

  document.querySelectorAll(".range").forEach((range) => updateRange(range));
  document.querySelectorAll(".range").forEach((range) => {
    range.addEventListener("input", () => updateRange(range));
  });

  function showToast(message, type = "default") {
    const toast = document.createElement("div");
    toast.className = `toast ${type === "success" ? "success" : ""}`;
    toast.textContent = message;
    toastWrap.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("is-out");
      window.setTimeout(() => toast.remove(), 260);
    }, 2600);
  }

  function hideGeneration() {
    generationOverlay.classList.remove("is-visible");
    generationOverlay.setAttribute("aria-hidden", "true");
    cta.classList.remove("is-loading");
  }

  function runGeneration() {
    if (isGenerating) return;
    if (!promptEl.value.trim()) {
      showToast("先写一句提示词，再开始生成");
      promptEl.focus();
      return;
    }
    isGenerating = true;
    const tokens = getTokens();
    const wasBoard = isBoardView();
    const generationLabel = ctaLabel.textContent;
    cta.classList.add("is-loading");
    generationOverlay.classList.add("is-visible");
    generationOverlay.setAttribute("aria-hidden", "false");
    const stages = wasBoard
      ? [
          { at: 0, label: "正在校验分镜表" },
          { at: 18, label: "正在拆分镜头节奏" },
          { at: 46, label: "正在并行生成各镜" },
          { at: 76, label: "正在统一色调与转场" },
          { at: 94, label: "即将完成合成" }
        ]
      : [
          { at: 0, label: "正在解析画面意图" },
          { at: 22, label: "正在构建潜空间" },
          { at: 52, label: "正在渲染光影与细节" },
          { at: 78, label: "正在整理生成结果" },
          { at: 94, label: "即将完成" }
        ];
    let progress = 0;
    const started = performance.now();
    const total = currentMode === "multi" || wasBoard ? 4200 : 3000;

    const tick = () => {
      const elapsed = performance.now() - started;
      progress = Math.min(99, Math.round((elapsed / total) * 100));
      const stage = [...stages].reverse().find((item) => progress >= item.at) || stages[0];
      genStage.textContent = stage.label;
      genPercent.textContent = `${progress}%`;
      genBar.style.width = `${progress}%`;
      if (elapsed < total) {
        window.setTimeout(tick, 80);
      } else {
        genStage.textContent = "生成完成";
        genPercent.textContent = "100%";
        genBar.style.width = "100%";
        window.setTimeout(() => {
          hideGeneration();
          isGenerating = false;
          addSessionTokens(tokens);
          if (wasBoard) setView("preview");
          const doneLabel = generationLabel.startsWith("生成")
            ? generationLabel.replace("生成", "已生成")
            : generationLabel.replace("合成", "已合成");
          showToast(`${doneLabel} · ${formatTokenCount(tokens)} tokens`, "success");
          addHistoryItem();
        }, 500);
      }
    };
    tick();
  }

  function addHistoryItem() {
    const config = MODES[currentMode];
    const images = {
      t2i: "./assets/1541701494587-cb58502866ab.jpg",
      t2v: "./assets/1462331940025-496dfbfc7564.jpg",
      i2i: "./assets/1634017839464-5c339ebe3cb4.jpg",
      i2v: "./assets/1470071459604-3b5ec3a7fe05.jpg",
      multi: "./assets/1618005198919-d3d4b5a92ead.jpg"
    };
    const row = document.getElementById("historyRow");
    const newCard = document.createElement("button");
    newCard.className = "history-card";
    newCard.setAttribute("aria-label", "新生成结果");
    newCard.innerHTML = `<img src="${images[currentMode]}" alt="" /><span class="history-badge">${currentMode === "t2i" || currentMode === "i2i" ? "图" : currentMode === "multi" ? "组" : "影"}</span><span class="history-tip">刚刚</span>`;
    newCard.addEventListener("click", () => {
      document.querySelectorAll(".history-card").forEach((item) => item.classList.remove("is-active"));
      newCard.classList.add("is-active");
      setMode(currentMode);
    });
    row.insertBefore(newCard, row.firstChild);
    while (row.querySelectorAll(".history-card").length > 5) {
      row.querySelector(".history-card:last-of-type")?.remove();
    }
    const count = document.querySelector(".history-head em");
    if (count) count.textContent = String(row.querySelectorAll(".history-card").length);
    newCard.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  cta.addEventListener("click", runGeneration);

  // ---------- navigation: 工作区 → 项目 → 创作台 → Agent 工作区 ----------
  const PAGES = {
    workspace: workspaceHome,
    project: projectPage,
    studio: studioPage,
    agent: workspacePage
  };

  function renderBreadcrumbs(page) {
    if (!breadcrumbs) return;
    const items = page === "workspace"
      ? [{ label: "工作区", page: "workspace" }, { label: "全部项目" }]
      : page === "project"
        ? [{ label: "工作区", page: "workspace" }, { label: "产品短片" }]
        : page === "studio"
          ? [{ label: "工作区", page: "workspace" }, { label: "产品短片", page: "project" }, { label: "创作台" }]
          : [
              { label: "工作区", page: "workspace" },
              { label: "产品短片", page: "project" },
              { label: "创作台", page: "studio" },
              { label: "Agent 工作区" }
            ];
    breadcrumbs.innerHTML = items
      .map((item, index) => {
        const sep = index ? '<span class="crumb-sep">/</span>' : "";
        return item.page
          ? `${sep}<button class="crumb-link" data-page="${item.page}">${item.label}</button>`
          : `${sep}<span class="crumb-current">${item.label}</span>`;
      })
      .join("");
  }

  function showPage(page) {
    if (!PAGES[page]) page = "workspace";
    Object.entries(PAGES).forEach(([key, element]) => {
      if (element) element.hidden = key !== page;
    });
    body.dataset.page = page;
    railWorkspace.classList.add("is-active");
    railWorkspace.setAttribute("aria-current", "page");
    renderBreadcrumbs(page);
    const jump = {
      workspace: null,
      project: { label: "工作区", target: "workspace" },
      studio: { label: "项目", target: "project" },
      agent: { label: "创作台", target: "studio" }
    }[page];
    if (pageJump) {
      pageJump.hidden = !jump;
      pageJump.textContent = jump ? jump.label : "";
    }
    if (page === "agent" && window.innerWidth > 900) {
      window.setTimeout(() => wsPrompt?.focus(), 120);
    }
  }

  railWorkspace.addEventListener("click", () => showPage("workspace"));
  agentEntry?.addEventListener("click", () => showPage("agent"));
  document.getElementById("backToStudio")?.addEventListener("click", () => showPage("studio"));
  pageJump?.addEventListener("click", () => {
    const targets = { project: "workspace", studio: "project", agent: "studio" };
    const target = targets[body.dataset.page];
    if (target) showPage(target);
  });

  breadcrumbs?.addEventListener("click", (event) => {
    const link = event.target.closest("[data-page]");
    if (link) showPage(link.dataset.page);
  });

  document.querySelectorAll("[data-project]").forEach((card) => {
    card.addEventListener("click", () => showPage("project"));
  });
  document.getElementById("openFirstProject")?.addEventListener("click", () => showPage("project"));
  document.getElementById("enterStudio")?.addEventListener("click", () => showPage("studio"));
  document.getElementById("openProjectAgent")?.addEventListener("click", () => showPage("agent"));
  document.getElementById("openProjectAgent2")?.addEventListener("click", () => showPage("agent"));
  ["newProject", "newProjectCard", "importProject"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => showToast("原型演示：项目创建流程"));
  });
  document.querySelectorAll("[data-agent-session]").forEach((button) => {
    button.addEventListener("click", () => {
      const title = button.querySelector("strong")?.textContent;
      if (title) wsTitle.textContent = title;
      showPage("agent");
    });
  });

  document.querySelector(".ws-session-scroll")?.addEventListener("click", (event) => {
    const button = event.target.closest(".ws-session");
    if (!button) return;
    document.querySelectorAll(".ws-session").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    wsTitle.textContent = button.dataset.title || "新会话";
  });

  wsSearch?.addEventListener("input", () => {
    const query = wsSearch.value.trim().toLowerCase();
    document.querySelectorAll(".ws-session").forEach((item) => {
      const text = `${item.dataset.title || ""} ${item.textContent}`.toLowerCase();
      item.hidden = Boolean(query) && !text.includes(query);
    });
  });

  document.getElementById("wsNewSession")?.addEventListener("click", () => {
    const scroll = document.querySelector(".ws-session-scroll");
    const firstLabel = scroll?.querySelector(".ws-section-label");
    const button = document.createElement("button");
    button.className = "ws-session is-active";
    button.dataset.title = "新会话";
    button.innerHTML = `<span class="ws-session-dot"></span><span class="ws-session-body"><strong>新会话</strong><small>等待任务 · 0 tokens</small></span><time>刚刚</time>`;
    document.querySelectorAll(".ws-session").forEach((item) => item.classList.remove("is-active"));
    if (scroll && firstLabel) scroll.insertBefore(button, firstLabel.nextSibling);
    wsTitle.textContent = "新会话";
    wsThread.innerHTML = `<div class="ws-empty">
      <span class="ws-empty-mark">✦</span>
      <h3>新会话已创建</h3>
      <p>描述你想完成的任务。Agent 会读取工作区素材，自动选择生图、生视频或分镜工具，并在执行前给出计划。</p>
      <div class="ws-empty-hints"><span>试试：把这 4 张图做成 15 秒竖屏广告</span><span>或 @ 引用一张素材</span></div>
    </div>`;
    wsPrompt?.focus();
    showToast("新会话已创建", "success");
  });

  document.getElementById("wsSettings")?.addEventListener("click", () => showToast("工作区设置 · 本地单用户"));
  document.getElementById("wsMore")?.addEventListener("click", () => showToast("会话操作：重命名 / 导出 / 删除"));
  document.getElementById("wsApi")?.addEventListener("click", openApiModal);
  document.getElementById("openStudioFromWs")?.addEventListener("click", () => {
    showPage("studio");
    setMode("multi");
    setView("storyboard");
    showToast("已打开分镜表", "success");
  });
  ["wsAttach", "wsMention", "wsTools"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => {
      showToast(id === "wsTools" ? "可用工具：workspace.inspect / storyboard.plan / media.generate / ffmpeg.compose" : "原型演示：素材引用已就绪");
    });
  });

  function wsScrollToBottom() {
    if (!wsThread) return;
    wsThread.scrollTo({ top: wsThread.scrollHeight, behavior: "smooth" });
  }

  function sendWorkspaceMessage() {
    const text = wsPrompt?.value.trim();
    if (!text) return;
    document.getElementById("wsTyping")?.remove();
    const user = document.createElement("article");
    user.className = "ws-msg ws-user";
    user.innerHTML = `<div class="ws-msg-meta"><span>你</span><time>刚刚</time></div><div class="ws-bubble"></div>`;
    user.querySelector(".ws-bubble").textContent = text;
    wsThread.appendChild(user);
    wsPrompt.value = "";
    const typing = document.createElement("article");
    typing.className = "ws-msg ws-assistant";
    typing.innerHTML = `<div class="ws-avatar">L</div><div class="ws-msg-body"><div class="ws-msg-meta"><span>LUMEN Agent</span><time>刚刚</time></div><div class="ws-typing-line"><i></i><i></i><i></i><span>正在检查素材与工具…</span></div></div>`;
    wsThread.appendChild(typing);
    wsScrollToBottom();
    window.setTimeout(() => {
      typing.remove();
      const reply = document.createElement("article");
      reply.className = "ws-msg ws-assistant";
      reply.innerHTML = `<div class="ws-avatar">L</div><div class="ws-msg-body"><div class="ws-msg-meta"><span>LUMEN Agent</span><span class="ws-msg-model">deepseek-v4-flash</span><time>刚刚</time><em>1,120 tokens</em></div><p></p><div class="ws-plan"><div class="ws-plan-head"><span>执行计划</span><strong>0 / 3</strong></div><div class="ws-plan-step running"><i></i><span>读取工作区素材与参数</span><em>进行中</em></div><div class="ws-plan-step"><i></i><span>调用生成工具</span><em>待执行</em></div><div class="ws-plan-step"><i></i><span>合成并写入作品库</span><em>待执行</em></div></div></div>`;
      reply.querySelector("p").textContent = "收到。我会先读取当前工作区素材和上一轮参数，再决定调用生图还是生视频工具。";
      wsThread.appendChild(reply);
      wsScrollToBottom();
    }, 1100);
  }

  document.getElementById("wsSend")?.addEventListener("click", sendWorkspaceMessage);
  wsPrompt?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendWorkspaceMessage();
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && body.dataset.page === "workspace") {
      event.preventDefault();
      wsSearch?.focus();
    }
  });

  function openApiModal() {
    apiModal.hidden = false;
    document.getElementById("modalClose").focus();
  }

  function closeApiModal() {
    apiModal.hidden = true;
    document.getElementById("apiPill").focus();
  }

  document.getElementById("apiPill").addEventListener("click", openApiModal);
  document.getElementById("railApi").addEventListener("click", openApiModal);
  document.getElementById("modalClose").addEventListener("click", closeApiModal);
  apiModal.addEventListener("click", (event) => {
    if (event.target === apiModal) closeApiModal();
  });

  document.querySelectorAll(".provider-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".provider-tabs button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      const text = button.textContent.trim();
      const base = document.querySelector(".form-field.full input");
      const models = document.querySelectorAll(".form-grid .form-field:not(.full) input");
      if (text.includes("OpenAI")) {
        base.value = "https://api.openai.com/v1";
        models[0].value = "gpt-image-1";
        models[1].value = "sora-2";
      } else if (text.includes("自定义")) {
        base.value = "https://your-gateway.example.com/v1";
        models[0].value = "custom-image-model";
        models[1].value = "custom-video-model";
      } else {
        base.value = "https://ark.cn-beijing.volces.com/api/v3";
        models[0].value = "seedream-4-0-250828";
        models[1].value = "seedance-1-0-pro-250528";
      }
      testState.textContent = "等待测试";
      testState.classList.remove("success");
      testConnection.classList.remove("is-success", "is-testing");
    });
  });

  document.getElementById("toggleKey").addEventListener("click", (event) => {
    const visible = apiKey.type === "text";
    apiKey.type = visible ? "password" : "text";
    event.currentTarget.textContent = visible ? "显示" : "隐藏";
  });

  testConnection.addEventListener("click", () => {
    if (testConnection.classList.contains("is-testing")) return;
    testConnection.classList.add("is-testing");
    testConnection.classList.remove("is-success");
    testState.textContent = "正在握手…";
    testState.classList.remove("success");
    window.setTimeout(() => {
      testConnection.classList.remove("is-testing");
      testConnection.classList.add("is-success");
      testState.textContent = "连接正常 · 312ms";
      testState.classList.add("success");
      showToast("API 连接正常，模型能力已同步", "success");
    }, 1150);
  });

  document.getElementById("saveApi").addEventListener("click", () => {
    closeApiModal();
    showToast("API 配置已安全保存", "success");
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    resolution = isVideoMode() ? "1080p" : "2K";
    MODE_RESOLUTION[currentMode] = resolution;
    CUSTOM_SIZES.image = { width: 2048, height: 1152 };
    CUSTOM_SIZES.video = { width: 1920, height: 1080 };
    ratioLocked = true;
    ratioLock.classList.add("is-active");
    ratioLock.setAttribute("aria-pressed", "true");
    ratioLock.classList.toggle("is-active", ratioLocked);
    currentRatio = "16:9";
    bitrate = "auto";
    customBitrate = 16;
    bitrateInput.value = "16";
    animationMode = "live";
    duration = 5;
    document.querySelectorAll("#durationSeg button").forEach((button) => button.classList.toggle("is-active", button.dataset.duration === "5"));
    document.querySelectorAll("#ratioRow button").forEach((button) => button.classList.toggle("is-active", button.dataset.ratio === "16:9"));
    ratioValue.textContent = "16:9";
    document.querySelectorAll(".artboard").forEach((board) => {
      board.style.setProperty("--ar", "16 / 9");
      board.style.setProperty("--ratio", "1.7778");
    });
    document.getElementById("seedInput").value = "827431";
    document.getElementById("negativePrompt").value = "低清晰度, 变形, 水印, 文字";
    setMode(currentMode, { keepDraft: true });
    updateBitrateUI();
    updateAnimationUI();
    showToast("参数已重置为默认值");
  });

  document.getElementById("newCreation").addEventListener("click", () => {
    promptEl.value = "";
    DRAFTS[currentMode] = "";
    updateCharCount();
    showToast("已新建空白创作");
    promptEl.focus();
  });

  document.getElementById("shortcutBtn").addEventListener("click", () => {
    showToast("按 1–5 切换模式，⌘/Ctrl + Enter 生成");
  });

  const shotItems = [...document.querySelectorAll(".shot-item")];
  const previewImage = document.getElementById("previewImage");
  const previewTag = document.getElementById("previewTag");
  const previewTitle = document.getElementById("previewTitle");
  const previewMeta = document.getElementById("previewMeta");
  const previewPager = document.getElementById("previewPager");

  function selectShot(item) {
    shotItems.forEach((shot) => shot.classList.remove("is-active"));
    item.classList.add("is-active");
    const index = Number(item.dataset.index || 0);
    const total = shotItems.length;
    previewImage.src = item.dataset.img;
    previewTag.textContent = `SHOT ${String(index + 1).padStart(2, "0")} · ${item.dataset.duration}`;
    previewTitle.textContent = item.dataset.title;
    previewMeta.textContent = item.dataset.meta;
    previewPager.textContent = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  }

  shotItems.forEach((item) => {
    item.addEventListener("click", () => selectShot(item));
  });

  document.getElementById("addShot").addEventListener("click", () => {
    showToast("已添加一个分镜空位 · 支持拖入图片");
  });

  document.getElementById("previewSequence").addEventListener("click", () => {
    showToast("正在生成 20 秒合成预览…", "success");
  });

  document.getElementById("regenerateAll").addEventListener("click", () => {
    if (isGenerating) return;
    runGeneration();
  });

  document.getElementById("enhanceBtn").addEventListener("click", () => {
    const extra = "，电影级构图，体积光，35mm 胶片颗粒";
    if (!promptEl.value.includes("体积光")) {
      promptEl.value = `${promptEl.value.replace(/[，。,\s]+$/, "")}${extra}`.slice(0, 1000);
      DRAFTS[currentMode] = promptEl.value;
      updateCharCount();
    }
    showToast("提示词已优化 · 补充了镜头与质感描述", "success");
  });

  function triggerFilePicker() {
    fileInput.click();
  }
  attachBtn.addEventListener("click", triggerFilePicker);
  document.getElementById("replaceSource").addEventListener("click", triggerFilePicker);
  document.getElementById("lastFrameSlot").addEventListener("click", triggerFilePicker);
  document.getElementById("addLastFrame").addEventListener("click", triggerFilePicker);

  fileInput.addEventListener("change", () => {
    const files = [...fileInput.files].slice(0, 9);
    if (!files.length) return;
    files.forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const url = URL.createObjectURL(file);
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      chip.innerHTML = `<img src="${url}" alt="${file.name}" /><button type="button" aria-label="移除图片">×</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        URL.revokeObjectURL(url);
        chip.remove();
      });
      attachments.appendChild(chip);
    });
    showToast(`已添加 ${files.length} 张图片 · 已自动压缩`, "success");
    fileInput.value = "";
  });

  document.getElementById("seedRandom").addEventListener("click", () => {
    document.getElementById("seedInput").value = String(Math.floor(Math.random() * 900000) + 100000);
    showToast("已随机生成 Seed");
  });

  // compare slider
  const compareBoard = document.querySelector(".compare-board");
  const compareLine = document.querySelector(".compare-line");
  if (compareBoard && compareLine) {
    const setSplit = (clientX) => {
      const rect = compareBoard.getBoundingClientRect();
      const percent = Math.min(88, Math.max(12, ((clientX - rect.left) / rect.width) * 100));
      compareBoard.style.setProperty("--split", `${percent}%`);
    };
    compareBoard.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      isDraggingCompare = true;
      compareBoard.setPointerCapture?.(event.pointerId);
      setSplit(event.clientX);
    });
    compareBoard.addEventListener("pointermove", (event) => {
      if (!isDraggingCompare) return;
      setSplit(event.clientX);
    });
    const endDrag = () => { isDraggingCompare = false; };
    compareBoard.addEventListener("pointerup", endDrag);
    compareBoard.addEventListener("pointercancel", endDrag);
    compareBoard.addEventListener("pointerleave", () => { if (!isDraggingCompare) return; });
  }

  // video preview
  function formatTime(seconds) {
    const whole = Math.floor(seconds);
    return `00:${String(whole).padStart(2, "0")}`;
  }

  function setVideoProgress(value) {
    videoProgress = Math.max(0, Math.min(100, value));
    if (timelineFill) timelineFill.style.width = `${videoProgress}%`;
    if (timelineHead) timelineHead.style.left = `${videoProgress}%`;
    if (videoTime) videoTime.textContent = formatTime((videoProgress / 100) * 5);
  }

  function stopVideo(keepProgress = false) {
    if (videoTimer) window.clearInterval(videoTimer);
    videoTimer = null;
    videoPlay?.classList.remove("is-playing");
    if (!keepProgress) setVideoProgress(0);
  }

  function pauseVideo() {
    if (videoTimer) stopVideo(true);
    else videoPlay?.classList.remove("is-playing");
  }

  videoPlay?.addEventListener("click", () => {
    if (videoTimer) {
      stopVideo(true);
      return;
    }
    videoPlay.classList.add("is-playing");
    videoTimer = window.setInterval(() => {
      setVideoProgress(videoProgress + 1.4);
      if (videoProgress >= 100) stopVideo(false);
    }, 80);
  });

  timelineTrack?.addEventListener("click", (event) => {
    const rect = timelineTrack.getBoundingClientRect();
    setVideoProgress(((event.clientX - rect.left) / rect.width) * 100);
  });

  document.querySelectorAll(".play-button.small").forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.toggle("is-playing");
      showToast(button.classList.contains("is-playing") ? "正在预览镜头运动…" : "预览已暂停");
    });
  });

  // mobile / tablet settings drawer
  const inspector = document.getElementById("inspector");
  const inspectorBackdrop = document.getElementById("inspectorBackdrop");
  const mobileParams = document.getElementById("mobileParams");

  function openInspector() {
    inspector.classList.add("is-open");
    inspectorBackdrop.hidden = false;
    mobileParams.setAttribute("aria-expanded", "true");
    if (window.innerWidth <= 800) document.body.classList.add("drawer-open");
  }

  function closeInspector() {
    inspector.classList.remove("is-open");
    inspectorBackdrop.hidden = true;
    mobileParams.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
  }

  mobileParams.addEventListener("click", () => {
    if (inspector.classList.contains("is-open")) closeInspector();
    else openInspector();
  });
  document.getElementById("inspectorClose").addEventListener("click", closeInspector);
  inspectorBackdrop.addEventListener("click", closeInspector);
  document.getElementById("mobileGenerate").addEventListener("click", () => {
    runGeneration();
    closeInspector();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1120) closeInspector();
  });

  // secrets / keyboard
  document.addEventListener("keydown", (event) => {
    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (event.key === "Escape" && !apiModal.hidden) {
      closeApiModal();
      return;
    }
    if (event.key === "Escape" && inspector.classList.contains("is-open")) {
      closeInspector();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      runGeneration();
      return;
    }
    if (!typing && /^[1-5]$/.test(event.key)) {
      const mode = ["t2i", "t2v", "i2i", "i2v", "multi"][Number(event.key) - 1];
      setMode(mode);
    }
  });

  // init
  updateRange(strengthRange);
  updateSessionTokensDisplay();
  setMode("t2i");
  showPage("workspace");
  updateEstimate();
  setVideoProgress(0);
})();
