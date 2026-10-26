import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Images,
  SquarePlay,
} from "lucide-react";
import { MODES } from "../data/mock";
import { SHORTCUTS_ENABLED } from "../lib/features";
import type { Mode } from "../types";
import { HistoryStrip } from "./HistoryStrip";
import { Inspector } from "./Inspector";
import { PromptComposer } from "./PromptComposer";
import { Stage } from "./Stage";
import { useStudio } from "./StudioContext";
import type { StudioPageProps } from "./types/components";

/** 每个模式页签用的图标组件。 */
const MODE_ICONS: Record<Mode, typeof ImageIcon> = {
  t2i: ImageIcon,
  t2v: Film,
  i2i: Images,
  i2v: SquarePlay,
  multi: Clapperboard,
};

/**
 * 工作室外壳：模式页签、舞台、提示词栏、历史和检查器抽屉。
 * @param props - `hidden` 时卸下快捷键；`toast` 传给历史条。
 * @returns 工作室布局。其他路由显示时仍然挂载。
 */
export function StudioPage({ hidden, onOpenAgent, toast }: StudioPageProps) {
  const studio = useStudio();
  const { t } = useTranslation("studio");
  /** 检查器抽屉是否展开。遮罩和检查器自己都能关掉它。 */
  const [inspectorOpen, setInspectorOpen] = useState(false);

  /** 把当前模式写到 `document.body` 上，给主题 CSS 用。页面隐藏时跳过。 */
  useEffect(() => {
    if (hidden) return;
    document.body.dataset.mode = studio.mode;
  }, [hidden, studio.mode]);

  /** Cmd/Ctrl+Enter 生成。1–5 切换模式，但焦点在输入框里时不切换。`hidden` 时不注册。 */
  useEffect(() => {
    if (hidden || !SHORTCUTS_ENABLED) return;
    /**
     * 处理工作室快捷键。
     * @param event - window 上的 keydown 事件。
     * @returns 无返回值。
     */
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA"].includes(target.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        studio.generate();
      }
      if (!typing && /^[1-5]$/.test(event.key)) {
        const next = (["t2i", "t2v", "i2i", "i2v", "multi"] as Mode[])[Number(event.key) - 1];
        studio.switchMode(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, studio]);

  return (
    <main className="studio" hidden={hidden}>
      <section className="center">
        <div className="modebar">
          <div className="modebar-main">
            <div className="mode-tabs" role="tablist" aria-label={t("modesAria")}>
              {(Object.keys(MODES) as Mode[]).map((mode) => {
                const Icon = MODE_ICONS[mode];
                return (
                  <button
                    key={mode}
                    className={`mode-tab ${studio.mode === mode ? "is-active" : ""}`}
                    role="tab"
                    aria-selected={studio.mode === mode}
                    onClick={() => studio.switchMode(mode)}
                  >
                    <Icon size={16} strokeWidth={1.4} />
                    <span>{t(`modes.${mode}`)}</span>
                  </button>
                );
              })}
            </div>
            <div className="view-switch" hidden={!studio.isVideo || (studio.mode !== "t2v" && studio.mode !== "multi")} role="group" aria-label={t("viewAria")}>
              <button className={studio.view === "preview" ? "is-active" : ""} onClick={() => studio.switchView("preview")}>{t("view.preview")}</button>
              <button className={studio.view === "storyboard" ? "is-active" : ""} onClick={() => studio.switchView("storyboard")}>{t("view.storyboard")}</button>
            </div>
            <button className="agent-entry" onClick={onOpenAgent}>
              <Bot size={13} strokeWidth={1.4} />
              {t("agentEntry")}
              {SHORTCUTS_ENABLED && <kbd>⌘J</kbd>}
            </button>
          </div>
          <div className="modebar-end">
            <span className="draft-state"><i />{t("draftSaved")}</span>
            {SHORTCUTS_ENABLED && (
              <button className="shortcut-hint" onClick={() => toast(t("shortcutHint"))}>
                <kbd>1</kbd><span>–</span><kbd>5</kbd><span>{t("switch")}</span>
              </button>
            )}
          </div>
        </div>

        <Stage />
        <PromptComposer onOpenInspector={() => setInspectorOpen(true)} />
        <HistoryStrip toast={toast} />
      </section>

      <Inspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} onOpenAgent={onOpenAgent} toast={toast} />
      {inspectorOpen && <div className="inspector-backdrop" onClick={() => setInspectorOpen(false)} />}
    </main>
  );
}
