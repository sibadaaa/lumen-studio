# 设计稿 · i18n 国际化与全局主题

> LUMEN 流明 · 多语言（zh-CN / en）与浅色/深色全局主题的信息架构、交互与视觉设计  
> 版本：v0.1（设计提案，待确认）  
> 日期：2026-10-23  
> 配套：[产品设计规范](./01-design-spec.md) · [模型 / 作品 / 素材库设计稿](./04-model-works-assets-design.md) · [本模块施工图](./07-i18n-theme-blueprint.md)

---

## 0. 交付说明

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| 设计稿 | 本文 | i18n 与全局主题的产品定义、入口、视觉规范、术语表、状态与验收标准 |
| 施工图 | [07-i18n-theme-blueprint.md](./07-i18n-theme-blueprint.md) | 主题令牌改造、内联防闪烁脚本、i18n 架构、字典规划、错误映射、里程碑 |

本轮只交付设计与施工图，不改生产代码；`design/index.html` 原型不新增截图，验证方式遵循 [AGENTS.md](../AGENTS.md)（DOM/样式断言 + typecheck + build）。

## 1. 背景与目标

### 1.1 现状断点

| 断点 | 现状（已审计） | 影响 |
| --- | --- | --- |
| 文案硬编码 | 20 个前端文件共 **707 行**含中文 UI 文案；组件内直接写死字符串 | 无法切换语言；新增文案无统一出口 |
| 单一主题 | [styles.css](../src/styles.css) 仅暗色令牌；`index.html` 固定 `<meta color-scheme="dark">`、`lang="zh-CN"` | 白天/强光环境刺眼；无法跟随系统 |
| 颜色散落 | 473 处 `rgba()`、364 处 hex（大量在 `:root` 之外） | 浅色主题无法通过覆盖 `:root` 完成，需要先令牌化 |
| 错误文案 | BFF 返回中文 `message`（约 45 个错误码） | 切语言后错误仍为中文 |
| 日期/数字 | `relativeTime` 等硬编码「刚刚 / 分钟前」 | 英文语境不自然 |

### 1.2 目标

1. **语言**：zh-CN（默认）与 English 全量 UI 覆盖；切换即时生效、无需刷新；`<html lang>`、`document.title` 同步。
2. **主题**：浅色 / 深色 / 跟随系统三态；切换即时生效、无闪烁（FOUC 防护）；浅色与深色共享同一「琥珀暗房」品牌，只翻转明度不换气质。
3. **零语义漂移**：tokens、模型 ID、用户内容（提示词、项目名、文件名）永不翻译。
4. **可维护**：字典类型化（缺 key 无法通过 typecheck）；新文案必须走 `t()`；颜色必须走 token。

### 1.3 非目标（v1）

- 不做更多语言的内容生产（日/韩等）；但架构按「语言 = 文件夹、页面 = 命名空间」组织，**新增语言只需新增目录并注册一行**（见 §5.7）。
- 不做 RTL 布局。
- **不做服务端 i18n**：BFF 的 `error.message` 保持中文兜底，客户端按 `error.code` 本地化（见 §5.4）；API 契约不变。
- 不翻译：用户提示词、项目名/描述、素材文件名、模型 ID、Agent 会话内容、mock 里的**默认提示词**（属于示例内容）。
- 不做账号级偏好同步（本地单用户，`localStorage` 即持久层）。
- i18n 库使用 **react-i18next / i18next**（已确认允许安装，为后续多语言扩展预留）；不额外引入 `i18next-http-backend`、`i18next-browser-languageDetector` 等插件（本地静态资源 + 自定义 3 行检测即可）。

## 2. 产品定义

### 2.1 偏好设置入口

顶栏新增一个「偏好设置」图标按钮（`Settings2`，置于 LOCAL 徽标与帮助之间），点击打开轻量 popover：

```text
┌──────────────────────────────────────┐
│ 偏好设置                       [×]   │
├──────────────────────────────────────┤
│ 外观                                 │
│ ( ○ 跟随系统  ○ 浅色  ● 深色 )       │
│   跟随系统：白天浅色，夜间深色        │
├──────────────────────────────────────┤
│ 语言 / Language                      │
│ ( ● 简体中文   ○ English )           │
│   界面文案立即切换，无需刷新          │
├──────────────────────────────────────┤
│ 偏好保存在本机浏览器 · 不上传          │
└──────────────────────────────────────┘
```

