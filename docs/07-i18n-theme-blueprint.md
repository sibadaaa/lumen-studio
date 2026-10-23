# 施工图 · i18n 国际化与全局主题

> LUMEN 流明 · 多语言与主题切换的实现级方案  
> 版本：v0.1（设计已定稿，待实施）  
> 日期：2026-10-23  
> 配套：[设计稿](./06-i18n-theme-design.md) · [产品设计规范](./01-design-spec.md) · [模型 / 作品 / 素材库施工图](./05-model-works-assets-blueprint.md)

---

## 0. 技术结论（先看这里）

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| i18n 方案 | **手写极简 i18n**（Context + 类型化字典），不引入 react-i18next | 项目一贯零运行时依赖（无 Router/Query/Zod 前端库）；需求只有 2 语言、纯静态字典，i18next 的运行时开销与抽象无收益 |
| 字典类型 | `zh-CN.ts` 为 source of truth；`en.ts: Dict = typeof zhCN` | 缺 key/多 key 在 `tsc` 阶段报错，无需额外测试 |
| 插值 | `{name}` 占位 + `t(key, params)` 字符串替换 | 覆盖全部现有文案；不需要 ICU 复数（用 `.one` 变体键） |
| 主题方案 | CSS 变量重映射 + `html[data-theme]` + `meta color-scheme` | 与现有 token 体系同构；组件零改动 |
| 主题持久化 | `localStorage["lumen.theme"]`（system/light/dark） | 本地单用户 |
| 防闪烁 | `index.html` `<head>` 内联脚本，在 React 之前 resolve 并写 `data-theme`/`color-scheme`/`lang` | 否则浅色系统用户每次进入闪暗屏 |
| 服务端 | **零改动**：错误按 `error.code` 客户端本地化，`message` 作兜底 | API 契约不变；避免 locale 协商与测试面扩大 |
| 硬编码颜色 | 先补齐语义 token（★ 组），再按区块把 `rgba()/hex` 替换为 `var()` | 浅色主题=只覆盖令牌；`styles.css` 共 473 处 rgba / 364 处 hex |
| 媒体区 | `--media-bg` 固定深底，不随主题翻转 | 看片惯例（设计稿 §4.4） |
| 测试 | typecheck（字典同构）+ build + grep 守卫 + DOM 断言；无截图 | 遵循 [AGENTS.md](../AGENTS.md) |

**核心原则：主题只动令牌与 DOM 属性，i18n 只动字符串出口；两者都不触碰 BFF、契约与生成链路。**

### 0.1 与现有实现的兼容点

1. `styles.css` **末尾的 scoped 覆盖块**（`.inspector` 字号等）保持原位、保持可调；仅把其中的字面色替换为 token。
2. `body[data-page]` / `body[data-mode]` 的 CSS 钩子保留；主题用 `html[data-theme]`，互不冲突。
3. `src/data/mock.ts` 的 `DEFAULT_PROMPTS`（用户内容）不迁移；`cta/eta/modelDesc/tags`、`ANIMATION_LABELS`、`SHOT_SIZES`、`MOTIONS` 迁入字典后，`mock.ts` 保留常量**键**，文案在渲染层 `t()`。
4. `src/lib/tokens.ts` 的 `formatTokens/compactTokens` 输出不变（仪表惯例，两语言一致）；`getEstimatedTokens` 等纯计算不动。
5. 现有 `INITIAL_HISTORY`、`demoImage` 等 mock 内容保持中文标题也可不翻（列表条目标题属 mock 数据，翻译属可选 P1）。

### 0.2 里程碑

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| M5.1 | 主题基建：★token 补齐 + 浅色调色板 + 防闪烁脚本 + ThemeProvider + 偏好弹层 + 媒体深色面 | 1 天 |
| M5.2 | i18n 基建：字典骨架 + Provider + `useT` + errors 映射 + chrome（rail/topbar/Toast/偏好弹层） | 1 天 |
| M5.3 | 创作台全量：StudioPage/Inspector/PromptComposer/Stage/HistoryStrip/StoryboardTable + mock 标签迁移 | 1–1.5 天 |
| M5.4 | 库与配置：Works/Assets/Models 三页 + ApiModal + WorkspaceHome/ProjectPage + 日期格式化替换 | 1–1.5 天 |
| M5.5 | AgentWorkspace 全量 + 收尾（title、a11y、grep 守卫、验收矩阵） | 1 天 |

