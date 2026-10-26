<script setup lang="ts">
import type { ToastItem } from "../stores/app";

defineProps<{ items: ToastItem[] }>();
</script>

<template>
  <div class="toast-wrap" aria-live="polite">
    <div v-for="item in items" :key="item.id" :class="['toast', { success: item.type === 'success' }]">
      {{ item.message }}
    </div>
  </div>
</template>
