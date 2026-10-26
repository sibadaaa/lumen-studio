<script setup lang="ts">
import { computed } from "vue";
import type { AgentPlanStep } from "../../shared/contracts";
import { useT } from "../i18n";

defineOptions({ name: "PlanCard" });

const props = defineProps<{ steps: AgentPlanStep[] }>();
const t = useT("agent");
const done = computed(() => props.steps.filter((step) => step.status === "done").length);
</script>

<template>
  <div v-if="steps.length" class="ws-plan">
    <div class="ws-plan-head"><span>{{ t("tool.planTitle") }}</span><strong>{{ done }} / {{ steps.length }}</strong></div>
    <div v-for="step in steps" :key="step.id" :class="['ws-plan-step', step.status]">
      <i>{{ step.status === "done" ? "✓" : step.status === "failed" ? "!" : "" }}</i>
      <span>{{ step.label }}</span>
      <em>
        {{
          step.note ||
          (step.status === "running" ? t("tool.stepRunning") : step.status === "pending" ? t("tool.stepPending") : "")
        }}
      </em>
    </div>
  </div>
</template>