---

## 1. 现状审计

### 1.1 文案面

- 20 个文件、707 行含中文（清单见设计稿 §1.1）。按模块预估 key 数：

| 模块 | 预估 key | 说明 |
| --- | --- | --- |
| `common`（通用按钮/状态/确认） | ~35 | 保存/取消/删除/重试/加载中/已选 N 件… |
| `nav` + `topbar` | ~25 | rail tooltip、面包屑、API 胶囊、tokens、LOCAL |
| `settings`（偏好弹层） | ~15 | |
| `workspace` / `project` | ~55 | |
| `studio`（含 inspector/composer/stage/history） | ~120 | |
| `storyboard` | ~30 | |
| `agent` | ~70 | 工具名不翻，状态/计划/空态翻 |
| `api`（ApiModal） | ~45 | |
| `models`（模型页） | ~55 | |
| `works` | ~50 | |
| `assets` | ~60 | |
| `errors.*` | ~48 | 全量错误码 |
| **合计** | **~600** | en 字典 gzip 后 ~8–12KB，两包静态打入可接受 |

### 1.2 颜色面（styles.css）

| 类别 | 数量级 | 处理 |
| --- | --- | --- |
| `rgba(231,183,120,α)` 琥珀系 | ~80 处、α∈{.03–.4} | 归并为 `--accent-03/.08/.12/.18/.28` 五档 |
| `rgba(0,0,0,α)` / `rgba(5,6,8,α)` 暗遮罩 | ~30 处 | `--scrim` / `--scrim-strong` / 保留纯阴影 |
| `rgba(255,255,255,α)` 白线/白底 | ~120 处（多数已是 `--line*` 语义，少数散写） | 散写替换为 `--line/--line-strong/--panel-*` |
| `:root` 外 hex | ~360 处（含渐变、阴影、badge 等） | 逐区块替换为既有 token；无 token 的补 token |
| `#fff8ec` 选区字 | 1 处 | `--selection-text` |

**替换守则**：不调视觉、只换引用；每个区块替换后 `npm run build` + 抽查 DOM computed style。

---

## 2. 总体架构

```mermaid
flowchart TB
  subgraph Boot["index.html head（React 之前）"]
    INLINE["内联脚本：读 storage → resolve 主题 → html[data-theme] + color-scheme + lang"]
  end

  subgraph React["React 树"]
    TP[ThemeProvider<br/>useTheme]
    IP[I18nProvider<br/>useT / useLocale]
    APP[App 页面树]
    SM[SettingsMenu 偏好弹层]
  end

  subgraph Dict["src/i18n"]
    ZH[zh-CN.ts 源]
    EN[en.ts: Dict]
    ERR[errors.ts code→key]
    FMT[format.ts Intl]
  end

  LS[(localStorage<br/>lumen.theme / lumen.lang)]
  CSS[styles.css<br/>:root + [data-theme=light]]

  INLINE --> TP & IP
  TP <--> LS
  IP <--> LS
  IP --> ZH & EN & ERR & FMT
  APP --> IP
  SM --> TP & IP
  TP --> CSS
```

- `ThemeProvider` / `I18nProvider` 相互独立、顺序无要求；`main.tsx` 同时包裹。
- 组件取文案只经 `useT()`；取主题只经 `useTheme()`。禁止组件内直接读 localStorage。

---

## 3. 主题施工

### 3.1 防闪烁内联脚本（index.html）

```html
<head>
  <script>
    (function () {
      try {
        var pref = localStorage.getItem("lumen.theme") || "system";
        var dark = pref === "dark" || (pref === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
        var root = document.documentElement;
        root.dataset.theme = dark ? "dark" : "light";
        var meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.setAttribute("content", dark ? "dark" : "light");
        var lang = localStorage.getItem("lumen.lang");
        root.lang = lang || (navigator.language || "zh-CN").toLowerCase().startsWith("zh") ? (lang || "zh-CN") : (lang || "en");
      } catch (e) { /* storage 不可用时用默认 */ }
    })();
  </script>
  <meta name="color-scheme" content="dark" />
  ...
</head>
```

