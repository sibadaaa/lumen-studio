# 施工图 · i18n 国际化与全局主题

> LUMEN 流明 · 多语言与主题切换的实现级方案  
> 版本：v0.1（设计已定稿，待实施）  
> 日期：2026-10-23  
> 配套：[设计稿](./06-i18n-theme-design.md) · [产品设计规范](./01-design-spec.md) · [模型 / 作品 / 素材库施工图](./05-model-works-assets-blueprint.md)

---

## 0. 技术结论（先看这里）

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| i18n 方案 | **react-i18next + i18next**（已确认允许安装依赖；为后续多语言扩展预留） | 标准生态：命名空间、内建 Intl 复数、`CustomTypeOptions` 类型安全、缺 key 回退与开发期提示都是现成能力 |
| 目录组织 | **语言 = 文件夹，页面 = 命名空间 = 子文件夹，公共放 `base/`**（用户指定） | 新增语言 = 复制目录 + 翻译 + 注册一行；页面文案边界清晰 |
| 语言资源 | `locales/<lang>/**/*.{json}` + 每语言 `index.ts` 聚合；静态打包 | 本地单用户、语言包小；后续多语言可切 `import()` 懒加载，结构不变 |
| key 类型安全 | i18next `CustomTypeOptions`（`resources` 由 zh-CN 聚合推导） | 编辑器提示 key；缺 key 在 `tsc` 报错；en 缺译运行时回退 zh-CN |
| 插值与复数 | i18next 内建：`{{param}}`、`_one/_other`（Intl.PluralRules） | 不手写复数逻辑 |
| 主题方案 | CSS 变量重映射 + `html[data-theme]` + `meta color-scheme` | 与现有 token 体系同构；组件零改动 |
| 主题持久化 | `localStorage["lumen.theme"]`（system/light/dark） | 本地单用户 |
| 防闪烁 | `index.html` `<head>` 内联脚本，在 React 之前 resolve 并写 `data-theme`/`color-scheme`/`lang` | 否则浅色系统用户每次进入闪暗屏 |
| 服务端 | **零改动**：错误按 `error.code` 客户端本地化，`message` 作兜底 | API 契约不变；避免 locale 协商与测试面扩大 |
| 硬编码颜色 | 先补齐语义 token（★ 组），再按区块把 `rgba()/hex` 替换为 `var()` | 浅色主题=只覆盖令牌；`styles.css` 共 473 处 rgba / 364 处 hex |
| 媒体区 | `--media-bg` 固定深底，不随主题翻转 | 看片惯例（设计稿 §4.4） |
| 测试 | typecheck（key 类型）+ build + grep 守卫 + DOM 断言；无截图 | 遵循 [AGENTS.md](../AGENTS.md) |

**核心原则：主题只动令牌与 DOM 属性，i18n 只动字符串出口；两者都不触碰 BFF、契约与生成链路。**

### 0.1 与现有实现的兼容点

1. `styles.css` **末尾的 scoped 覆盖块**（`.inspector` 字号等）保持原位、保持可调；仅把其中的字面色替换为 token。
2. `body[data-page]` / `body[data-mode]` 的 CSS 钩子保留；主题用 `html[data-theme]`，互不冲突。
3. `src/data/mock.ts` 的 `DEFAULT_PROMPTS`（用户内容）不迁移；`cta/eta/modelDesc/tags`、`ANIMATION_LABELS`、`SHOT_SIZES`、`MOTIONS` 迁入字典后，`mock.ts` 保留常量**键**，文案在渲染层 `t()`。
4. `src/lib/tokens.ts` 的 `formatTokens/compactTokens` 输出不变（仪表惯例，两语言一致）；`getEstimatedTokens` 等纯计算不动。
5. 现有 `INITIAL_HISTORY`、`demoImage` 等 mock 内容保持中文标题也可不翻（列表条目标题属 mock 数据，翻译属可选 P1）。
6. `tsconfig.app.json` 需补 `"resolveJsonModule": true`（JSON 语言包导入）；仅前端 world，服务端 NodeNext 不受影响。