**行为规则**

| 规则 | 说明 |
| --- | --- |
| 立即生效 | 主题/语言变更即时应用到整棵 DOM；不重载页面、不中断生成任务与 Agent 执行 |
| 持久化 | `localStorage`；键与读取顺序见 §3.2 / §5.3 |
| 快捷入口 | 顶栏太阳/月亮小图标直接循环 浅色→深色→跟随系统（与 popover 状态双向同步） |
| 键盘 | popover 内方向键 + Enter 可选；`Esc` 关闭；焦点圈定 |
| 移动端 | popover 变为底部 Sheet；顶栏图标保留 |

### 2.2 主题模型

| 状态 | 含义 | 落点 |
| --- | --- | --- |
| `system` | 跟随 `prefers-color-scheme`，实时响应系统变化 | 默认值（无存储时） |
| `light` | 强制浅色（暖纸日光暗房） | `data-theme="light"` |
| `dark` | 强制深色（现品牌） | `data-theme="dark"` |

- 存储值三态；应用值两态（resolve 后）。`data-theme` 永远是 `light` 或 `dark`。
- `<meta name="color-scheme">` 随主题更新为 `dark` / `light`，让滚动条、原生控件、表单自动控件跟随。
- 首次访问（无存储）：跟随系统；内联脚本在 React 挂载前完成解析，避免闪白（施工图 §3.1）。

### 2.3 语言模型

| 规则 | 说明 |
| --- | --- |
| 首次语言 | 无存储时按 `navigator.language`：以 `zh` 开头 → `zh-CN`，否则 → `en` |
| 切换 | popover 单选，即时生效；`<html lang>` 与 `document.title` 同步 |
| 回退 | 命名空间缺 key 运行时回退 `fallbackLng=zh-CN`；类型层通过 `CustomTypeOptions` 约束 en 与 zh 同构 |
| 复数 | 使用 i18next 内建 Intl 复数规则：`key_one` / `key_other`（中文不变形，只写 `key_other` 或无后缀） |

## 3. 持久化与初始化

| 键 | 值 | 默认 |
| --- | --- | --- |
| `lumen.theme` | `"system" \| "light" \| "dark"` | `"system"` |
| `lumen.lang` | `"zh-CN" \| "en"` | 按浏览器 |

初始化顺序（防闪烁，详见施工图 §3.1）：

```text
<head> 内联脚本（React 之前）
  → 读 lumen.theme / lumen.lang
  → resolve 主题（matchMedia）→ html[data-theme] + meta color-scheme
  → html lang
React 挂载
  → ThemeProvider / I18nProvider 读取同一存储初始化状态
  → 后续变更只写存储 + 更新 DOM，不再有整页闪烁
```

## 4. 浅色主题视觉规范

### 4.1 设计关键词

**暖纸 / 日光暗房 / 同一琥珀 / 墨色正文**

浅色不是「白底 SaaS」：底色带暖纸的米黄，正文用墨色而非纯黑，琥珀从「发光」转为「颜料」——主 CTA 仍是琥珀底，但整体明度翻转后琥珀更多承担**强调色**而非光晕。禁纯白 `#FFF` 大面积使用、禁纯黑 `#000` 文字。

### 4.2 令牌对照表

深色为现值；浅色为本提案。新增令牌以 ★ 标注（两主题都定义）。