> `index.html` 的静态 `<html lang="zh-CN">`、`color-scheme="dark"` 保留为无 JS 兜底；内联脚本负责覆盖。favicon 底色保持深色（品牌识别，不随主题）。

### 3.2 Token 扩展与浅色覆盖（styles.css）

在 `:root` 末尾追加 ★ 组（深色值），文件中新增 `[data-theme="light"]` 块（浅色全表 = 设计稿 §4.2）。骨架：

```css
:root {
  /* …既有令牌不动… */
  --accent-03: rgba(231, 183, 120, 0.03);
  --accent-08: rgba(231, 183, 120, 0.08);
  --accent-12: rgba(231, 183, 120, 0.12);
  --accent-18: rgba(231, 183, 120, 0.18);
  --accent-28: rgba(231, 183, 120, 0.28);
  --scrim: rgba(0, 0, 0, 0.55);
  --scrim-strong: rgba(0, 0, 0, 0.78);
  --media-bg: #050608;
  --glow-1: rgba(231, 183, 120, 0.075);
  --glow-2: rgba(91, 118, 139, 0.09);
  --grain-opacity: 0.045;
  --selection-bg: rgba(231, 183, 120, 0.28);
  --selection-text: #fff8ec;
}

html[data-theme="light"] {
  color-scheme: light;
  --bg: #f4f1ea;  --bg-deep: #fbf9f4;  --panel: #fcfaf6;
  --panel-2: #f1ede4;  --panel-3: #e9e3d7;
  --line: rgba(31, 27, 20, 0.10);  --line-strong: rgba(31, 27, 20, 0.18);
  --text: #211c13;  --text-soft: #4a443a;  --muted: #7a7468;  --muted-2: #a39c8e;
  --accent: #a96a22;  --accent-bright: #c98b3d;  --accent-deep: #7e4f18;
  --accent-ink: #fff8ec;
  --green: #2f6b45;  --red: #b03a2e;  --blue: #3d5e7e;
  --accent-03: rgba(169, 106, 34, 0.04);
  --accent-08: rgba(169, 106, 34, 0.08);
  --accent-12: rgba(169, 106, 34, 0.12);
  --accent-18: rgba(169, 106, 34, 0.18);
  --accent-28: rgba(169, 106, 34, 0.26);
  --scrim: rgba(31, 27, 20, 0.42);
  --scrim-strong: rgba(31, 27, 20, 0.58);
  --media-bg: #14120d;
  --glow-1: rgba(169, 106, 34, 0.05);
  --glow-2: rgba(61, 94, 126, 0.06);
  --grain-opacity: 0.02;
  --selection-bg: rgba(169, 106, 34, 0.22);
  --selection-text: #211c13;
  --shadow-stage: 0 24px 64px -30px rgba(31, 27, 20, 0.35);
}

/* body 背景改读 glow token；颗粒改读 --grain-opacity（opacity 变量或两层写法） */
/* ::selection { background: var(--selection-bg); color: var(--selection-text); } */
```

**body 渐变与颗粒改造点**：`body` 现有两条 radial 渐变改用 `--glow-1/2`；两处 `feTurbulence` 颗粒层的 `opacity` 改为 `var(--grain-opacity)`（外层容器控制）。

### 3.3 硬编码替换映射表

