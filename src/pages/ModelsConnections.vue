<script setup lang="ts">
import { ref } from "vue";
import { CheckCircle2, LoaderCircle, PlugZap, ShieldCheck } from "lucide-vue-next";
import type { ProviderInfo } from "../../shared/contracts";
import { api } from "../lib/api";
import { relativeTime } from "../library/format";
import { useT } from "../i18n";
import { useAppStore } from "../stores/app";

defineOptions({ name: "ModelsConnections" });

const props = defineProps<{ providers: ProviderInfo[]; activeId: string | null }>();
const app = useAppStore();
const t = useT("models");
const testing = ref<string | null>(null);
const results = ref<Record<string, string>>({});

async function test(provider: ProviderInfo) {
  testing.value = provider.id;
  try {
    const result = await api.testProvider(provider.id);
    results.value = {
      ...results.value,
      [provider.id]: `${result.message}${result.latencyMs ? ` · ${result.latencyMs}ms` : ""}`,
    };
    if (result.ok) app.toast(t("connections.ok"), "success");
    await app.refreshRuntime();
  } catch (err) {
    results.value = { ...results.value, [provider.id]: (err as Error).message };
  } finally {
    testing.value = null;
  }
}

async function activate(provider: ProviderInfo) {
  try {
    await api.activateProvider(provider.id);
    await app.refreshRuntime();
    app.toast(t("connections.switched", { provider: provider.label }), "success");
  } catch (err) {
    app.toast((err as Error).message);
  }
}
</script>

<template>
  <div class="provider-cards">
    <article v-for="provider in props.providers" :key="provider.id" :class="['provider-card', { 'is-active': provider.id === props.activeId }]">
      <header>
        <strong>{{ provider.label }}</strong>
        <span :class="['provider-state', { ok: provider.configured }]">
          <template v-if="provider.id === props.activeId"><CheckCircle2 :size="12" /> {{ t("connections.active") }}</template>
          <template v-else-if="provider.configured">{{ t("connections.configured") }}</template>
          <template v-else>{{ t("connections.unconfigured") }}</template>
        </span>
      </header>
      <dl>
        <div><dt>{{ t("connections.baseUrl") }}</dt><dd>{{ provider.baseUrl }}</dd></div>
        <div>
          <dt>{{ t("connections.key") }}</dt>
          <dd>{{ provider.kind === "mock" ? t("connections.keyLocal") : provider.keyMasked || t("connections.keyNotSet") }}</dd>
        </div>
        <div><dt>{{ t("connections.models") }}</dt><dd>{{ provider.imageModel }} / {{ provider.videoModel }}</dd></div>
        <div>
          <dt>{{ t("connections.lastTest") }}</dt>
          <dd>
            {{
              provider.lastTestedAt
                ? `${relativeTime(provider.lastTestedAt)} · ${provider.lastLatencyMs ?? "—"}ms`
                : t("connections.never")
            }}
          </dd>
        </div>
      </dl>
      <p v-if="results[provider.id]" class="provider-test-result">{{ results[provider.id] }}</p>
      <footer>
        <button class="soft-btn" :disabled="testing === provider.id" @click="void test(provider)">
          <template v-if="testing === provider.id"><LoaderCircle :size="13" class="spin" /> {{ t("connections.testing") }}</template>
          <template v-else><ShieldCheck :size="13" /> {{ t("connections.test") }}</template>
        </button>
        <button v-if="provider.id !== props.activeId && provider.configured" class="soft-btn" @click="void activate(provider)">
          <PlugZap :size="13" /> {{ t("connections.setActive") }}
        </button>
        <button class="soft-btn" @click="app.openApi()">{{ t("connections.edit") }}</button>
      </footer>
    </article>
  </div>
</template>
