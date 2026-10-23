# 修复方案 · 主题可读性与创作台素材项目隔离

> LUMEN 流明 · 浅色主题顶栏/创作台可读性修复 + 创作台素材按项目隔离  
> 版本：v0.1（待实施）  
> 日期：2026-10-23  
> 配套：[i18n 与全局主题设计稿](./06-i18n-theme-design.md) · [i18n 与全局主题施工图](./07-i18n-theme-blueprint.md) · [API 契约](./03-api-contract.yaml) · [AGENTS.md](../AGENTS.md)

---

## 0. 结论摘要

| 问题 | 根因 | 修复方向 |
| --- | --- | --- |
| 切换外观后 header 按钮看不清 | 浅色主题下 `.topbar` / `.rail` 仍使用深色硬编码背景，按钮文字也是深色主题固定值 | 顶栏/侧栏表面跟随主题，文字统一改用语义 token |
| 工作区进入项目后进入创作台看不清 | ① 深色主题缺少 `--cta-from` / `--cta-to`，主按钮背景为透明；② 浅色主题下创作台仍大量使用深色主题字色 | 补深色主题 CTA 变量；创作台 chrome 字色 token 化，媒体区保持深色 |
| 创作台素材串项目 | 素材选择器未传 `projectId`；切换项目不清理创作台状态；前端 intent 与服务端均未校验素材归属 | 选择器按项目过滤、切换项目重置状态、intent 拦截、服务端兜底校验 |

本轮**不改变生成链路、不改数据库结构**；除 `POST /generations` 增加输入素材归属校验外，API 形状不变。

---

## 1. 问题与证据

### 1.1 切换外观后 header 按钮看不清

浅色主题下，顶栏与侧栏仍使用深色硬编码背景：

- `src/styles.css:317` `.topbar` → `rgba(8, 9, 11, 0.56)`
- `src/styles.css:200` `.rail` → `rgba(7, 8, 10, 0.66)`

按钮文字则混用了多套固定颜色：

- `.api-pill` → `#bcbcb3`（`styles.css:380`）
- `.token-chip` → `#d8d2c5`（`:415`）
- `.local-badge` → `#686c65`（`:449`）
- `.crumb-sep` → `#3c3e3e`（`:344`）
- `.wordmark` → `#f4eadb`（`:332`）

浅色背景下，顶栏实际合成底色约 `#6f6f6d`，浏览器计算样式核对结果：

| 元素 | 对比度 |
| --- | --- |
| `.local-badge` | ≈ 0.95:1 |
| 顶栏图标按钮 | ≈ 1.09:1 |
| `.api-pill` | ≈ 2.65:1 |

问题不在单个按钮，而在**浅色主题下 chrome 表面没有翻转，文字仍按深色主题取值**。

### 1.2 工作区进入项目后进入创作台看不清

#### 根因 A：深色主题主按钮背景变量缺失

`--cta-from` / `--cta-to` 只在 `html[data-theme="light"]` 中定义（`styles.css:8327-8328`），`:root` 未定义。

浏览器实测：

- `.ws-primary`（“新建项目”“进入创作台”）→ `background-image: none`
- `.cta`（“生成图像”）→ `background-image: none`
- `.ws-send`（Agent 发送）→ `background-image: none`
- 文字色 `--accent-ink` 为 `#1d1409`，透明底 + 深色字，几乎不可见

这是默认深色主题下主按钮不可读的直接原因，也会影响项目页的“进入创作台”按钮。

#### 根因 B：浅色主题下创作台仍使用深色主题字色

创作台面板背景已跟随主题变浅，但文字仍为硬编码浅色：

- `#prompt` 文字 `#ebe6db`，composer 背景 `#f1ede4`，对比度约 **1.07:1**
- `.mode-tab.is-active` 文字 `#f6eee1`，浅色 accent 底上约 **1.05:1**
- `.prompt-label`、`.char-count`、`.attach-btn`、`.text-tool` 等同样使用深色主题固定值
- `.inspector` 背景固定 `rgba(10, 12, 14, 0.82)`，未跟随浅色主题