| 原值（styles.css 中散写） | 替换为 | 备注 |
| --- | --- | --- |
| `rgba(231, 183, 120, .03/.07~.1)` | `var(--accent-03)` / `var(--accent-08)` | 弱底、hover |
| `rgba(231, 183, 120, .12~.18)` | `var(--accent-12)` / `var(--accent-18)` | 描边、进度 |
| `rgba(231, 183, 120, .22~.4)` | `var(--accent-28)` | 选中、发光 |
| `rgba(5, 6, 8, .72~.82)`、`rgba(0,0,0,.5~.6)` | `var(--scrim)` | 卡片徽章底、玻璃底 |
| `rgba(0,0,0,.78~.9)` | `var(--scrim-strong)` | 遮罩、Sheet |
| 散写 `rgba(255,255,255,.03~.12)` | `var(--line)` / `var(--line-strong)` / `var(--panel-3)` | 按语义选 |
| `#fff8ec`（::selection color） | `var(--selection-text)` | |
| 画布/视频容器底 `var(--bg-deep)` 或 `#050608` | `var(--media-bg)` | 仅媒体承载元素 |
| 其余 hex（渐变端点、badge 等） | 就近 token；确无语义的补 token 后再引 | 每区块逐一处理 |

**执行顺序**（每步独立提交，控制回归面）：

1. `:root/[data-theme]` 令牌层 + body 渐变/颗粒 + ::selection；
2. `.stage / .library-* / .media-card / .library-drawer`（M4 新区，最干净）；
3. `.rail / .topbar / .modal / .toast`；
4. `.studio / .inspector / .composer / .stage`；
5. `.workspace / .pp-* / .wh-* / .agent / .models / .provider-*`；
6. 剩余散点 + 末尾 scoped 覆盖块的字面色。

### 3.4 ThemeProvider

```ts
// src/theme/index.tsx
export type ThemePref = "system" | "light" | "dark";
const KEY = "lumen.theme";

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem(KEY) as ThemePref) || "system");
  const resolved = resolve(pref);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", resolved);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { root.dataset.theme = resolve("system"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref, resolved]);
  const update = (next: ThemePref) => {
    setPref(next);
    try { localStorage.setItem(KEY, next); } catch { /* 隐私模式降级 */ }
  };
  return <ThemeContext.Provider value={{ pref, resolved, setTheme: update }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
```

### 3.5 偏好弹层（SettingsMenu）

- `src/components/SettingsMenu.tsx`：popover（桌面右对齐、移动端底部 Sheet）；主题 `role="radiogroup"` 三项 + 语言二项；关闭后焦点回触发按钮。
- 顶栏快捷图标：`Sun`/`Moon`/`Monitor`（lucide）表示当前解析值，点击循环 light→dark→system；`title`/`aria-label` 说明当前值。
- 挂载点：`App.tsx` topbar-right，LOCAL 徽标之前；帮助按钮保持原位。

### 3.6 媒体深色面

- `.stage`、`.library-preview`、视频容器、`.media-card-thumb` 的底色改 `var(--media-bg)`；两主题一致，浅色下形成「看片台」对比。
- 生成中遮罩、图片加载占位用 `--scrim-strong` / `--media-bg`。

---

## 4. i18n 施工

### 4.1 目录与类型

```text
src/i18n/
├── index.tsx            # Locale 类型、I18nProvider、useT、useLocale
├── zh-CN.ts             # source of truth
├── en.ts                # const en: Dict
├── dict.ts              # export type Dict = typeof zhCN; export const dicts = { "zh-CN": zhCN, en }
├── errors.ts            # BFF code → dict key（errors.* 之外可缺省）
└── format.ts            # relativeTime / formatDateTime / formatNumber / formatBytes
```

```ts
// zh-CN.ts（节选）
export const zhCN = {
  common: { save: "保存", cancel: "取消", retry: "重试", delete: "删除", loading: "加载中…" },
  nav: { workspace: "工作区", works: "作品库", assets: "素材库", models: "API 与模型" },
  works: {
    count: "{count} 件作品", countOne: "1 件作品",
    emptyTitle: "还没有作品", emptyBody: "去创作台生成第一张图或第一段视频。",
  },
  errors: { PROVIDER_AUTH_FAILED: "API Key 无效或没有权限", /* … */ },
} as const;

// en.ts
import type { Dict } from "./dict";
export const en: Dict = { /* 同构 */ };

// index.tsx
export function t(dict: Dict, key: string, params?: Record<string, string | number>): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);
  if (typeof value !== "string") return key;
  return params ? value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`)) : value;
}
```

**API**

```ts
const { t, locale, setLocale } = useT  之外单独 useLocale();
t("works.count", { count: 42 });
tCount(count, "works.count", "works.countOne");   // 复数帮助器
tError(code: string | undefined, fallback: string) // errors 命中→本地化；未命中→fallback
```

- `I18nProvider` 同时负责：`document.documentElement.lang`、`document.title`（`title` 键）、`localStorage["lumen.lang"]` 写入。
- 简单 key 路径查找（无代理/无依赖收集），性能足够（每渲染几十次字符串拼接）。

### 4.2 组件改造模式（前后对照）

```tsx
// before（Inspector.tsx）
<div className="field-label">画面比例 <span className="field-value">{studio.ratio}</span></div>

