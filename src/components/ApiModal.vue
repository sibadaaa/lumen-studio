<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Eye, EyeOff, LoaderCircle, ShieldCheck, X } from "lucide-vue-next";
import type { ProviderConfigInput, ProviderKind } from "../../shared/contracts";
import { api } from "../lib/api";
import { useAppStore } from "../stores/app";
import { useT } from "../i18n";

interface ProviderTab {
  id: string;
  label: string;
  kind: ProviderKind;
  tag: string;
  base: string;
  image: string;
  video: string;
  logo: string;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const app = useAppStore();
const t = useT("api");

const TABS: ProviderTab[] = [
  {
    id: "ark",
    label: "火山方舟",
    kind: "ark",
    tag: "推荐",
    base: "https://ark.cn-beijing.volces.com/api/v3",
    image: "doubao-seedream-4-0-250828",
    video: "doubao-seedance-1-0-pro-250528",
    logo: "A",
  },
  {
    id: "openai",
    label: "OpenAI 兼容",
    kind: "openai_compatible",
    tag: "",
    base: "https://api.openai.com/v1",
    image: "gpt-image-1",
    video: "sora-2",
    logo: "◎",
  },
  {
    id: "custom",
    label: "自定义网关",
    kind: "openai_compatible",
    tag: "",
    base: "http://127.0.0.1:8080/v1",
    image: "custom-image-model",
    video: "custom-video-model",
    logo: "⌁",
  },
  {
    id: "mock",
    label: "本地演示",
    kind: "mock",
    tag: "离线",
    base: "local://mock",
    image: "lumen-mock-image",
    video: "lumen-mock-video",
    logo: "M",
  },
];

const provider = ref("ark");
const baseUrl = ref(TABS[0].base);
const imageModel = ref(TABS[0].image);
const videoModel = ref(TABS[0].video);
const apiKey = ref("");
const configured = ref(false);
const keyMasked = ref("");
const showKey = ref(false);
const testState = ref<"idle" | "testing" | "success" | "error">("idle");
const testMessage = ref("");
const latency = ref<number | null>(null);
const saving = ref(false);
const formError = ref("");

const tab = computed(() => TABS.find((item) => item.id === provider.value) || TABS[0]);
const isMock = computed(() => tab.value.kind === "mock");

function loadProvider(id: string) {
  const nextTab = TABS.find((item) => item.id === id) || TABS[0];
  const info = app.runtime.providers.find((item) => item.id === id);
  provider.value = nextTab.id;
  baseUrl.value = info?.baseUrl || nextTab.base;
  imageModel.value = info?.imageModel || nextTab.image;
  videoModel.value = info?.videoModel || nextTab.video;
  configured.value = Boolean(info?.configured);
  keyMasked.value = info?.keyMasked || "";
  apiKey.value = "";
  showKey.value = false;
  testState.value = "idle";
  testMessage.value = "";
  latency.value = info?.lastLatencyMs ?? null;
  formError.value = "";
}

watch(
  () => [props.open, app.runtime.activeProviderId] as const,
  ([open]) => {
    if (open) loadProvider(app.runtime.activeProviderId || "ark");
  },
  { immediate: true }
);

function selectProvider(id: string) {
  if (saving.value || testState.value === "testing") return;
  loadProvider(id);
}

async function save() {
  if (saving.value) return null;
  formError.value = "";
  if (!isMock.value && !configured.value && !apiKey.value.trim()) {
    formError.value = t("errKey");
    return null;
  }
  if (!isMock.value && !baseUrl.value.trim().startsWith("http")) {
    formError.value = t("errUrl");
    return null;
  }
  const input: ProviderConfigInput = {
    kind: tab.value.kind,
    baseUrl: isMock.value ? "local://mock" : baseUrl.value.trim(),
    imageModel: isMock.value ? "lumen-mock-image" : imageModel.value.trim(),
    videoModel: isMock.value ? "lumen-mock-video" : videoModel.value.trim(),
    ...(apiKey.value.trim() ? { apiKey: apiKey.value.trim() } : {}),
  };
  saving.value = true;
  try {
    const info = await api.saveProvider(provider.value, input);
    configured.value = info.configured;
    keyMasked.value = info.keyMasked;
    apiKey.value = "";
    await app.refreshRuntime();
    app.toast(isMock.value ? t("toasts.mockOn") : t("toasts.saved"), "success");
    return info;
  } catch (error) {
    formError.value = (error as Error).message;
    return null;
  } finally {
    saving.value = false;
  }
}

async function test() {
  if (testState.value === "testing") return;
  testState.value = "testing";
  testMessage.value = t("footer.testing");
  const saved = await save();
  if (!saved) {
    testState.value = "error";
    testMessage.value = t("toasts.notSaved");
    return;
  }
  try {
    const result = await api.testProvider(provider.value);
    testState.value = result.ok ? "success" : "error";
    testMessage.value = result.message;
    latency.value = result.latencyMs;
    if (result.ok) app.toast(t("toasts.ok"), "success");
  } catch (error) {
    testState.value = "error";
    testMessage.value = (error as Error).message;
  }
}

async function handleSave() {
  const saved = await save();
  if (saved) emit("close");
}

const capabilities = computed(
  () => app.runtime.providers.find((item) => item.id === provider.value)?.capabilities
);
const offline = computed(() => !app.runtime.online);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="apiTitle">
        <header class="modal-head">
          <div>
            <span class="eyebrow">CONNECTION</span>
            <h2 id="apiTitle">{{ t("title") }}</h2>
            <p>{{ t("desc") }}</p>
          </div>
          <button class="modal-close" :aria-label="t('close', { ns: 'base' })" @click="emit('close')">
            <X :size="15" />
          </button>
        </header>

