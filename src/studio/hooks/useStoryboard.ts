import { useRef, useState, type MutableRefObject } from "react";
import type { LibraryAsset } from "../../../shared/contracts";
import { api } from "../../lib/api";
import { DEFAULT_BOARDS } from "../../data/mock";
import { i18n } from "../../i18n";
import type { BoardRow, BoardState, Mode } from "../../types";
import type { StudioToast } from "./types";

/** 分镜 hook 的入参。文生视频和图组各自保留一块分镜。 */
interface Options {
  /** 当前模式。只有文生视频或图组时行编辑才生效。 */
  mode: Mode;
  /** 最新模式。上传可能活过它开始时的那次渲染。 */
  modeRef: MutableRefObject<Mode>;
  /** 行数限制、导出和上传结果用来弹提示。 */
  toast: StudioToast;
  /** 项目代次。对不上就丢掉迟到的上传结果。 */
  projectEpochRef: MutableRefObject<number>;
  /** 分镜格开始上传时读取的项目 id。 */
  projectIdRef: MutableRefObject<string | undefined>;
  /** 共用的进行中上传表。分镜格上传登记进去，生成才能等待它们。 */
  uploadsRef: MutableRefObject<Map<string, Promise<string | null>>>;
}

/**
 * 文生视频和图组的分镜行。
 * @param options - 当前模式、提示函数，以及项目和上传的 ref。
 * @returns 当前可见的分镜和行修改函数。图像模式看到空分镜。
 */