// after
const { t } = useT();
<div className="field-label">{t("studio.inspector.aspectRatio")} <span className="field-value">{studio.ratio}</span></div>
```

- 带参数与选择：

```tsx
// before
<span>{projects.length} 个项目 · {compact(totalTokens)} tokens</span>
// after
<span>{t("workspace.count", { count: projects.length })} · {compact(totalTokens)} tokens</span>
```

- Toast / 错误：

```tsx
// before
catch (error) { toast((error as Error).message); }
// after
catch (error) { toast(tError((error as BffError).code, (error as Error).message)); }
```

### 4.3 错误码 → 文案映射（errors.ts 覆盖清单）

```text
BFF_OFFLINE, HTTP_x（兜底键 errors.genericHttp）
INVALID_REQUEST, INVALID_ACTION, INVALID_MULTIPART, INVALID_CURSOR,
FILE_REQUIRED, PAYLOAD_TOO_LARGE, RATE_LIMITED, ORIGIN_NOT_ALLOWED, NOT_FOUND, INTERNAL_ERROR,
UPLOAD_FAILED, UPLOAD_TOO_LARGE, UPLOAD_NETWORK, UNSUPPORTED_MEDIA_TYPE,
PROJECT_NOT_FOUND, SESSION_NOT_FOUND, AGENT_BUSY,
PROVIDER_NOT_FOUND, PROVIDER_NOT_CONFIGURED, INVALID_PROVIDER_CONFIG,
PROVIDER_AUTH_FAILED, PROVIDER_RATE_LIMITED, PROVIDER_UNAVAILABLE,
PROVIDER_BAD_REQUEST, PROVIDER_BAD_RESPONSE, PROVIDER_HTTP_ERROR, PROVIDER_NETWORK_ERROR,
PROVIDER_EMPTY_RESULT, PROVIDER_TIMEOUT, PROVIDER_TASK_FAILED, MOCK_RENDER_FAILED, MOCK_TASK_NOT_FOUND,
MODEL_NOT_FOUND, MODEL_EXISTS, MODEL_IN_USE, MODEL_NOT_READY, MODEL_MISSING,
MODEL_MODE_UNSUPPORTED, MODEL_ROUTE_INVALID, MODEL_DISCOVERY_AUTH, MODEL_DISCOVERY_NETWORK,
WORK_NOT_FOUND, WORK_FILE_MISSING, WORK_ACTION_FAILED, WORK_SAVE_FAILED,
ASSET_NOT_FOUND, ASSET_IN_USE, ASSET_REFERENCED, ASSET_TAG_LIMIT,
GENERATION_NOT_FOUND, GENERATION_FAILED, TASK_TERMINAL, TASK_NOT_RETRYABLE,
STORYBOARD_REQUIRED, STORYBOARD_INVALID, IMAGE_REQUIRED, PROMPT_REQUIRED, INVALID_DIMENSIONS
```

- 上游细节（`details.upstreamMessage`）原样折叠展示；`traceId` 不翻。
- `BffError` 需要把 `code` 暴露给调用方（已具备 `code` 字段）。

### 4.4 mock.ts 标签迁移

| 现常量 | 迁移后 |
| --- | --- |
| `MODES[m].cta / eta / modelDesc / tags / attachLabel` | `studio.mode.{mode}.cta/eta/desc/tag1..3/attach`（渲染层查）；`prompt`、`model`（模型名）**保留原文** |
| `ANIMATION_LABELS / ANIMATION_HINTS` | `studio.animation.{key}.label / .hint` |
| `SHOT_SIZES / MOTIONS` | `storyboard.shotSize.{i}` / `storyboard.motion.{i}`（数组键） |
| `BITRATE_LABELS`（lib/tokens） | `studio.bitrate.auto/eight/sixteen/custom` |
| `DEFAULT_PROMPTS / DEFAULT_BOARDS 内容` | 保留原文（示例内容） |
| `INITIAL_HISTORY 标题/badge` | badge 单字改用字典 `studio.history.badge.*`；标题保留 |

数组键的取值帮助器：`tList("storyboard.shotSize")` 返回 `string[]`（按索引顺序，字典用对象 `{0:…,1:…}` 或数组，取数组并冻结类型为 tuple）。实现取**对象键 + `Dict` 深层类型**，避免 `as const` 数组在 en 中错位。

### 4.5 日期与数字替换点

| 位置 | 现状 | 改为 |
| --- | --- | --- |
| `src/library/ui.tsx` `relativeTime` | 「刚刚/分钟前/小时前」硬编码 | `format.ts` 的 `relativeTime(iso, locale)`（Intl.RelativeTimeFormat） |
| `WorkspaceHome` / `ProjectPage` 内部 `relative` | 同上 | 删除本地实现，统一 `format.ts` |
| `toLocaleDateString("zh-CN")` 各处 | 固定 locale | `formatDate(iso, locale)` |
| `formatTokens / compactTokens` | 保留 | 不变（仪表惯例）；tooltip 完整值用 `Intl.NumberFormat` |

### 4.6 document.title 与静态文案

- 字典顶层键 `title`：`"LUMEN 流明 · AI 影像工作台"` / `"LUMEN · AI Imaging Workspace"`；`I18nProvider` 副作用写入。
- `index.html` 保留中文静态 title（无 JS 兜底），挂载后被覆盖。

### 4.7 字典分批迁移顺序

与主题 sweep 相同节奏，每批独立提交：

1. `common/nav/topbar/settings` + errors 骨架（Provider、SettingsMenu、Toast 全量接入）；
2. `studio/*` + mock 标签；
3. `works/assets/models` 三页；
4. `workspace/project` + ApiModal；
5. `agent` + 收尾（title、日期、aria-label 清点）。

---

## 5. 测试与验收

### 5.1 自动验证

```bash
npm run typecheck   # en 字典同构 = key 全量；t() 参数为字符串模板
npm run build       # 两语言打包产物 + 无 TS 报错
npm run test:server # 既有 18 项不回归（服务端零改动，应保持不变）
```

**grep 守卫**（评审用，一次性命令，不新增 CI 配置）：

```bash
# 颜色令牌守卫：styles.css 中 :root/[data-theme]/末尾覆盖块之外不应再出现字面琥珀/黑遮罩
grep -n "rgba(231, 183, 120" src/styles.css | awk -F: '$1 > 90'   # 期望仅剩令牌定义区
# 文案守卫：组件内直接写中文 UI 文案（排除 mock 内容与注释）应归零
grep -rn "[一-龥]" src --include="*.tsx" | grep -v "data/mock\|//" | wc -l
```

### 5.2 DOM 断言（Playwright，不截图）

1. `localStorage.lumen.theme="light"` 后加载：`html[data-theme="light"]`、`meta[color-scheme=light]`、body computedStyle `background` 为浅色值。
2. 点击偏好 → 切换 `en`：rail tooltip 变 “Workspace”，`html[lang=en]`、`document.title` 变更；刷新后保持。
3. 生成失败（无 Key Provider）错误卡在 en 下显示 `errors.PROVIDER_AUTH_FAILED` 英文。
4. 浅色主题下 `.stage` computedStyle `background-color` 仍为 `--media-bg` 深色。
5. `prefers-color-scheme` mock 为 light + 存储为 system → 初始即浅色，无暗屏闪烁（读取 `html.dataset.theme` 于 `DOMContentLoaded` 前）。

### 5.3 验收矩阵

| 模块 | 验收项 |
| --- | --- |
| 主题 | 三态切换/持久化/系统跟随/无闪烁；浅色全页面对比度；媒体深色面 |
| i18n | 两语言全量（~600 key）；复数；插值；title/lang/color-scheme |
| 错误 | 45+ code 命中映射；未命中兜底原文 |
| 回归 | 生成/Agent/上传/库操作在切换中不中断；styles scoped 覆盖块可调性不变 |
| 守卫 | grep 颜色/文案归零；typecheck 拦截缺 key |

---

## 6. 里程碑任务拆分

### M5.1 主题基建（1 天）

| 任务 | 文件 |
| --- | --- |
| 内联脚本 + meta | `index.html` |
| ★token + 浅色覆盖 + body/颗粒/选区 | `src/styles.css` |
| ThemeProvider/useTheme | `src/theme/index.tsx` |
| SettingsMenu + 顶栏图标 | `src/components/SettingsMenu.tsx`、`src/App.tsx` |
| 媒体深色面 | `.stage/.library-preview/.media-card-thumb` |
| sweep 第 1–2 批 | styles.css |

### M5.2 i18n 基建（1 天）

| 任务 | 文件 |
| --- | --- |
| 字典骨架 + 类型 + Provider/useT | `src/i18n/*` |
| errors 映射 | `src/i18n/errors.ts` |
| format.ts | `src/i18n/format.ts` |
| chrome 接入（rail/topbar/Toast/SettingsMenu） | `src/App.tsx`、`Toast.tsx` |
| `BffError.code` 贯通 | `src/lib/api.ts` |

### M5.3 创作台（1–1.5 天）

`StudioPage / Inspector / PromptComposer / Stage / HistoryStrip / StoryboardTable / StudioContext`（stage 阶段文案、错误 toast）+ `data/mock.ts` 标签迁移 + styles sweep 第 4 批。

### M5.4 库与配置（1–1.5 天）

`WorksLibrary / AssetsLibrary / ModelsPage / ApiModal / WorkspaceHome / ProjectPage` + `library/ui.tsx` 通用件（EmptyState/SelectionBar/Drawer 头）+ 日期替换 + sweep 第 3/5 批。

### M5.5 收尾（1 天）

`AgentWorkspace` 全量 + `agent/runtime` 输出文案的客户端映射（工具 detail 属服务端文本，P1 处理：按 `tool.name + status` 本地化状态词）+ `document.title` + grep 守卫清零 + 验收矩阵执行 + `03-api-contract` 无需变更说明。

---

## 7. 风险与备选

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| styles sweep 面大（~500 处），改错视觉 | 回归 | 分 6 批、每批 build + computed style 抽查；只换引用不改值 |
| 浅色对比不足（琥珀文本、muted） | 可读性 | §4.5 对比度矩阵 + 断言脚本抽查关键组合 |
| en 文案过长撑破布局 | 布局 | §8 预留；按钮 min-height + 允许两行；四断点手测 |
| 字典 key 漂移 | 漏翻 | `Dict` 类型同构 + typecheck；review 约定新文案必须 `t()` |
| 复数/插值滥用 | 文案质量 | 仅 `.one` 变体 + `{param}`；复杂复数场景改写句子规避 |
| 切换语言打断用户输入 | 体验 | 语言切换只影响渲染文本，不重置任何 state（草稿保留） |
| react-i18next 备选 | — | 否决：2 语言静态字典无命名空间/加载/ICU 需求；手写 ~80 行可类型化 |
| 服务端文本（Agent 工具 detail、runner stage）中文 | en 下混杂 | v1 接受：状态词客户端映射；服务端文案本地化列为 P2（需 Accept-Language 协商） |

---

## 8. 待确认决策

1. 首启语言策略：跟随浏览器（本方案）还是固定 zh-CN？
2. 顶栏主题快捷图标是否保留（本方案保留，循环三态）？
3. 英文字典静态打包（本方案）还是 `import()` 懒加载？
4. 浅色主题 `--accent: #A96A22`（深琥珀）是否接受？
5. Agent 服务端文本（stage/detail）P2 是否需要服务端 Accept-Language 支持？
6. 是否需要在偏好里加「减少动效」覆盖（跟随系统外强制开关）？v1 建议不做。
