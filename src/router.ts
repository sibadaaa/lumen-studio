import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import WorkspaceHome from "./pages/WorkspaceHome.vue";
import ProjectPage from "./pages/ProjectPage.vue";
import StudioPage from "./studio/StudioPage.vue";
import AgentPage from "./agent/AgentPage.vue";
import WorksLibrary from "./pages/WorksLibrary.vue";
import AssetsLibrary from "./pages/AssetsLibrary.vue";
import ModelsPage from "./pages/ModelsPage.vue";
import { useAppStore } from "./stores/app";

export type PageName =
  | "workspace"
  | "project"
  | "studio"
  | "agent"
  | "works"
  | "assets"
  | "models";

declare module "vue-router" {
  interface RouteMeta {
    page: PageName;
  }
}

const routes: RouteRecordRaw[] = [
  { path: "/", name: "workspace", component: WorkspaceHome, meta: { page: "workspace" } },
  { path: "/projects/:id", name: "project", component: ProjectPage, meta: { page: "project" } },
  {
    path: "/projects/:id/studio",
    name: "studio",
    component: StudioPage,
    meta: { page: "studio" },
  },
  {
    path: "/projects/:id/agent",
    name: "agent",
    component: AgentPage,
    meta: { page: "agent" },
  },
  { path: "/works", name: "works", component: WorksLibrary, meta: { page: "works" } },
  { path: "/assets", name: "assets", component: AssetsLibrary, meta: { page: "assets" } },
  { path: "/models", name: "models", component: ModelsPage, meta: { page: "models" } },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/** Keep the active project in sync with project-scoped routes. */
router.beforeEach((to) => {
  const app = useAppStore();
  const id = typeof to.params.id === "string" ? to.params.id : "";
  if (id && id !== app.projectId) app.projectId = id;
  app.routeName = (to.meta.page as PageName | undefined) || "workspace";
  return true;
});