| Token | 深色（现值） | 浅色（新值） | 用途 |
| --- | --- | --- | --- |
| `--bg` | `#07080A` | `#F4F1EA` | 页面底色（暖纸） |
| `--bg-deep` | `#050608` | `#FBF9F4` | 输入/更深面板 |
| `--panel` | `#0B0D10` | `#FCFAF6` | 面板 |
| `--panel-2` | `#101317` | `#F1EDE4` | 输入框、浮层 |
| `--panel-3` | `#15181D` | `#E9E3D7` | hover、选中底 |
| `--line` | `rgba(255,255,255,.075)` | `rgba(31,27,20,.10)` | 分割线 |
| `--line-strong` | `rgba(255,255,255,.12)` | `rgba(31,27,20,.18)` | 浮层边框 |
| `--text` | `#F0ECE4` | `#211C13` | 主文本（墨色） |
| `--text-soft` | `#C7C3BA` | `#4A443A` | 次文本 |
| `--muted` | `#85867F` | `#7A7468` | 辅助 |
| `--muted-2` | `#5E615E` | `#A39C8E` | 占位 |
| `--accent` | `#E7B778` | `#A96A22` | 主操作/强调（浅色下加深保证对比） |
| `--accent-bright` | `#F5D7A6` | `#C98B3D` | hover |
| `--accent-deep` | `#B8803F` | `#7E4F18` | 渐变暗端 |
| `--accent-ink` | `#1D1409` | `#FFF8EC` | 琥珀底上的文字（浅色主题琥珀更深，改用暖白字） |
| `--green` | `#83C99B` | `#2F6B45` | 成功 |
| `--red` | `#E78678` | `#B03A2E` | 失败 |
| `--blue` | `#9AB6CF` | `#3D5E7E` | 信息 |
| `--shadow-stage` | `0 32px 80px -22px rgba(0,0,0,.85)` | `0 24px 64px -30px rgba(31,27,20,.35)` | 画布阴影 |
| ★ `--accent-03/.08/.12/.18/.28` | `rgba(231,183,120,α)` | `rgba(169,106,34,α)` | 琥珀弱底/描边/选中（替换散落的同值 rgba） |
| ★ `--scrim` | `rgba(0,0,0,.55)` | `rgba(31,27,20,.42)` | 遮罩（模态/抽屉底） |
| ★ `--scrim-strong` | `rgba(0,0,0,.78)` | `rgba(31,27,20,.58)` | 深遮罩（生成中遮罩、移动端 Sheet） |
| ★ `--media-bg` | `#050608` | `#14120D` | **媒体查看器固定深底**（见 §4.4），不随主题翻转 |
| ★ `--glow-1/2` | 琥珀/蓝灰氛围光 `rgba` | 同 hue、α 减半 | body 氛围渐变 |
| ★ `--grain-opacity` | `.045` | `.02` | 胶片颗粒强度 |
| ★ `--selection-bg/-text` | 琥珀底/`#FFF8EC` | 琥珀底/墨字 | 选区 |

### 4.3 材质与光

- **颗粒**：两主题共用同一 SVG noise，强度走 `--grain-opacity`；浅色下降到 2%，避免纸面脏感。
- **氛围光**：body 两条 radial 渐变改读 `--glow-1/2`；浅色为「窗光」而非「暗房灯」，α 减半。
- **玻璃**：`backdrop-filter` 强度不变；底色由 `color-mix(in srgb, var(--panel) x%, transparent)` 类写法自然翻转（存量散写需替换为 panel token）。
- **琥珀规则延续**：主 CTA、激活态、关键数字之外不用琥珀；浅色下琥珀文本一律用 `--accent`（加深值），保证 4.5:1。

### 4.4 媒体保持深色区

照片/视频查看遵循「暗房看片」惯例，**以下区域在浅色主题下保持深色底**，通过 `--media-bg` 实现：

| 区域 | 说明 |
| --- | --- |
| 画布（`.stage`） | 结果图/视频的承载底与留白 |
| 作品/素材详情抽屉的预览区 | `.library-preview` |
| 视频播放器与生成中遮罩 | 播放器 chrome、`--scrim-strong` 遮罩 |
| 卡片缩略图底 | 图片未加载时的占位底 |

其余 chrome（卡片边框、元信息、抽屉外壳）跟随主题翻转。

### 4.5 对比度要求

| 组合 | 要求 |
| --- | --- |
| `--text` / `--bg` | ≥ 12:1（两主题） |
| `--text-soft` / `--panel` | ≥ 4.5:1 |
| `--accent` / `--bg`（文本用途） | ≥ 4.5:1（浅色主题以 `#A96A22` 达标） |
| `--accent-ink` / CTA 琥珀底 | ≥ 4.5:1 |
| 禁用态 | 豁免，但需可辨识（不依赖颜色单独传达） |