        <div class="modal-body">
          <div class="provider-tabs" role="tablist" :aria-label="t('title')">
            <button
              v-for="item in TABS"
              :key="item.id"
              role="tab"
              :aria-selected="provider === item.id"
              :class="{ 'is-active': provider === item.id }"
              @click="selectProvider(item.id)"
            >
              <span :class="['provider-logo', item.id]">{{ item.logo }}</span>
              {{ t(`tabs.${item.id}`) }}
              <em v-if="item.tag">{{ item.id === "ark" ? t("tabs.tagRecommend") : t("tabs.tagOffline") }}</em>
            </button>
          </div>

          <div :class="['connected-banner', { 'is-warning': offline, 'is-error': testState === 'error' }]">
            <span class="banner-icon">
              <X v-if="offline" :size="13" />
              <span v-else-if="isMock" class="mock-badge">M</span>
              <ShieldCheck v-else :size="13" />
            </span>
            <div>
              <strong>
                {{
                  offline
                    ? t("banner.offlineTitle")
                    : isMock
                      ? t("banner.mockTitle")
                      : configured
                        ? t("banner.configuredTitle")
                        : t("banner.setupTitle")
                }}
              </strong>
              <span>
                {{
                  offline
                    ? t("banner.offlineBody")
                    : isMock
                      ? t("banner.mockBody")
                      : t("banner.configuredBody", { mask: keyMasked || "—" })
                }}
              </span>
            </div>
            <span class="banner-tag">
              {{ offline ? "OFFLINE" : isMock ? "LOCAL" : configured ? "ENCRYPTED" : "SETUP" }}
            </span>
          </div>

          <div class="connection-meta">
            <span><i :class="{ ok: app.runtime.online }" />{{ t("meta.bff", { version: app.runtime.version }) }}</span>
            <span><i :class="{ ok: app.runtime.ffmpeg }" />FFmpeg {{ app.runtime.ffmpeg ? t("meta.ffmpegOk") : t("meta.ffmpegMissing") }}</span>
            <span><i :class="{ ok: configured }" />{{ configured ? t("meta.configured") : t("meta.unconfigured") }}</span>
          </div>

          <div class="form-grid">
            <label class="form-field full">
              <span>{{ t("form.baseUrl") }}</span>
              <input v-model="baseUrl" spellcheck="false" :disabled="isMock" />
            </label>
            <label v-if="!isMock" class="form-field full">
              <span>{{ t("form.key") }} <em v-if="configured" class="field-note">{{ t("form.keySaved") }}</em></span>
              <div class="secret-input">
                <input
                  v-model="apiKey"
                  :type="showKey ? 'text' : 'password'"
                  :placeholder="configured ? t('form.keyKeep', { mask: keyMasked || '••••••••' }) : t('form.keyPlaceholder')"
                  autocomplete="new-password"
                  spellcheck="false"
                />
                <button type="button" @click="showKey = !showKey">
                  <EyeOff v-if="showKey" :size="13" /><Eye v-else :size="13" />{{ showKey ? t("form.hide") : t("form.show") }}
                </button>
              </div>
              <small>{{ t("form.keyNote") }}</small>
            </label>
            <label class="form-field">
              <span>{{ t("form.imageModel") }}</span>
              <input v-model="imageModel" spellcheck="false" :disabled="isMock" />
            </label>
            <label class="form-field">
              <span>{{ t("form.videoModel") }}</span>
              <input v-model="videoModel" spellcheck="false" :disabled="isMock" />
            </label>
          </div>

          <div v-if="formError" class="form-error">{{ formError }}</div>

          <div class="capability-row">
            <span class="capability-label">{{ t("caps.label") }}</span>
            <span
              v-for="item in [
                [t('caps.t2i'), capabilities?.textToImage ?? true],
                [t('caps.i2i'), capabilities?.imageToImage ?? true],
                [t('caps.t2v'), capabilities?.textToVideo ?? true],
                [t('caps.i2v'), capabilities?.imageToVideo ?? true],
                [t('caps.multi'), capabilities?.multiImageToVideo ?? true],
              ]"
              :key="String(item[0])"
              :class="['capability', { on: item[1] }]"
            ><i />{{ item[0] }}</span>
            <span :class="['capability', { on: app.runtime.ffmpeg }]"><i />{{ t("caps.ffmpeg") }}</span>
          </div>

          <div class="modal-note">
            <svg viewBox="0 0 18 18" fill="none"><path d="M9 2.6 15.3 14H2.7L9 2.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /><path d="M9 7v3.2M9 12.6v.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>
            <p>{{ t("note") }}</p>
          </div>
        </div>

        <footer class="modal-foot">
          <button
            :class="['test-btn', { 'is-testing': testState === 'testing', 'is-success': testState === 'success' }]"
            :disabled="saving || testState === 'testing'"
            @click="test"
          >
            <span class="test-dot" />
            {{ testState === "testing" ? t("footer.testing") : t("footer.test") }}
          </button>
          <div class="modal-foot-right">
            <span :class="['test-state', testState === 'success' ? 'success' : testState === 'error' ? 'error' : '']">
              <template v-if="testState === 'testing'"><LoaderCircle :size="11" class="spin" />{{ testMessage }}</template>
              <template v-else-if="testMessage">{{ testMessage }}{{ latency !== null ? ` · ${latency}ms` : "" }}</template>
              <template v-else>{{ t("footer.wait") }}</template>
            </span>
            <button class="save-btn" :disabled="saving" @click="handleSave">
              {{ saving ? t("footer.saving") : t("footer.save") }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
