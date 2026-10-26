<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <div class="library-selection-bar" role="region" aria-live="polite" :aria-label="label">
    <span class="library-selection-label">{{ label }}</span>
    <div class="library-selection-actions">
      <slot />
    </div>
  </div>
</template>
