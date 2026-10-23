import common from "./base/common.json";
import nav from "./base/nav.json";
import settings from "./base/settings.json";
import errors from "./base/errors.json";
import meta from "./base/meta.json";
import workspace from "./workspace/page.json";
import project from "./project/page.json";
import agent from "./agent/page.json";
import api from "./api/page.json";
import models from "./models/page.json";
import works from "./works/page.json";
import assets from "./assets/page.json";
import studio from "./studio.json";

/**
 * Namespace map: `base` is the shared/common namespace; one namespace per
 * page. `studio` groups its sections (composer/inspector/...) in one
 * namespace so screens bind a single namespace.
 */
export const zhCN = {
  // Flatten base files into one namespace: t("save"), t("workspace"), t("errors.X")
  base: { ...common, ...nav, ...settings, meta, errors },
  workspace,
  project,
  studio,
  agent,
  api,
  models,
  works,
  assets,
};
