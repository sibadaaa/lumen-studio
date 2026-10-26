<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, Download, Pencil, Plus, RefreshCw, Trash2 } from "lucide-vue-next";
import type { ProjectWithStats, UsageSummary } from "../../shared/contracts";
import { api } from "../lib/api";
import ActionMenu from "../components/ActionMenu.vue";
import RenameDialog from "../components/RenameDialog.vue";
import { relativeTime } from "../i18n/format";
import { IMG } from "../data/mock";
import { useT } from "../i18n";
import { useAppStore } from "../stores/app";
import type { ActionMenuItem } from "../components/action-menu";

defineOptions({ name: "WorkspaceHome" });

const app = useAppStore();
const router = useRouter();
const t = useT("workspace");
const tBase = useT("base");

const DEMO_PROJECTS: ProjectWithStats[] = [
  {
    id: "proj_product",
    name: "产品短片",
    description: "15 秒竖屏产品广告 · 4 个镜头",
    coverUrl: IMG.dunes,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: { sessions: 0, assets: 0, generations: 0, tokens: 0, lastActivityAt: null },
  },
  {
    id: "proj_glass",
    name: "雾中玻璃仪式",
    description: "分镜实验 · 3 个镜头",
    coverUrl: IMG.glass,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: { sessions: 0, assets: 0, generations: 0, tokens: 0, lastActivityAt: null },
  },
];

const projects = ref<ProjectWithStats[]>([]);
const usage = ref<UsageSummary | null>(null);
const online = ref(true);
const loading = ref(true);
const creating = ref(false);
const name = ref("");
const creatingBusy = ref(false);
const renameTarget = ref<ProjectWithStats | null>(null);
const renaming = ref(false);