设计文档 `06-i18n-theme-design.md §4.4` 明确只要求画布/媒体预览保持深色；设置栏属于 chrome，应跟随主题。

### 1.3 创作台素材串项目

当前有三处漏洞：

1. **素材选择器未按项目过滤**
   - `src/studio/PromptComposer.tsx:102-106` 渲染 `AssetPickerDialog` 时未传 `projectId`
   - 实测 `GET /api/v1/assets?limit=100` 返回 4 个素材，分属 2 个项目
   - `GET /api/v1/assets?projectId=proj_product` 只返回 2 个

2. **切换项目不清理创作台状态**
   - `StudioProvider` 只在 `projectId` 变化时更新 `projectIdRef`（`StudioContext.tsx:231、279`）
   - 未清理：`attachments`、分镜行 `assetId` / 图片、`history`、`lastOutput`、`activeJobId`、`generationError`
   - 上一个项目的素材可能继续被提交到新项目

3. **缺前端 intent 与服务端归属校验**
   - `applyIntent` 直接接收素材库传入的 `asset`（`StudioContext.tsx:581-583`）
   - `POST /generations` 只校验项目存在（`server/index.ts:1026-1028`），未校验 `assetId` 是否属于该项目

---

## 2. 修改方案

### 2.1 主题令牌层

在 `:root` 补齐深色主题缺失变量，并新增 chrome 表面令牌：

```css
:root {
  /* 修复深色主题主按钮 */
  --cta-from: #eec78e;
  --cta-to: #d6a661;

  /* chrome 表面：深色值 */
  --topbar-bg: rgba(8, 9, 11, 0.56);
  --rail-bg: rgba(7, 8, 10, 0.66);
  --surface-inspector: rgba(10, 12, 14, 0.82);
  --surface-inspector-foot: rgba(8, 9, 11, 0.62);

  /* 激活态文字：深色主题用亮琥珀 */
  --accent-text: #f5d7a6;
}
```

浅色主题覆盖：

```css
html[data-theme="light"] {
  --topbar-bg: rgba(252, 250, 246, 0.78);
  --rail-bg: rgba(252, 250, 246, 0.82);
  --surface-inspector: rgba(252, 250, 246, 0.9);
  --surface-inspector-foot: rgba(252, 250, 246, 0.94);
  --accent-text: #a96a22;
}
```

### 2.2 Header / rail

替换硬编码颜色：

| 选择器 | 当前值 | 改为 |
| --- | --- | --- |
| `.topbar` background | `rgba(8,9,11,.56)` | `var(--topbar-bg)` |
| `.rail` background | `rgba(7,8,10,.66)` | `var(--rail-bg)` |
| `.wordmark` color | `#f4eadb` | `var(--text)` |
| `.crumb-sep` / `.breadcrumbs .crumb-sep` | `#3c3e3e` / `#3f423e` | `var(--muted-2)` |
| `.autosave` | `var(--muted-2)` | `var(--muted)` |
| `.autosave i` | `#647066` | `var(--green)` |
| `.api-pill` color | `#bcbcb3` | `var(--text-soft)` |
| `.token-chip` color | `#d8d2c5` | `var(--text-soft)` |
| `.token-value` | `#e8d8bc` | `var(--text)` |
| `.token-unit` | `#6e716a` | `var(--muted)` |
| `.local-badge` | `#686c65` | `var(--muted)` |
| `.page-jump` | `#d8bd95` | `var(--accent)` |
| `.rail-item` | `#6e706c` | `var(--muted)` |
| `.rail-item::after` | `#1c1e22` | `var(--panel-3)` |
| `.crumb-link` | `#8a8c84` | `var(--muted)` |
| `.crumb-current` | `#e3dbce` | `var(--text-soft)` |

目标：深色主题视觉基本不变；浅色主题顶栏/侧栏变成暖纸浅色，按钮和图标自动获得足够对比度。

