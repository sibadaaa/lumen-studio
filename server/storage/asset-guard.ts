import { assetStore } from "./assets.js";

export type AssetOwnershipCode = "ASSET_NOT_FOUND" | "ASSET_PROJECT_MISMATCH";

export interface AssetOwnershipIssue {
  code: AssetOwnershipCode;
  assetId: string;
  message: string;
}

/**
 * Guard generation inputs against cross-project asset reuse.
 *
 * Assets without a `projectId` (legacy or never archived) stay usable from any
 * project so old data keeps working. The check is skipped when the request has
 * no project, mirroring the fact that `POST /generations` accepts project-less
 * drafts.
 */
export function findAssetOwnershipIssue(
  projectId: string | undefined,
  assetIds: Array<string | undefined | null>
): AssetOwnershipIssue | null {
  if (!projectId) return null;
  for (const assetId of assetIds) {
    if (!assetId) continue;
    const asset = assetStore.getDetail(assetId);
    if (!asset) {
      return { code: "ASSET_NOT_FOUND", assetId, message: "素材不存在" };
    }
    if (asset.projectId && asset.projectId !== projectId) {
      return { code: "ASSET_PROJECT_MISMATCH", assetId, message: "素材属于其他项目，请先移动到当前项目" };
    }
  }
  return null;
}
