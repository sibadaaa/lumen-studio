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

/** English resources; keys mirror zh-CN. Missing entries fall back at runtime. */
export const en = {
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