### 2.3 创作台可读性

1. 补齐深色主题 `--cta-from` / `--cta-to`，恢复所有主按钮。
2. 创作台 chrome 字色 token 化：

| 区块 | 选择器 |
| --- | --- |
| 模式栏 | `.mode-tab`、`.mode-tab:hover`、`.mode-tab.is-active`、`.view-switch button`、`.view-switch button.is-active` |
| 草稿/快捷键 | `.draft-state`、`.shortcut-hint`、`kbd` |
| Composer | `.prompt-label`、`.lang-tag`、`.text-tool`、`.char-count`、`#prompt`、`#prompt::placeholder`、`.attach-btn`、`.mobile-params`、`.mobile-close`、`.estimate-inline` |
| 历史条 | `.history-head > span`、`.history-head em`、`.history-new` |
| Inspector | `.inspector` 背景、`.inspector-head h2`、`.field-label`、`.field-value`、`.model-info strong/small`、`.model-tags span`、`.ratio-row`、`.segmented`、`.select-like`、`.custom-res`、`.dim-input`、`.custom-bitrate`、`.res-presets`、`.advanced`、`.queue-card`、`.inspector-foot`、`.estimate`、`.secure-note` |
| 其他 | `.agent-entry` 文字、`.agent-entry kbd` |

主要映射：

- 主文字：`var(--text)`
- 次文字：`var(--text-soft)`
- 辅助文字：`var(--muted)` / `var(--muted-2)`
- 激活态：`var(--accent-text)`
- 控件底色：`var(--panel-3)` / `var(--raise-1)`，不再写 `rgba(0,0,0,.2)`
- Inspector 背景：`var(--surface-inspector)`
- Inspector foot：`var(--surface-inspector-foot)`

**保持深色的区域**：`.stage`、`.status-chip`、`.glass-icon`、`.glass-tag`、`.art-caption`、生成中遮罩、历史缩略图上的 badge / play。这些属于“媒体上看片”的 chrome，按设计文档不随主题翻转。

### 2.4 素材项目隔离

#### 2.4.1 暴露当前项目

- `StudioContextValue` 增加 `projectId?: string`
- Provider 返回当前 `projectId`

#### 2.4.2 素材选择器传入项目

```tsx
<AssetPickerDialog
  open={pickerOpen}
  projectId={studio.projectId}
  onClose={() => setPickerOpen(false)}
  onPick={(asset) => studio.attachAsset(asset, pickerRole)}
/>
```

`AssetPickerDialog` 已有 `projectId` 参数与请求过滤逻辑，补上调用即可。可增加一行提示：“仅显示当前项目素材”。

#### 2.4.3 切换项目重置项目级状态

在 `StudioProvider` 增加 `useEffect(..., [projectId])`：

- 清空 `attachments` / `attachmentsRef`
- 重置分镜 `boards` 中的图片与 `assetId`（保留分镜结构）
- 清空 `history`
- 清空 `lastOutput` / `activeJobId` / `generationError`
- 清理轮询计时器，递增 `pollTokenRef`
- 递增 `projectEpochRef`，旧上传/生成回调不再写入新项目状态

如果切换时正在生成：结束本地轮询并提示“项目已切换，创作台已重置”；服务端任务仍属于旧项目，不影响数据。

#### 2.4.4 拦截跨项目 intent

`applyIntent` 处理 `incoming.asset`：

- 若 `asset.projectId` 存在且不等于当前 `projectId`，不附加
- 提示：“该素材属于其他项目，请先在素材库移动到当前项目。”

处理 `incoming.work`：

- 若 `work.projectId` 与当前项目不一致，只恢复提示词/参数，不恢复 `work.inputs` 中的素材
- 提示素材未载入

#### 2.4.5 服务端兜底校验

在 `POST /generations` 创建任务前校验：

- `inputs[].assetId`
- `storyboard[].assetId`

规则：

