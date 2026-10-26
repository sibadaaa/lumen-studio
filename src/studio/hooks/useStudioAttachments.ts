import { useRef, useState, type MutableRefObject } from "react";
import type { AssetRole, LibraryAsset } from "../../../shared/contracts";
import { api } from "../../lib/api";
import { i18n } from "../../i18n";
import { nextAttachmentId, type Attachment, type StudioToast } from "./types";

/** 提示词栏附件列表的入参。 */
interface Options {
  /** 上传和从素材库填入的结果用来弹提示。 */
  toast: StudioToast;
  /** 项目代次。上传拿它对比，切项目后丢掉迟到的结果。 */
  projectEpochRef: MutableRefObject<number>;
  /** 当前项目 id。上传开始时读取，文件记到那个项目上。 */
  projectIdRef: MutableRefObject<string | undefined>;
}

/**
 * 提示词栏静帧：本地上传和素材库挑选。
 * @param options - 提示函数，以及项目代次和项目 id 的 ref。
 * @returns 列表、任务 hook 在 await 之后读取的 ref，以及修改函数。
 */
export function useStudioAttachments({ toast, projectEpochRef, projectIdRef }: Options) {
  /** 提示词栏渲染的附件芯片。 */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** 生成时读取的最新列表，避免闭包住过期渲染。 */
  const attachmentsRef = useRef<Attachment[]>([]);
  attachmentsRef.current = attachments;
  /** 进行中的上传，键是附件 id。生成组请求前会等待这些 Promise。 */
  const uploadsRef = useRef<Map<string, Promise<string | null>>>(new Map());

  /**
   * 合并一个附件的字段，并立刻刷新 `attachmentsRef`。
   * @param id - 附件 id。
   * @param patch - 要合并的字段，通常是进度或完成的素材。
   * @returns 无返回值。
   */
  const patchAttachment = (id: string, patch: Partial<Attachment>) => {
    setAttachments((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      attachmentsRef.current = next;
      return next;
    });
  };

  /**
   * 添加本地文件并上传。
   * @param file - 选择器里的图片文件。
   * @returns 无返回值。先插入 blob 行，上传完成后才有素材 id。
   */
  const addAttachment = (file: File) => {
    const id = nextAttachmentId();
    const url = URL.createObjectURL(file);
    const epoch = projectEpochRef.current;
    setAttachments((prev) => {
      const next = [...prev, { id, url, name: file.name, uploading: true, progress: 0 }];
      attachmentsRef.current = next;
      return next;
    });
    const upload = api
      .upload(file, (progress) => patchAttachment(id, { progress }), projectIdRef.current)
      .then((asset) => {
        if (epoch !== projectEpochRef.current) return null;
        patchAttachment(id, { assetId: asset.id, uploading: false, progress: 100, url: asset.thumbnailUrl || asset.url });
        toast(i18n.t("composer.uploadOk", { ns: "studio" }), "success");
        return asset.url;
      })
      .catch((error: Error) => {
        if (epoch !== projectEpochRef.current) return null;
        patchAttachment(id, { uploading: false, progress: 0 });
        toast(i18n.t("composer.uploadFail", { ns: "studio", message: error.message }), "default");
        return null;
      });
    uploadsRef.current.set(id, upload);
  };

  /**
   * 移除一个附件并释放它的 blob 地址。
   * @param id - 附件 id。
   * @returns 无返回值。同时丢掉进行中的上传，生成不必再等它。
   */
  const removeAttachment = (id: string) => {
    uploadsRef.current.delete(id);
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target && target.url.startsWith("blob:")) URL.revokeObjectURL(target.url);
      const next = prev.filter((item) => item.id !== id);
      attachmentsRef.current = next;
      return next;
    });
  };

  /**
   * 追加一张已经入库的素材。
   * @param asset - 素材库静帧。
   * @param role - 决定提示文案：首帧、尾帧或参考图。
   * @returns 无返回值。
   */
  const addFromLibrary = (asset: LibraryAsset, role: AssetRole) => {
    const url = asset.thumbnailUrl || asset.url;
    setAttachments((prev) => {
      const next = [
        ...prev,
        { id: nextAttachmentId(), url, assetId: asset.id, name: asset.originalName || asset.id, uploading: false, progress: 100 },
      ];
      attachmentsRef.current = next;
      return next;
    });
    const key = role === "first_frame" ? "refilledFirst" : role === "last_frame" ? "refilledLast" : "refilledRef";
    toast(i18n.t(`toasts.${key}`, { ns: "studio" }), "success");
  };

  /**
   * 替换整个列表。作品意图恢复输入时使用。
   * @param next - 新的附件列表。这里不释放旧列表里的 blob 地址。
   * @returns 无返回值。
   */
  const replaceAll = (next: Attachment[]) => {
    setAttachments(next);
    attachmentsRef.current = next;
  };

  /**
   * 打开的项目变化时丢掉全部附件。
   * @returns 无返回值。释放 blob 地址并清空 `uploadsRef`。
   */
  const resetForProject = () => {
    uploadsRef.current.clear();
    setAttachments((prev) => {
      for (const item of prev) {
        if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      }
      return [];
    });
    attachmentsRef.current = [];
  };

  return {
    attachments,
    attachmentsRef,
    uploadsRef,
    addAttachment,
    removeAttachment,
    addFromLibrary,
    replaceAll,
    resetForProject,
  };
}