export function useStoryboard({ mode, modeRef, toast, projectEpochRef, projectIdRef, uploadsRef }: Options) {
  /** 两块视频分镜。图像模式不读这张表。 */
  const [boards, setBoards] = useState(DEFAULT_BOARDS);
  /** `buildRequest` 和上传完成时读取的最新分镜。 */
  const boardsRef = useRef(boards);
  boardsRef.current = boards;

  /** 当前模式显示的分镜。文生视频和图组以外标题和行都为空。 */
  const board: BoardState = mode === "t2v" || mode === "multi" ? boards[mode] : { title: "分镜脚本", rows: [] };

  /**
   * 替换当前视频分镜的行。
   * @param updater - 把当前行映射成下一组行。
   * @returns 无返回值。图像模式不生效。
   */
  const updateBoard = (updater: (rows: BoardRow[]) => BoardRow[]) => {
    if (mode !== "t2v" && mode !== "multi") return;
    setBoards((prev) => ({ ...prev, [mode]: { ...prev[mode], rows: updater(prev[mode].rows) } }));
  };

  /**
   * 把补丁合并进一行。
   * @param index - 行下标。
   * @param patch - 要合并的字段。
   * @returns 无返回值。
   */
  const updateBoardRow = (index: number, patch: Partial<BoardRow>) =>
    updateBoard((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /**
   * 追加一行。时长沿用上一行，并夹紧到 2–8 秒。
   * `rows.length` 已经是 9 时拒绝。
   * @returns 无返回值。达到上限时提示。
   */
  const addBoardRow = () => {
    updateBoard((rows) => {
      if (rows.length >= 9) {
        toast("最多支持 9 个镜头");
        return rows;
      }
      const last = rows[rows.length - 1];
      return [
        ...rows,
        {
          id: `row-${Date.now()}`,
          img: null,
          shot: "中景",
          motion: "缓慢推进",
          desc: "",
          audio: "",
          dur: Math.min(8, Math.max(2, Number(last?.dur) || 3)),
        },
      ];
    });
  };

  /**
   * 删除一行。
   * `rows.length` 至少保留 1；`mode` 为图组时至少保留 2。
   * @param index - 行下标。
   * @returns 无返回值。碰到下限时提示。
   */
  const deleteBoardRow = (index: number) => {
    const minRows = mode === "multi" ? 2 : 1;
    updateBoard((rows) => {
      if (rows.length <= minRows) {
        toast(mode === "multi" ? "图组视频至少保留 2 个镜头" : "至少保留 1 个镜头");
        return rows;
      }
      return rows.filter((_, i) => i !== index);
    });
  };

  /**
   * 在 `index` 后面插入副本。
   * `rows.length` 已经是 9 时拒绝。
   * @param index - 要复制的行。
   * @returns 无返回值。
   */
  const duplicateBoardRow = (index: number) => {
    updateBoard((rows) => {
      if (rows.length >= 9) {
        toast("最多支持 9 个镜头");
        return rows;
      }
      const next = [...rows];
      next.splice(index + 1, 0, { ...rows[index], id: `row-${Date.now()}` });
      return next;
    });
  };

  /**
   * 恢复当前视频模式的默认分镜。
   * @returns 无返回值。提示恢复后的镜头数。图像模式不生效。
   */
  const resetBoard = () => {
    if (mode !== "t2v" && mode !== "multi") return;
    setBoards((prev) => ({ ...prev, [mode]: JSON.parse(JSON.stringify(DEFAULT_BOARDS[mode])) }));
    toast(`已根据提示词拆分为 ${DEFAULT_BOARDS[mode].rows.length} 个镜头`, "success");
  };

  /**
   * 把当前分镜下载成 UTF-8 CSV。
   * @returns 无返回值。列是镜号、景别、运镜、画面描述、台词和时长。图像模式不生效。
   */
  const exportBoard = () => {
    if (mode !== "t2v" && mode !== "multi") return;
    const header = ["镜号", "景别", "运镜", "画面描述", "台词/音效", "时长(s)"];
    const lines = board.rows.map((row, index) =>
      [String(index + 1).padStart(2, "0"), row.shot, row.motion, row.desc, row.audio, row.dur]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );
    const blob = new Blob([`\ufeff${header.join(",")}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lumen-storyboard-${mode}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("分镜表已导出 CSV", "success");
  };

  /**
   * 把分镜格指向一张已经上传的静帧。
   * @param index - 行下标。
   * @param url - 展示地址。
   * @param assetId - 静帧已入库时的素材 id。
   * @returns 无返回值。
   */
  const replaceBoardImage = (index: number, url: string, assetId?: string) => {
    updateBoardRow(index, { img: url, assetId, uploading: false });
  };

  /**
   * 把本地文件上传进一个分镜格。
   * @param index - 行下标。
   * @param file - 图片文件。
   * @returns 无返回值。先显示 blob 预览；项目没变时再换成素材地址。
   */
  const replaceBoardImageFile = (index: number, file: File) => {
    const currentMode = modeRef.current;
    if (currentMode !== "t2v" && currentMode !== "multi") return;
    const boardMode = currentMode as "t2v" | "multi";
    const localUrl = URL.createObjectURL(file);
    const epoch = projectEpochRef.current;
    setBoards((prev) => {
      const next = {
        ...prev,
        [boardMode]: {
          ...prev[boardMode],
          rows: prev[boardMode].rows.map((row, i) => (i === index ? { ...row, img: localUrl, assetId: undefined, uploading: true } : row)),
        },
      };
      boardsRef.current = next;
      return next;
    });
    const uploadId = `board-${currentMode}-${index}-${Date.now()}`;
    const task = api
      .upload(file, undefined, projectIdRef.current)
      .then((asset) => {
        if (epoch !== projectEpochRef.current) return null;
        setBoards((prev) => {
          const next = {
            ...prev,
            [boardMode]: {
              ...prev[boardMode],
              rows: prev[boardMode].rows.map((row, i) =>
                i === index ? { ...row, img: asset.url, assetId: asset.id, uploading: false } : row
              ),
            },
          };
          boardsRef.current = next;
          return next;
        });
        toast("分镜画面已上传", "success");
        return asset.url;
      })
      .catch((error: Error) => {
        if (epoch !== projectEpochRef.current) return null;
        setBoards((prev) => {
          const next = {
            ...prev,
            [boardMode]: {
              ...prev[boardMode],
              rows: prev[boardMode].rows.map((row, i) => (i === index ? { ...row, uploading: false } : row)),
            },
          };
          boardsRef.current = next;
          return next;
        });
        toast(`${error.message}，分镜保留本地预览`);
        return null;
      });
    uploadsRef.current.set(uploadId, task);
  };

  /**
   * 把素材库静帧放进图组第一个空镜头。
   * @param asset - 素材库静帧。优先用缩略图而不是完整地址。
   * @returns 无返回值。每个图组行都已有图时不生效。成功时提示。
   */
  const fillEmptyShot = (asset: LibraryAsset) => {
    const url = asset.thumbnailUrl || asset.url;
    setBoards((prev) => {
      const rows = prev.multi.rows;
      const index = rows.findIndex((row) => !row.assetId && !row.img);
      if (index < 0) return prev;
      const next = {
        ...prev,
        multi: {
          ...prev.multi,
          rows: rows.map((row, i) => (i === index ? { ...row, img: url, assetId: asset.id, uploading: false } : row)),
        },
      };
      boardsRef.current = next;
      return next;
    });
    toast(i18n.t("toasts.refilledShot", { ns: "studio" }), "success");
  };

  /**
   * 项目变化时清掉每块分镜上的静帧。镜头文案保留。
   * @returns 无返回值。
   */
  const clearImages = () => {
    setBoards((prev) => {
      const next = { ...prev };
      (Object.keys(next) as Array<keyof typeof next>).forEach((boardMode) => {
        next[boardMode] = {
          ...next[boardMode],
          rows: next[boardMode].rows.map((row) => ({ ...row, img: null, assetId: undefined, uploading: false })),
        };
      });
      boardsRef.current = next;
      return next;
    });
  };

  return {
    board,
    boardsRef,
    updateBoardRow,
    addBoardRow,
    deleteBoardRow,
    duplicateBoardRow,
    replaceBoardImage,
    replaceBoardImageFile,
    resetBoard,
    exportBoard,
    fillEmptyShot,
    clearImages,
  };
}