### 0.2 里程碑

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| M5.1 | 主题基建：★token 补齐 + 浅色调色板 + 防闪烁脚本 + ThemeProvider + 偏好弹层 + 媒体深色面 | 1 天 |
| M5.2 | i18n 基建：安装 react-i18next + locales 目录骨架（语言=文件夹/页面=命名空间/base 公共）+ config/Provider + errors + chrome（rail/topbar/Toast/偏好弹层） | 1 天 |
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
    IP[I18nextProvider<br/>useTranslation / useLocale]
    APP[App 页面树]
    SM[SettingsMenu 偏好弹层]
  end

  subgraph Res["src/i18n/locales"]
    ZH[zh-CN/ base+页面 json]
    EN[en/ base+页面 json]
  end

  CFG[i18n/config.ts<br/>ns / fallback / 检测]
  TYP[i18n/types.d.ts<br/>CustomTypeOptions]
  ERR[base/errors.json<br/>code→文案]
  FMT[i18n/format.ts<br/>Intl]

  LS[(localStorage<br/>lumen.theme / lumen.lang)]
  CSS[styles.css<br/>:root + [data-theme=light]]

  INLINE --> TP & CFG
  TP <--> LS
  CFG <--> LS
  CFG --> ZH & EN
  ZH --> TYP
  IP --> CFG
  APP --> IP
  APP --> FMT & ERR
  SM --> TP & IP
  TP --> CSS
```

- `ThemeProvider` / `I18nextProvider` 相互独立、顺序无要求；`main.tsx` 同时包裹。
- 组件取文案只经 `useTranslation(ns)`；取主题只经 `useTheme()`。禁止组件内直接读 localStorage。

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

### 4.1 依赖与目录

```bash
npm install i18next react-i18next
```

```text
src/i18n/
├── index.tsx            # i18next 实例创建 + I18nextProvider + useLocale
├── config.ts            # SUPPORTED_LANGUAGES / 命名空间 / 检测 / fallback
├── types.d.ts           # CustomTypeOptions（key 类型安全）
├── format.ts            # relativeTime / formatDate / formatBytes（Intl，按 locale）
└── locales/
    ├── zh-CN/
    │   ├── index.ts     # 聚合本语言命名空间
    │   ├── base/{common,nav,errors,settings}.json
    │   ├── workspace/page.json   project/page.json
    │   ├── studio/{composer,inspector,stage,history,storyboard}.json
    │   ├── agent/page.json       api/page.json
    │   └── models/page.json      works/page.json   assets/page.json
    └── en/              # 与 zh-CN 目录一一对应
```

**每语言聚合（zh-CN/index.ts，en 同构）**

```ts
import common from "./base/common.json";
import nav from "./base/nav.json";
import errors from "./base/errors.json";
import settings from "./base/settings.json";
import composer from "./studio/composer.json";
// …其余页面
export const zhCN = {
  base: { common, nav, errors, settings },
  // 单文件页面：直接展开，命名空间 = 页面名（useTranslation("works")）
  workspace: workspacePage,
  project: projectPage,
  agent: agentPage,
  api: apiPage,
  models: modelsPage,
  works: worksPage,
  assets: assetsPage,
  // 多文件页面：二级命名空间（useTranslation("studio.composer")）
  studio: { composer, inspector, stage, history, storyboard },
};
```

> 聚合规则：**一个页面一个文件夹**；单 json（`page.json`）展开为页面命名空间，多 json 以文件名为二级命名空间。en 目录与 zh-CN 完全同构。

**config.ts**

```ts
import i18next, { type i18n as I18n } from "i18next";
import { initReactI18next } from "react-i18next";
import { zhCN } from "./locales/zh-CN";
import { en } from "./locales/en";