| 情况 | 错误码 |
| --- | --- |
| 素材不存在 | `ASSET_NOT_FOUND` |
| `request.projectId` 与 `asset.projectId` 都存在且不同 | `ASSET_PROJECT_MISMATCH` |

允许 `asset.projectId` 为空（未归档/历史素材），避免破坏旧数据。

新增错误文案：

- `src/i18n/locales/zh-CN/base/errors.json`
- `src/i18n/locales/en/base/errors.json`

同步更新 `docs/03-api-contract.yaml` 的错误码说明。

#### 2.4.6 库入口项目上下文

`App.tsx` 打开新项目时，建议同时重置 `libraryProjectId` 与 `studioIntent`，避免从项目 A 的素材库返回后，项目 B 仍沿用 A 的筛选。

---

## 3. 施工方案

### 3.1 实施顺序

| 步骤 | 内容 | 文件 | 验证 |
| --- | --- | --- | --- |
| 0 | 补深色主题 `--cta-from/to`，恢复主按钮 | `src/styles.css` | 深色下 `.ws-primary` / `.cta` 的 `background-image` 不为 `none` |
| 1 | 新增顶栏/侧栏/Inspector 表面令牌，替换 header 硬编码色 | `src/styles.css` | 浅色下 header 按钮对比度 ≥ 4.5:1；图标 ≥ 3:1 |
| 2 | 创作台模式栏 / Composer / Inspector 字色 token 化 | `src/styles.css` | 浅色下 `#prompt` 文字为 `var(--text)`，对比度 ≥ 4.5:1 |
| 3 | StudioContext 暴露 `projectId`，切换项目清理状态 | `src/studio/StudioContext.tsx` | 项目 A → B 后 attachments/history 为空，分镜无旧 assetId |
| 4 | 素材选择器传 `projectId`，intent 增加跨项目拦截 | `src/studio/PromptComposer.tsx`、`src/assets/AssetPickerDialog.tsx`、`StudioContext.tsx` | 项目 A 的 picker 请求只带 A 的 projectId，列表不出现 B 的素材 |
| 5 | 服务端校验输入素材项目归属 | `server/index.ts` | 跨项目 `assetId` 返回 422 `ASSET_PROJECT_MISMATCH` |
| 6 | 补错误文案与 API 契约 | `src/i18n/locales/**/base/errors.json`、`docs/03-api-contract.yaml` | typecheck + test:server 通过 |
| 7 | 回归验证 | — | `npm run typecheck`、`npm run test:server`、`npm run build`；Playwright DOM 断言，不截图 |

### 3.2 文件清单

| 文件 | 改动 |
| --- | --- |
| `src/styles.css` | 主题令牌、顶栏/侧栏、创作台 chrome、Inspector 表面与字色 |
| `src/studio/StudioContext.tsx` | 暴露 `projectId`；项目切换重置；intent 拦截；上传/生成回调 epoch 保护 |
| `src/studio/PromptComposer.tsx` | 向 `AssetPickerDialog` 传 `projectId` |
| `src/assets/AssetPickerDialog.tsx` | 可选：补充“仅当前项目”提示与请求竞态保护 |
| `src/App.tsx` | 打开新项目时重置 `libraryProjectId` / `studioIntent` |
| `server/index.ts` | `POST /generations` 校验输入素材项目归属 |
| `src/i18n/locales/zh-CN/base/errors.json` | 新增 `ASSET_PROJECT_MISMATCH` |
| `src/i18n/locales/en/base/errors.json` | 新增英文文案 |
| `docs/03-api-contract.yaml` | 补充新错误码说明 |
| `server/tests/assets.test.ts` 或新增测试 | 覆盖素材项目过滤与跨项目校验 |

### 3.3 关键代码要点

#### 服务端校验伪代码

