import { useEffect, useState } from "react";
import {
  Bot,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Images,
  SquarePlay,
} from "lucide-react";
import { MODES } from "../data/mock";
import type { Mode } from "../types";
import { HistoryStrip } from "./HistoryStrip";
import { Inspector } from "./Inspector";
import { PromptComposer } from "./PromptComposer";
import { Stage } from "./Stage";
import { useStudio } from "./StudioContext";

const MODE_ICONS: Record<Mode, typeof ImageIcon> = {
  t2i: ImageIcon,
  t2v: Film,
  i2i: Images,
  i2v: SquarePlay,
  multi: Clapperboard,
};

interface Props {
  hidden: boolean;
  onOpenAgent: () => void;
  toast: (message: string, type?: "default" | "success") => void;
}

export function StudioPage({ hidden, onOpenAgent, toast }: Props) {
  const studio = useStudio();
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    if (hidden) return;
    document.body.dataset.mode = studio.mode;
  }, [hidden, studio.mode]);

  useEffect(() => {
    if (hidden) return;
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
            <div className="mode-tabs" role="tablist" aria-label="生成模式">
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
                    <span>{["文生图", "文生视频", "图生图", "图生视频", "图组视频"][["t2i", "t2v", "i2i", "i2v", "multi"].indexOf(mode)]}</span>
                  </button>
                );
              })}
            </div>
            <div className="view-switch" hidden={!studio.isVideo || (studio.mode !== "t2v" && studio.mode !== "multi")} role="group" aria-label="画布视图">
              <button className={studio.view === "preview" ? "is-active" : ""} onClick={() => studio.switchView("preview")}>成片</button>
              <button className={studio.view === "storyboard" ? "is-active" : ""} onClick={() => studio.switchView("storyboard")}>分镜表</button>
            </div>
            <button className="agent-entry" onClick={onOpenAgent}>
              <Bot size={13} strokeWidth={1.4} />
              Agent 工作区
              <kbd>⌘J</kbd>
            </button>
          </div>
          <div className="modebar-end">
            <span className="draft-state"><i />参数已保存</span>
            <button className="shortcut-hint" onClick={() => toast("按 1–5 切换模式，⌘/Ctrl + Enter 生成")}>
              <kbd>1</kbd><span>–</span><kbd>5</kbd><span>切换</span>
            </button>
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