export const SUPPORTED_LANGUAGES = [
  { code: "zh-CN", label: "简体中文" },
  { code: "en", label: "English" },
] as const;
export type Locale = (typeof SUPPORTED_LANGUAGES)[number]["code"];
export const NAMESPACES = ["base", "workspace", "project", "studio", "agent", "api", "models", "works", "assets"] as const;

const stored = (localStorage.getItem("lumen.lang") as Locale | null) ?? null;
const initial =
  stored ??
  ((navigator.language || "zh-CN").toLowerCase().startsWith("zh") ? "zh-CN" : "en");

export const i18n: I18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { "zh-CN": zhCN, en },
  lng: initial,
  fallbackLng: "zh-CN",          // 缺译运行时回退
  ns: NAMESPACES,
  defaultNS: "base",
  interpolation: { escapeValue: false },   // React 已转义
  react: { useSuspense: false },           // 资源静态打包，无需 Suspense
  returnEmptyString: false,
  saveMissing: import.meta.env.DEV,        // dev 控制台列出缺译
  missingKeyHandler: import.meta.env.DEV
    ? (_lngs, ns, key) => console.warn(`[i18n] missing ${ns}:${key}`)
    : undefined,
});
```

**类型安全（types.d.ts）**

```ts
import type { zhCN } from "./locales/zh-CN";
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "base";
    resources: typeof zhCN;   // 命名空间与 key 全部获得字面量类型
  }
}
```

> zh-CN 是必须完整的源（类型从这里推导）；en 缺 key 不破坏编译，由 dev `missingKeyHandler` + §5.1 同构校验兜底。

**Provider 与 useLocale / setLocale（index.tsx）**

```tsx
export function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.title = i18n.t("base:meta.title");
  }, [i18n.language]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
export const useLocale = () => i18n.language as Locale;
export function setLocale(locale: Locale) {
  void i18n.changeLanguage(locale);
  try { localStorage.setItem("lumen.lang", locale); } catch { /* 隐私模式降级 */ }
}
```

偏好弹层直接调 `setLocale`；语言选项渲染自 `SUPPORTED_LANGUAGES`（新增语言自动出现）。

### 4.2 组件改造模式（前后对照）

```tsx
// before（Inspector.tsx）
<div className="field-label">画面比例 <span className="field-value">{studio.ratio}</span></div>

// after：页面命名空间绑定，key 不带前缀
const { t } = useTranslation("studio.inspector");
<div className="field-label">{t("aspectRatio")} <span className="field-value">{studio.ratio}</span></div>
```

**命名空间命名与页面文件夹的映射**：`studio/` 下有多个 json，注册为 `studio.composer`、`studio.inspector`…（点号层级），资源树即 `studio: { composer: {...} }`。组件内 `useTranslation("studio.inspector")` → `t("aspectRatio")`。跨命名空间：`t("base:common.save")`。

```tsx
// 插值与复数
const { t } = useTranslation("works");
t("stats.count", { count: list.total })            // "{{count}} 件作品"
t("stats.count", { count: 1 })                     // 自动命中 count_one（en）
// Toast / 错误：code 命中 base/errors.json 才本地化，否则服务端原文
catch (error) {
  const e = error as BffError;
  toast(e.code && i18n.exists(`errors.${e.code}`, { ns: "base" })
    ? i18n.t(`errors.${e.code}`, { ns: "base" })
    : (error as Error).message);
}
```

`src/i18n/index.tsx` 再导出帮助器 `tError(code, fallback)` 封装上述逻辑，供所有 catch 使用。

### 4.3 错误码 → 文案（base/errors.json 覆盖清单）

```text
BFF_OFFLINE, INVALID_REQUEST, INVALID_ACTION, INVALID_MULTIPART, INVALID_CURSOR,
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