## 5. i18n 设计

### 5.1 术语表（zh → en，全文统一）

| 中文 | English | 备注 |
| --- | --- | --- |
| 工作区 / 项目 / 创作台 | Workspace / Project / Studio | |
| 作品库 / 素材库 | Works / Assets（页面标题 Works Library / Asset Library） | |
| 模型库 / 模型目录 | Model Catalog | |
| 路由 | Default model routes | 路由 Tab 语境 |
| 文生图 / 图生图 | Text-to-Image / Image-to-Image | |
| 文生视频 / 图生视频 | Text-to-Video / Image-to-Video | |
| 图组视频 | Multi-image Video | |
| 分镜表 | Storyboard | |
| 镜号 / 景别 / 运镜 | Shot / Shot size / Camera motion | |
| 转场 / 合成方式 | Transition / Composition | |
| 清晰度 / 比例 / 码率 | Resolution / Aspect ratio / Bitrate | |
| 负向提示词 / 参考强度 | Negative prompt / Reference strength | |
| 首帧 / 尾帧 | First frame / Last frame | |
| 动画模式（实拍/2D/3D/定格） | Animation (Live / 2D / 3D / Stop-motion) | |
| 另存为素材 | Save as asset | |
| 收藏 / 取消收藏 | Favorite / Unfavorite | |
| 归档 / 未归档 | Archived / Unfiled | |
| 生成 / 合成视频 | Generate / Compose video | |
| 估算 | Estimated | |
| 已连接 / 未配置 | Connected / Not configured | |
| 密钥 / 推理接入点 | API key / Inference endpoint | |
| 获取模型 | Fetch models | |
| 暗房 | Darkroom | 仅品牌语境 |

### 5.2 目录组织与 Key 命名

**以语言为单位建文件夹；语言内以页面为维度建文件夹；跨页面公共文案放 `base/`。**

```text
src/i18n/
├── index.tsx                  # i18next 初始化 + I18nextProvider（useTranslation/useLocale 再导出）
├── config.ts                  # lng/fallback/命名空间/插值 配置
└── locales/
    ├── zh-CN/                 # ← 语言为单位
    │   ├── index.ts           # 聚合本语言全部命名空间 → resources
    │   ├── base/              # ← 公共部分（跨页面）
    │   │   ├── common.json    #   保存/取消/删除/重试/加载中…
    │   │   ├── nav.json       #   rail/面包屑/顶栏
    │   │   ├── errors.json    #   BFF 错误码文案
    │   │   └── settings.json  #   偏好弹层
    │   ├── workspace/page.json
    │   ├── project/page.json
    │   ├── studio/            # ← 页面为维度
    │   │   ├── composer.json
    │   │   ├── inspector.json
    │   │   ├── stage.json
    │   │   ├── history.json
    │   │   └── storyboard.json
    │   ├── agent/page.json
    │   ├── api/page.json      # API 连接弹窗
    │   ├── models/page.json
    │   ├── works/page.json
    │   └── assets/page.json
    └── en/                    # 与 zh-CN 同构（缺目录=缺翻译，dev 控制台列出）
        ├── index.ts
        ├── base/…
        ├── studio/…
        └── …（与 zh-CN 一一对应）
```

- **命名空间 = 页面（或 base）**：`useTranslation("works")` 后组件内直接 `t("empty.title")`；跨页取用 `t("base:common.save")`。聚合规则：单文件页面（`page.json`）展开为页面命名空间；多文件页面（如 `studio/`）以文件名为二级命名空间（`studio.inspector`）。
- 文件内 key 用驼峰短语，不重复命名空间前缀（`works/page.json` 里写 `empty.title` 而非 `works.empty.title`）。
- `base/errors.json` 以错误码为大写键（`PROVIDER_AUTH_FAILED`）。
- 页面内可再拆文件（如 `studio/` 五个）避免单文件过长；一个页面一个 json 也允许（`works/page.json`）。
- **新增一门语言（三步）**：① 复制 `locales/zh-CN/` 为 `locales/<lang>/` 并翻译；② 在 `locales/<lang>/index.ts` 聚合（复制 zh 同构骨架）；③ 在 `config.ts` 的 `SUPPORTED_LANGUAGES` 注册。缺译条目运行时回退 zh-CN，`missingKeyHandler` 在 dev 控制台列出清单；类型层通过 `CustomTypeOptions` 让编辑器直接提示 key。

