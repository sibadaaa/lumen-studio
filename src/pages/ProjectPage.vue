<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowRight, Bot, ImagePlus, Pencil, RefreshCw, Trash2 } from "lucide-vue-next";
import type { AgentSession, MediaAsset, ProjectWithStats } from "../../shared/contracts";
import { api } from "../lib/api";
import ActionMenu from "../components/ActionMenu.vue";
import RenameDialog from "../components/RenameDialog.vue";
import { formatDate, relativeTime } from "../i18n/format";
import { IMG } from "../data/mock";
import { useT } from "../i18n";
import { useAppStore } from "../stores/app";
import type { ActionMenuItem } from "../components/action-menu";

defineOptions({ name: "ProjectPage" });

const app = useAppStore();
const route = useRoute();
const router = useRouter();
const t = useT("project");
const tBase = useT("base");

const project = ref<ProjectWithStats | null>(null);
const sessions = ref<AgentSession[]>([]);
const assets = ref<MediaAsset[]>([]);
const offline = ref(false);
const loading = ref(true);
const uploading = ref(false);
const renamingProject = ref(false);
const projectNameBusy = ref(false);
const renameSession = ref<AgentSession | null>(null);
const sessionNameBusy = ref(false);
const fileRef = ref<HTMLInputElement | null>(null);