- 键名 = 错误码原样大写；`details.upstreamMessage` 折叠原文展示，不翻译。
- `BffError` 已带 `code` 字段；`HTTP_xxx` / `BFF_ERROR` 等 synthetic code 落到 `errors.__fallback__`。

### 4.4 mock.ts 标签迁移（文件落点）

| 现常量 | 迁移到（zh-CN + en 同位置） |
| --- | --- |
| `MODES[m].cta / eta / modelDesc / tags / attachLabel` | `studio/inspector.json`（`modes.{mode}.cta/.eta/.desc/.tag1..3/.attach`）与 `studio/composer.json`（cta/attach）取用；`prompt`、`model`（模型名）**保留原文** |
| `ANIMATION_LABELS / ANIMATION_HINTS` | `studio/inspector.json` `animation.{key}.label / .hint` |
| `SHOT_SIZES / MOTIONS` | `studio/storyboard.json` `shotSizes.0..5` / `motions.0..7`（i18next `returnObjects: true` 取数组） |
| `BITRATE_LABELS`（lib/tokens） | `studio/inspector.json` `bitrate.auto / eight / sixteen / custom` |
| `DEFAULT_PROMPTS / DEFAULT_BOARDS 内容` | 保留原文（示例内容） |
| `INITIAL_HISTORY badge` | `studio/history.json` `badge.image/.video/.group` |

数组取值帮助器（i18n/index.tsx）：`tList("shotSizes", { ns: "studio.storyboard" })` 内部 `i18n.t(key, { returnObjects: true }) as string[]`。

### 4.5 日期与数字替换点

| 位置 | 现状 | 改为 |
| --- | --- | --- |
| `src/library/ui.tsx` `relativeTime` | 「刚刚/分钟前/小时前」硬编码 | `format.ts` `relativeTime(iso, locale)`（`Intl.RelativeTimeFormat`） |
| `WorkspaceHome` / `ProjectPage` 内部 `relative` | 同上 | 删除本地实现，统一 `format.ts` |
| `toLocaleDateString("zh-CN")` 各处 | 固定 locale | `formatDate(iso, locale)` |
| `formatTokens / compactTokens` | 保留 | 不变（仪表惯例）；tooltip 完整值 `Intl.NumberFormat` |

### 4.6 document.title 与静态文案

- `base/meta.json` 或 `base/nav.json` 顶层 `meta.title`：`"LUMEN 流明 · AI 影像工作台"` / `"LUMEN · AI Imaging Workspace"`；`I18nProvider` 副作用写入。
- `index.html` 保留中文静态 title（无 JS 兜底），挂载后被覆盖。

### 4.7 语言包迁移批次（与组件批次对齐）

| 批次 | 组件 | 语言包文件 |
| --- | --- | --- |
| 1 | Provider/config、SettingsMenu、Toast、rail/topbar | `base/{common,nav,settings,errors,meta}.json` |
| 2 | StudioPage/Inspector/PromptComposer/Stage/History | `studio/{composer,inspector,stage,history}.json` |
| 3 | StoryboardTable + mock 标签 | `studio/storyboard.json` |
| 4 | Works/Assets/Models 三页 + library/ui 通用件 | `works/page.json`、`assets/page.json`、`models/page.json` |
| 5 | WorkspaceHome/ProjectPage/ApiModal | `workspace/page.json`、`project/page.json`、`api/page.json` |
| 6 | AgentWorkspace + 收尾（title、日期、aria 清点） | `agent/page.json` |

### 4.8 新增语言 SOP（后续多语言）

1. `cp -r src/i18n/locales/zh-CN src/i18n/locales/<lang>`，逐文件翻译；
2. `locales/<lang>/index.ts` 保持与 zh-CN 同构（json 结构一致即可）；
3. `config.ts` 的 `SUPPORTED_LANGUAGES` 追加 `{ code: "<lang>", label: "…" }`；
4. 验证：dev 控制台无 `[i18n] missing`；偏好弹层自动出现新语言；`npm run typecheck` 通过。
## 5. 测试与验收