```ts
if (request.projectId) {
  const assetIds = [
    ...parsed.inputs.map((input) => input.assetId),
    ...(parsed.storyboard || []).map((row) => row.assetId),
  ].filter((id): id is string => Boolean(id));

  for (const assetId of assetIds) {
    const asset = assetStore.getDetail(assetId);
    if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "素材不存在");
    if (asset.projectId && asset.projectId !== request.projectId) {
      throw new ApiError(422, "ASSET_PROJECT_MISMATCH", "素材属于其他项目，请先移动到当前项目");
    }
  }
}
```

#### 项目切换 epoch 保护

```ts
const projectEpochRef = useRef(0);

useEffect(() => {
  projectEpochRef.current += 1;
  pollTokenRef.current += 1;
  if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
  // 清理 attachments / boards / history / output
}, [projectId]);
```

上传回调中：

```ts
const epoch = projectEpochRef.current;
// ...
if (epoch !== projectEpochRef.current) return;
```

### 3.4 兼容边界

- `asset.projectId` 为空的历史素材仍允许使用。
- 不修改 SQLite schema；`assets.project_id` 已存在。
- 不改变 `GenerationRequest` 字段；仅增加服务端校验。
- 不改变媒体区深色策略；只翻转 chrome。
- 不新增前端测试框架；用一次性 Playwright DOM 断言与现有 `typecheck` / `test:server` / `build` 验证。

---

## 4. 验收与测试

### 4.1 命令

```bash
npm run typecheck
npm run test:server
npm run build
```

### 4.2 Playwright DOM 断言（不截图）

1. **深色主题主按钮**
   - 打开工作区、项目页、创作台
   - 断言 `.ws-primary`、`.cta`、`.ws-send` 的 `background-image` 不为 `none`
   - 断言文字与背景对比度 ≥ 4.5:1

2. **浅色主题 header**
   - `localStorage.lumen.theme="light"` 后加载
   - 断言 `.topbar` / `.rail` 计算背景为浅色
   - 断言 `.api-pill`、`.token-chip`、`.local-badge`、`.icon-btn` 对比度 ≥ 4.5:1（图标 ≥ 3:1）

3. **浅色主题创作台**
   - 进入项目 → 创作台
   - 断言 `#prompt` 的 `color` 等于 `var(--text)` 解析值
   - 断言 `.mode-tab.is-active`、`.prompt-label`、`.field-label` 对比度 ≥ 4.5:1
   - 断言 `.stage` 背景仍为 `--media-bg` 深色

4. **素材项目隔离**
   - 项目 A 打开素材选择器，断言请求 URL 包含 `projectId=<A>`
   - 断言列表不包含项目 B 的素材
   - 从项目 A 切到项目 B，断言 attachments / history 已清空
   - 在项目 B 尝试提交项目 A 的 `assetId`，断言返回 422 `ASSET_PROJECT_MISMATCH`

### 4.3 验收矩阵

| 模块 | 验收项 |
| --- | --- |
| Header | 浅色/深色下 API 胶囊、tokens、LOCAL、图标按钮、面包屑清晰可读 |
| 创作台 | 深色主题主按钮可见；浅色主题模式栏、composer、inspector 文字可读 |
| 媒体区 | `.stage` 在浅色主题仍为深底 |
| 素材隔离 | picker 只显示当前项目素材；切换项目不保留旧素材；服务端拒绝跨项目素材 |
| 兼容 | 未归档素材可用；旧数据不迁移；生成请求字段不变 |

---

## 5. 风险与待确认

| 事项 | 推荐 | 备选 |
| --- | --- | --- |
| 浅色主题顶栏/侧栏 | 跟随主题变成暖纸浅色 | 保留深色顶栏，只调亮按钮文字 |
| 跨项目素材 | 严格拦截，提示先移动素材 | 自动移动到当前项目后附加 |
| 未归档素材 | 允许在任意项目使用 | 仅允许在“未归档”视图中使用 |
| 其他项目作品 intent | 只恢复提示词/参数，不恢复素材 | 直接拒绝整个 work intent |

推荐按“浅色 chrome 跟随主题 + 跨项目素材严格拦截 + 未归档素材兼容”的方案实施。