const compact = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(2)}m`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(Math.round(value));

const projectId = () => (typeof route.params.id === "string" ? route.params.id : app.projectId);

async function load() {
  const id = projectId();
  loading.value = true;
  try {
    const detail = await api.project(id);
    project.value = { ...detail.project, stats: detail.stats };
    sessions.value = detail.sessions;
    assets.value = detail.assets;
    offline.value = false;
    app.projectId = detail.project.id;
    app.projectName = detail.project.name;
  } catch {
    offline.value = true;
    project.value = null;
  } finally {
    loading.value = false;
  }
}

async function upload(files: FileList | null) {
  if (!files?.length) return;
  uploading.value = true;
  try {
    for (const file of Array.from(files)) {
      const asset = await api.upload(file, undefined, projectId());
      assets.value = [asset, ...assets.value];
    }
    app.toast(t("uploadOk"), "success");
    await load();
  } catch (error) {
    app.toast((error as Error).message);
  } finally {
    uploading.value = false;
  }
}

async function saveProjectName(value: string) {
  if (!project.value || projectNameBusy.value) return;
  projectNameBusy.value = true;
  try {
    const updated = await api.updateProject(project.value.id, { name: value });
    project.value = updated;
    renamingProject.value = false;
    if (app.projectId === updated.id) app.projectName = updated.name;
    app.toast(t("renamed"), "success");
  } catch (error) {
    app.toast((error as Error).message);
  } finally {
    projectNameBusy.value = false;
  }
}

async function removeProject() {
  if (!project.value) return;
  if (!window.confirm(t("deleteConfirm", { name: project.value.name }))) return;
  try {
    await api.deleteProject(project.value.id);
    app.toast(t("deleted"), "success");
    void router.push("/");
  } catch (error) {
    app.toast((error as Error).message);
  }
}

async function saveSessionName(value: string) {
  if (!renameSession.value || sessionNameBusy.value) return;
  sessionNameBusy.value = true;
  try {
    const updated = await api.updateAgentSession(renameSession.value.id, { title: value });
    sessions.value = sessions.value.map((item) => (item.id === updated.id ? updated : item));
    renameSession.value = null;
    app.toast(t("sessionRenamed"), "success");
  } catch (error) {
    app.toast((error as Error).message);
  } finally {
    sessionNameBusy.value = false;
  }
}

async function removeSession(session: AgentSession) {
  if (session.status === "running") {
    app.toast(t("sessionRunningBlock"));
    return;
  }
  if (!window.confirm(t("sessionDeleteConfirm", { title: session.title }))) return;
  try {
    await api.deleteAgentSession(session.id);
    sessions.value = sessions.value.filter((item) => item.id !== session.id);
    app.toast(t("sessionDeleted"), "success");
    void load();
  } catch (error) {
    app.toast((error as Error).message);
  }
}

function enterStudio() {
  void router.push(`/projects/${projectId()}/studio`);
}

function openAgent(sessionId?: string) {
  if (sessionId) app.agentSessionId = sessionId;
  void router.push(`/projects/${projectId()}/agent`);
}

function openAssets() {
  app.setLibraryProject(projectId());
  void router.push("/assets");
}

function openAsset(url: string) {
  window.open(url, "_blank");
}

function sessionMenu(session: AgentSession): ActionMenuItem[] {
  return [
    { key: "rename", label: tBase("rename"), icon: Pencil, onSelect: () => (renameSession.value = session) },
    {
      key: "delete",
      label: tBase("delete"),
      icon: Trash2,
      danger: true,
      onSelect: () => void removeSession(session),
    },
  ];
}

const latest = () => sessions.value[0];

watch(() => route.params.id, () => void load());
onMounted(() => void load());
</script>

<template>
  <main class="project-page">
    <section class="pp-main">
      <header class="pp-hero">
        <div class="pp-cover">
          <img
            :src="project?.coverUrl || IMG.dunes"
            :alt="t('coverAlt', { name: project?.name || t('titleFallback') })"
          />
          <div class="pp-cover-shade" />
          <span class="pp-badge">PROJECT / SQLITE</span>
          <span class="pp-cover-meta">
            {{
              project?.stats
                ? t("heroMeta", { generations: project.stats.generations, assets: project.stats.assets })
                : t("localProject")
            }}
          </span>
        </div>
        <div class="pp-copy">
          <span class="eyebrow">WORKSPACE / {{ project?.id?.toUpperCase() || "LOCAL" }}</span>
          <h1>{{ project?.name || (offline ? tBase("offline") : loading ? t("loadFallback") : t("titleFallback")) }}</h1>
          <p>{{ project?.description || (offline ? t("pageDescOffline") : t("pageDescOnline")) }}</p>
          <div class="pp-stats">
            <span><strong>{{ project?.stats?.sessions ?? 0 }}</strong>{{ t("statSessions") }}</span>
            <span><strong>{{ project?.stats?.assets ?? 0 }}</strong>{{ t("statAssets") }}</span>
            <span><strong>{{ compact(project?.stats?.tokens ?? 0) }}</strong>{{ t("statTokens") }}</span>
            <span><strong>{{ project?.stats?.generations ?? 0 }}</strong>{{ t("statGenerations") }}</span>
          </div>
          <div class="pp-actions">
            <button class="ws-primary" @click="enterStudio">{{ t("enterStudio") }} <ArrowRight :size="14" /></button>
            <button class="soft-btn" @click="openAgent(latest()?.id)">
              <Bot :size="14" /> {{ t("agent") }}
            </button>
            <button class="ghost-icon" :title="t('refreshAria')" :aria-label="t('refreshAria')" @click="void load()">
              <RefreshCw :size="14" />
            </button>
            <button class="ghost-icon" :title="t('renameAria')" :aria-label="t('renameAria')" @click="renamingProject = true">
              <Pencil :size="14" />
            </button>
            <button class="ghost-icon is-danger" :title="t('deleteAria')" :aria-label="t('deleteAria')" @click="void removeProject()">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </header>

      <div class="pp-grid">
        <section class="pp-sessions">
          <div class="wh-section-head">
            <span>{{ t("sessionsTitle") }}</span>
            <span class="pp-count">{{ sessions.length }}</span>
          </div>
          <button v-if="sessions.length === 0" class="pp-session pp-session-empty" @click="openAgent()">
            <span class="ws-session-dot" />
            <div><strong>{{ t("sessionsEmpty") }}</strong><small>{{ t("sessionsEmptyHint") }}</small></div>
            <ArrowRight :size="13" />
          </button>
          <div
            v-for="session in sessions"
            :key="session.id"
            class="pp-session"
            role="button"
            tabindex="0"
            :aria-label="t('openSession', { title: session.title })"
            @click="openAgent(session.id)"
            @keydown.enter.prevent="openAgent(session.id)"
            @keydown.space.prevent="openAgent(session.id)"
          >
            <span :class="['ws-session-dot', { 'is-running': session.status === 'running' }]" />
            <div>
              <strong>{{ session.title }}</strong>
              <small>
                {{ session.status === "running" ? t("sessionRunning") : t("sessionReady") }} ·
                {{ t("messages", { count: session.messageCount }) }}
              </small>
            </div>
            <em>{{ compact(session.tokens) }}</em><time>{{ relativeTime(session.updatedAt) }}</time>
            <ActionMenu
              :label="t('sessionActions', { title: session.title })"
              :icon-size="13"
              :items="sessionMenu(session)"
            />
          </div>
        </section>

        <section class="pp-assets">
          <div class="wh-section-head">
            <button class="pp-assets-link" :title="t('openAssets')" @click="openAssets">
              {{ t("assetsTitle") }} <ArrowRight :size="11" />
            </button>
            <button :disabled="uploading" @click="fileRef?.click()">
              {{ uploading ? t("uploading") : tBase("add") }} <ImagePlus :size="12" />
            </button>
          </div>
          <div class="pp-asset-grid">
            <button v-for="(asset, index) in assets" :key="asset.id" @click="openAsset(asset.url)">
              <img :src="asset.thumbnailUrl || asset.url" :alt="t('assetAlt', { index: index + 1 })" />
              <span>{{ String(index + 1).padStart(2, "0") }}</span>
            </button>
            <button class="pp-asset-add" @click="fileRef?.click()">+</button>
          </div>
          <input
            ref="fileRef"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            @change="(event) => { const input = event.target as HTMLInputElement; void upload(input.files); input.value = ''; }"
          />
        </section>
      </div>
    </section>

    <aside class="pp-side">
      <div class="wh-side-card">
        <span class="eyebrow">PROJECT</span>
        <div class="pp-side-row"><span>{{ t("createdAt") }}</span><strong>{{ project ? formatDate(project.createdAt) : "—" }}</strong></div>
        <div class="pp-side-row"><span>{{ t("lastEdited") }}</span><strong>{{ project ? relativeTime(project.updatedAt) : "—" }}</strong></div>
        <div class="pp-side-row"><span>{{ t("share") }}</span><strong>{{ t("shareValue") }}</strong></div>
        <div class="pp-side-row"><span>{{ t("storage") }}</span><strong>{{ t("storageValue") }}</strong></div>
      </div>
      <div class="wh-side-card">
        <span class="eyebrow">NEXT STEP</span>
        <p class="pp-next">
          {{
            latest()
              ? latest()!.status === "running"
                ? t("nextRunning", { title: latest()!.title })
                : t("nextReady", { title: latest()!.title })
              : t("nextEmpty")
          }}
        </p>
        <button class="ws-primary pp-small-cta" @click="openAgent(latest()?.id)">
          {{ latest() ? t("continueAgent") : t("startAgent") }}
        </button>
      </div>
      <div class="wh-side-card">
        <span class="eyebrow">FILES</span>
        <div class="wh-recent-files">
          <div>
            <span class="ws-file-icon csv" />
            <div><strong>lumen.db</strong><small>{{ t("filesPersist") }}</small></div>
          </div>
          <div v-for="asset in assets.slice(0, 2)" :key="asset.id">
            <span class="ws-file-icon img" />
            <div><strong>{{ asset.originalName || asset.id }}</strong><small>{{ Math.round(asset.size / 1024) }} KB</small></div>
          </div>
          <div v-if="assets.length === 0">
            <span class="ws-file-icon img" />
            <div><strong>{{ t("filesNone") }}</strong><small>{{ t("filesHint") }}</small></div>
          </div>
        </div>
      </div>
    </aside>

    <RenameDialog
      :open="renamingProject"
      :title="t('renameProject')"
      :description="t('renameProjectDesc')"
      :initial-value="project?.name || ''"
      :label="t('projectNameLabel')"
      :max-length="80"
      :busy="projectNameBusy"
      @close="!projectNameBusy && (renamingProject = false)"
      @submit="void saveProjectName($event)"
    />

    <RenameDialog
      :open="Boolean(renameSession)"
      :title="t('renameSession')"
      :description="t('renameSessionDesc')"
      :initial-value="renameSession?.title || ''"
      :label="t('sessionNameLabel')"
      :max-length="120"
      :busy="sessionNameBusy"
      @close="!sessionNameBusy && (renameSession = null)"
      @submit="void saveSessionName($event)"
    />
  </main>
</template>