### 5.1 自动验证

```bash
npm run typecheck   # CustomTypeOptions：组件内 key 拼错/不存在即报错
npm run build       # 两语言 json 打包 + 无 TS 报错
npm run test:server # 既有 18 项不回归（服务端零改动，应保持不变）
```

- **key 全量校验**：dev 启动后 `missingKeyHandler` 输出应为空；另加一次性 node 断言脚本（评审用）遍历 en 与 zh-CN 的 json 树比对同构：

```bash
node --import tsx -e "import('./src/i18n/locales/zh-CN/index.ts').then(async z=>{const e=await import('./src/i18n/locales/en/index.ts');const walk=(a,b,p='')=>{for(const k of Object.keys(a)){const np=p?p+'.'+k:k;if(!(k in b))throw new Error('en missing '+np);if(typeof a[k]==='object')walk(a[k],b[k],np)}};walk(z.zhCN,e.en);console.log('locales OK')})"
```

**grep 守卫**（评审用，一次性命令，不新增 CI 配置）：

```bash
# 颜色令牌守卫：styles.css 中 :root/[data-theme]/末尾覆盖块之外不应再出现字面琥珀/黑遮罩
grep -n "rgba(231, 183, 120" src/styles.css | awk -F: '$1 > 90'   # 期望仅剩令牌定义区
# 文案守卫：组件内直接写中文 UI 文案（排除 mock 内容与注释）应归零
grep -rn "[一-龥]" src --include="*.tsx" | grep -v "data/mock\|i18n/locales\|//" | wc -l
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
| 安装 `i18next react-i18next`；`tsconfig.app.json` 加 `resolveJsonModule` | `package.json`、`tsconfig.app.json` |
| 目录骨架：zh-CN/en 的 `base/*.json` + 各页面 `page.json` + 每语言 `index.ts` 聚合 | `src/i18n/locales/**` |
| config（SUPPORTED_LANGUAGES/ns/fallback/检测/missing 提示）+ I18nProvider + setLocale + tError | `src/i18n/{index.tsx,config.ts}` |
| key 类型（CustomTypeOptions） | `src/i18n/types.d.ts` |
| format.ts（Intl 日期/相对时间/字节） | `src/i18n/format.ts` |
| chrome 接入（rail/topbar/Toast/SettingsMenu，语言选项读 SUPPORTED_LANGUAGES） | `src/App.tsx`、`Toast.tsx` |
| `BffError.code` 贯通 + tError 接线 | `src/lib/api.ts` |

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
| react-i18next 依赖体积 | bundle +~15KB gzip | 已确认接受；换来的命名空间/复数/类型安全/多语言扩展为正向收益 |
| 多语言后语言包变大 | 打包体积 | 首版静态打包；超过 3 门语言时按语言 `import()` 懒加载（config 仅改资源装载方式，目录结构不变） |
| 服务端文本（Agent 工具 detail、runner stage）中文 | en 下混杂 | v1 接受：状态词客户端映射；服务端文案本地化列为 P2（需 Accept-Language 协商） |

---

## 8. 待确认决策

1. 首启语言策略：跟随浏览器（本方案）还是固定 zh-CN？
2. 顶栏主题快捷图标是否保留（本方案保留，循环三态）？
3. 语言包首版静态打包（本方案）；何时切按语言懒加载？（建议 >3 门语言时）
4. 浅色主题 `--accent: #A96A22`（深琥珀）是否接受？
5. Agent 服务端文本（stage/detail）P2 是否需要服务端 Accept-Language 支持？
6. 是否需要在偏好里加「减少动效」覆盖（跟随系统外强制开关）？v1 建议不做。
7. 页面文件夹内是否允许单文件（`page.json`，本方案允许）还是强制按区块拆分（如 studio）？建议：超过 ~60 key 的页面拆分。