### 5.3 日期、数字与 tokens

| 类型 | 方案 |
| --- | --- |
| 相对时间 | `Intl.RelativeTimeFormat`（刚刚 / x 分钟前 → just now / x min ago） |
| 绝对时间 | `Intl.DateTimeFormat(locale)`；面板里保留现有紧凑格式 |
| tokens/尺寸/文件大小 | **保持主题无关的等宽数字**，不按 locale 加千分位以外变化；`k/m` 紧凑格式两语言一致（仪表惯例） |
| 文件大小 | `Intl.NumberFormat` + 单位键（KB/MB） |

### 5.4 错误文案策略

```text
BFF 返回 { code, message(中文兜底), retryable }
客户端：errors[code] 存在 → 本地化文案；不存在 → 原样展示 message
```

- 覆盖现有约 45 个错误码（PROVIDER_*、MODEL_*、WORK_*、ASSET_*、UPLOAD_*、TASK_*、STORYBOARD_*、RATE_LIMITED、ORIGIN_NOT_ALLOWED、AGENT_BUSY、INVALID_*、INTERNAL_ERROR、BFF_OFFLINE 等）。
- `details.upstreamMessage` 等上游摘要在错误卡中折叠展示，不做翻译（原文保留可排查）。
- 服务端不做任何改动：`Accept-Language` 不协商，契约不变。

### 5.5 不翻译清单

| 内容 | 处理 |
| --- | --- |
| 提示词、负向词、Seed | 原样 |
| 项目名/描述、素材文件名、作品标题 | 原样 |
| 模型 ID、Provider 自定义标签、`ep-...` | 原样（等宽字体） |
| Agent 会话消息、意图解析结果 | 原样（运行时内容） |
| mock 的默认提示词（DEFAULT_PROMPTS） | 原样（示例内容）；但 `cta/eta/modelDesc/tags` 等 UI 文案迁入字典 |
| 服务端日志、traceId | 原样 |

### 5.6 文案示例（中 / 英，含命名空间用法）

组件内：`const { t } = useTranslation("works")` 后 `t("empty.title")`；`useTranslation("base")` 后 `t("common.save")`。

| 文件（命名空间） | Key | zh-CN | en |
| --- | --- | --- | --- |
| `base/nav.json` | `api.connected` | 已连接 · {{provider}} | Connected · {{provider}} |
| `base/common.json` | `count`（配 `count_one`） | {{count}} 件作品 | {{count}} work(s) |
| `studio/inspector.json` | `aspectRatio` | 画面比例 | Aspect ratio |
| `studio/composer.json` | `cta.image` | 生成图像 | Generate image |
| `works/page.json` | `empty.title` | 还没有作品 | No works yet |
| `works/page.json` | `empty.body` | 去创作台生成第一张图或第一段视频。 | Head to the studio to create your first image or clip. |
| `assets/page.json` | `dropzone` | 拖拽图片到这里上传 · 支持 PNG / JPEG / WebP | Drop images here · PNG / JPEG / WebP |
| `models/page.json` | `sync.done` | 已更新模型目录 · 新增 {{added}}，更新 {{updated}} | Catalog updated · {{added}} added, {{updated}} updated |
| `base/errors.json` | `MODEL_MODE_UNSUPPORTED` | 当前模型不支持该生成模式，请更换模型 | The selected model doesn't support this mode. Pick another model. |
| `base/settings.json` | `title` | 偏好设置 | Preferences |
| `base/settings.json` | `theme.system` | 跟随系统 | Follow system |

> i18next 插值语法为 `{{param}}`；复数后缀 `_one/_other` 由 Intl 规则自动选择。

### 5.7 面向多语言扩展的约定

