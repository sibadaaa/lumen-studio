import type { zhCN } from "./locales/zh-CN";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "base";
    resources: typeof zhCN;
  }
}