const compact = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(2)}m`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(Math.round(value));

const relative = (iso: string | null) =>
  !iso ? "—" : relativeTime(iso);

async function load() {
  loading.value = true;
  try {
    const [list, summary] = await Promise.all([api.projects(), api.usage()]);
    projects.value = list.items;
    usage.value = summary;
    online.value = true;
  } catch {
    online.value = false;
    projects.value = DEMO_PROJECTS;
    usage.value = null;
  } finally {
    loading.value = false;
  }
}

function openProject(project: { id: string; name: string }) {
  app.setProject(project.id, project.name);
  void router.push(`/projects/${project.id}`);
}

async function createProject() {
  if (creatingBusy.value) return;
  creatingBusy.value = true;
  try {
    const project = await api.createProject({
      name: name.value.trim() || t("defaultProjectName", { count: projects.value.length + 1 }),
      description: t("defaultProjectDesc"),
      coverUrl: IMG.dunes,
    });
    projects.value = [project, ...projects.value];
    creating.value = false;
    name.value = "";
    app.toast(t("created"), "success");
    openProject({ id: project.id, name: project.name });
  } catch (error) {
    app.toast((error as Error).message);
  } finally {
    creatingBusy.value = false;
  }
}

async function renameProject(value: string) {
  if (!renameTarget.value || renaming.value) return;
  renaming.value = true;
  try {
    const updated = await api.updateProject(renameTarget.value.id, { name: value });
    projects.value = projects.value.map((project) => (project.id === updated.id ? updated : project));
    if (app.projectId === updated.id) app.projectName = updated.name;
    renameTarget.value = null;
    app.toast(t("renamed"), "success");
  } catch (error) {
    app.toast((error as Error).message);
  } finally {
    renaming.value = false;
  }
}

async function deleteProject(project: ProjectWithStats) {
  if (!window.confirm(t("deleteConfirm", { name: project.name }))) return;
  try {
    await api.deleteProject(project.id);
    projects.value = projects.value.filter((item) => item.id !== project.id);
    app.toast(t("deleted"), "success");
  } catch (error) {
    app.toast((error as Error).message);
  }
}

function projectMenu(project: ProjectWithStats): ActionMenuItem[] {
  return [
    { key: "rename", label: tBase("rename"), icon: Pencil, onSelect: () => (renameTarget.value = project) },
    {
      key: "delete",
      label: tBase("delete"),
      icon: Trash2,
      danger: true,
      onSelect: () => void deleteProject(project),
    },
  ];
}

const totalTokens = computed(
  () => usage.value?.totalTokens ?? projects.value.reduce((sum, project) => sum + project.stats.tokens, 0),
);
const sessions = computed(() => projects.value.reduce((sum, project) => sum + project.stats.sessions, 0));
const assetTotal = computed(() => projects.value.reduce((sum, project) => sum + project.stats.assets, 0));

onMounted(() => void load());
</script>

<template>
  <main class="workspace-home">
    <section class="wh-main">
      <header class="wh-head">
        <div>
          <span class="eyebrow">WORKSPACE</span>
          <h1>{{ t("title") }}</h1>
          <p>
            {{
              online
                ? t("descOnline", { projects: projects.length, tokens: compact(totalTokens) })
                : t("descOffline", { projects: projects.length })
            }}
          </p>
        </div>
        <div class="wh-actions">
          <button class="soft-btn" :title="t('refresh')" @click="void load()">
            <RefreshCw :size="14" /> {{ t("refresh") }}
          </button>
          <button class="soft-btn" @click="app.toast(t('import'))">
            <Download :size="14" /> {{ t("import") }}
          </button>
          <button class="ws-primary" @click="creating = !creating">
            <Plus :size="14" /> {{ t("newProject") }}
          </button>
        </div>
      </header>

      <div v-if="creating" class="wh-create-row">
        <input
          v-model="name"
          autofocus
          :placeholder="t('createPlaceholder')"
          maxlength="80"
          @keydown.enter.prevent="void createProject()"
          @keydown.esc="creating = false"
        />
        <button class="ws-primary" :disabled="creatingBusy" @click="void createProject()">
          {{ creatingBusy ? t("creating") : t("createAndOpen") }}
        </button>
        <button class="text-btn" @click="creating = false">{{ tBase("cancel") }}</button>
      </div>

      <div class="project-grid">
        <div
          v-for="project in projects"
          :key="project.id"
          :class="['project-card', { 'is-active': project.status === 'active' }]"
          role="button"
          tabindex="0"
          :aria-label="t('openProject', { name: project.name })"
          @click="openProject({ id: project.id, name: project.name })"
          @keydown.enter.prevent="openProject({ id: project.id, name: project.name })"
          @keydown.space.prevent="openProject({ id: project.id, name: project.name })"
        >
          <div class="project-card-cover">
            <img :src="project.coverUrl || IMG.dunes" :alt="t('coverAlt', { name: project.name })" />
            <span class="project-card-badge">
              {{
                project.status === "archived"
                  ? t("badgeArchived")
                  : project.stats.sessions
                    ? t("badgeActive")
                    : t("badgeRecent")
              }}
            </span>
            <ActionMenu
              class="project-card-actions"
              :label="t('projectActions', { name: project.name })"
              :items="projectMenu(project)"
            />
            <span class="project-card-tokens">{{ compact(project.stats.tokens) }} tokens</span>
          </div>
          <div class="project-card-body">
            <div>
              <h2>{{ project.name }}</h2>
              <p>{{ project.description || t("localProject") }}</p>
            </div>
            <span class="project-card-arrow">↗</span>
          </div>
          <div class="project-card-meta">
            <span>{{ project.stats.sessions }} {{ t("sessions") }}</span>
            <span>{{ project.stats.assets }} {{ t("assets") }}</span>
            <time>{{ relative(project.stats.lastActivityAt || project.updatedAt) }}</time>
          </div>
        </div>

        <button v-if="!loading && projects.length === 0" class="project-card project-new" @click="creating = true">
          <span class="project-new-icon">+</span>
          <strong>{{ t("newProject") }}</strong>
          <small>{{ t("startBody") }}</small>
        </button>
      </div>

      <section class="wh-activity">
        <div class="wh-section-head">
          <span>{{ t("activityTitle") }}</span>
          <button @click="void load()">{{ t("activityAll") }} <ArrowRight :size="12" /></button>
        </div>
        <div class="wh-activity-list">
          <div v-for="project in projects.slice(0, 4)" :key="project.id">
            <span :class="['wh-activity-dot', project.stats.assets ? 'image' : 'storyboard']" />
            <div>
              <strong>{{ project.name }}</strong>
              <p>
                {{
                  t("activityLine", {
                    generations: project.stats.generations,
                    sessions: project.stats.sessions,
                    assets: project.stats.assets,
                  })
                }}
              </p>
            </div>
            <em>{{ compact(project.stats.tokens) }} tokens</em>
            <time>{{ relative(project.stats.lastActivityAt || project.updatedAt) }}</time>
          </div>
          <p v-if="projects.length === 0" class="wh-empty-line">{{ t("activityEmpty") }}</p>
        </div>
      </section>
    </section>

    <aside class="wh-side">
      <div class="wh-side-card wh-usage-card">
        <span class="eyebrow">USAGE</span>
        <div class="wh-usage-big">{{ compact(totalTokens) }} <small>{{ t("tokensLabel") }}</small></div>
        <p>
          {{ t("usageTitle") }} · {{ t("usageProjects", { count: projects.length }) }} ·
          {{ t("usageSessions", { count: sessions }) }}
        </p>
        <div class="wh-usage-bars">
          <div>
            <span>{{ t("usageDone") }}</span>
            <i
              :style="{
                '--w': `${usage?.generations ? Math.round(((usage.succeeded || 0) / usage.generations) * 100) : 0}%`,
              }"
            />
            <em>{{ usage?.succeeded ?? 0 }}</em>
          </div>
          <div>
            <span>{{ t("usageFailed") }}</span>
            <i
              :style="{
                '--w': `${usage?.generations ? Math.round(((usage.failed || 0) / usage.generations) * 100) : 0}%`,
              }"
            />
            <em>{{ usage?.failed ?? 0 }}</em>
          </div>
          <div>
            <span>{{ t("usageOutput") }}</span>
            <i style="--w: 58%" />
            <em>{{ compact(usage?.outputTokens ?? totalTokens) }}</em>
          </div>
        </div>
      </div>
      <div class="wh-side-card">
        <span class="eyebrow">STORAGE</span>
        <div class="wh-recent-files">
          <div>
            <span class="ws-file-icon csv" />
            <div><strong>lumen.db</strong><small>{{ t("storageDb") }}</small></div>
          </div>
          <div>
            <span class="ws-file-icon video" />
            <div><strong>outputs/</strong><small>{{ t("storageOutputs", { count: usage?.generations ?? 0 }) }}</small></div>
          </div>
          <div>
            <span class="ws-file-icon img" />
            <div><strong>assets/</strong><small>{{ t("storageAssets", { count: assetTotal }) }}</small></div>
          </div>
        </div>
      </div>
      <div class="wh-side-card wh-hint-card">
        <span class="eyebrow">START HERE</span>
        <p>{{ t("startBody") }}</p>
        <button
          class="text-btn"
          @click="projects[0] && openProject({ id: projects[0].id, name: projects[0].name })"
        >
          {{ t("startOpen", { name: projects[0]?.name || tBase("unfiled") }) }} <ArrowRight :size="12" />
        </button>
      </div>
    </aside>

    <RenameDialog
      :open="Boolean(renameTarget)"
      :title="t('renameProject')"
      :description="t('renameProjectDesc')"
      :initial-value="renameTarget?.name || ''"
      :label="t('projectNameLabel')"
      :placeholder="t('createPlaceholder')"
      :max-length="80"
      :busy="renaming"
      @close="!renaming && (renameTarget = null)"
      @submit="void renameProject($event)"
    />
  </main>
</template>