| 约定 | 说明 |
| --- | --- |
| 语言 = 文件夹 | `locales/<lang>/`；`<lang>` 使用 BCP-47（`zh-CN`、`en`、后续 `ja`、`de`…） |
| 页面 = 命名空间 = 子文件夹 | 新页面新增 `locales/<lang>/<page>/`；`base` 永远存在 |
| 注册点唯一 | `config.ts` 的 `SUPPORTED_LANGUAGES` 数组 + 偏好弹层自动按它渲染语言选项 |
| 缺译策略 | 运行时回退 zh-CN；dev 控制台 `missingKeyHandler` 输出清单；翻译完成后清空 |
| 日期/数字 | `Intl` 按 `locale` 自动适配新语言，无需改格式代码 |

## 6. 交互细节

| 场景 | 行为 |
| --- | --- |
| 切换主题 | 160ms 颜色过渡（仅颜色属性；`prefers-reduced-motion` 时瞬时） |
| 切换语言 | 瞬时替换文本；正在输入的草稿（提示词/标签）不动 |
| 生成中切换 | 允许；任务、SSE、轮询不受影响；进度文案随语言切换 |
| 弹窗/抽屉打开时切换 | 立即生效，无需关闭 |
| `Esc` | 关闭偏好 popover |
| 存储不可写（隐私模式） | 静默降级为会话内生效，不报错 |

## 7. 可访问性

- `<html lang>` 与语言实时同步；混排英文不声明 `lang` 包裹（中文主文档可接受）。
- 主题切换按钮 `aria-label` 描述当前值（「外观：深色，点击切换到浅色」）。
- popover 使用 `role="dialog"` + 焦点圈定；单选组使用 `role="radiogroup"`。
- 两主题均满足 §4.5 对比度；`color-scheme` meta 同步，原生控件深浅一致。
- 翻译后所有图标按钮的 `aria-label` 同样走 `t()`。

## 8. 响应式与布局预留

- 英文比中文长约 **1.3–1.6×**：按钮允许两行（`min-height` 固定），表格列用 `minmax` + 省略号；`作品库/Works Library` 等页面标题自适应。
- 模式栏五模式在英文下横向可用宽度增加约 18%：≤1279px 断点文案缩窄规则保持不变，必要时 `filex` 允许横向滚动（与现一致）。
- 顶栏 tokens 计数、LOCAL 徽标为等宽英文缩写，不随语言变化。

## 9. 验收清单

- [ ] 顶栏偏好入口可切换 主题三态 / 语言二选；状态持久化，刷新后保持。
- [ ] 首次访问跟随系统主题；内联脚本生效，无白屏闪烁。
- [ ] 浅色主题下全部页面（工作区/项目/创作台/Agent/作品库/素材库/模型库/API 弹窗）无不可读文本、无失效对比。
- [ ] 画布与媒体预览在浅色主题下保持深色底。
- [ ] 语言切换后：导航、创作台全部面板、分镜表、库页面、Agent 工作区、API 弹窗、Toast、错误卡全为对应语言。
- [ ] `html lang`、`document.title`、`color-scheme` meta 同步。
- [ ] 已知错误码在英文下显示英文；未知 code 显示服务端原文。
- [ ] 日期/相对时间按语言格式化。
- [ ] 英文长度下 1440/1280/1024/390 四档无横向滚动、无按钮溢出。
- [ ] 不翻译清单（§5.5）内容保持原样。
- [ ] `tsc` 通过：en 字典与 zh 同构；新增文案未走 `t()` 的组件不存在（review 约定）。

## 10. 待确认

1. 英文默认值：无存储且浏览器为英文环境时直接 `en`（本方案），还是始终先 `zh-CN`？
2. 顶栏是否需要独立的太阳/月亮快捷键（本方案有，循环三态），还是只保留 popover？
3. 语言包加载：首版全量静态打包（本方案，两语言 gzip ~10KB）；后续语言多了再按语言 `import()` 懒加载，架构已预留。
4. Agent 工具卡中的**工具名**（`media.generate` 等）保持英文原名不翻译（本方案），是否同意？
5. 浅色主题的 `--accent` 用深琥珀 `#A96A22`（文本对比达标）而非亮琥珀，是否接受视觉变化？
6. 语言切换是否需要出现在左侧导航底部（当前仅顶栏）？
7. 新语言的内容翻译由谁产出（机翻初稿 + 人工校对 / 直接人工）？流程不影响架构。
