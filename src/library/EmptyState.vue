<script setup lang="ts">
withDefaults(defineProps<{ title: string; description: string }>(), {});
</script>

<template>
  <div class="library-empty">
    <div class="library-empty-art" aria-hidden="true">
      <svg viewBox="0 0 64 48" fill="none">
        <rect x="6" y="6" width="52" height="36" rx="6" stroke="currentColor" stroke-width="1.2" opacity=".5" />
        <circle cx="44" cy="16" r="3" fill="currentColor" opacity=".8" />
        <path d="M12 34 24 22l8 7 7-6 13 11" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" opacity=".7" />
      </svg>
    </div>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>
