import type { StudioToast } from "../hooks/types";

/** 工作室外壳的属性。切到其他路由时页面仍保持挂载。 */
export interface StudioPageProps {
  /** 为 true 时不写 `data-mode`，也不注册键盘快捷键。 */
  hidden: boolean;
  /**
   * 从工作室顶栏打开智能体工作区。
   * @returns 无返回值。
   */
  onOpenAgent: () => void;
  /** 历史条上尚未做跳转的操作用来弹提示。 */
  toast: StudioToast;
}

/** 右侧参数抽屉的属性。 */
export interface InspectorProps {
  /** 抽屉是否展开。面板保持挂载，避免草稿丢失。 */
  open: boolean;
  /**
   * 关闭抽屉。
   * @returns 无返回值。
   */
  onClose: () => void;
  /**
   * 从检查器打开智能体工作区。
   * @returns 无返回值。
   */
  onOpenAgent: () => void;
  /** 检查器里尚未接上真实行为的控件用来弹提示。 */
  toast: StudioToast;
}

/** 舞台下方提示词栏的属性。 */
export interface PromptComposerProps {
  /**
   * 打开检查器抽屉。
   * @returns 无返回值。
   */
  onOpenInspector: () => void;
}

/** 舞台画板上悬浮工具的属性。 */
export interface StageToolsProps {
  /** 下载链接的媒体地址。没有时下载按钮不会下载。 */
  downloadUrl?: string;
  /** 建议的下载文件名。缺省时用浏览器默认名。 */
  filename?: string;
}

/** 提示词栏下方会话历史的属性。 */
export interface HistoryStripProps {
  /** 「全部作品」和「新建」只用它提示，不会跳转。 */
  toast: StudioToast;
}
