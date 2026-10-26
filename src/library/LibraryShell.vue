<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  description: string;
}>();
</script>

<template>
  <main class="library-page">
    <section class="library-main">
      <header class="library-head">
        <div>
          <span class="eyebrow">{{ eyebrow }}</span>
          <h1>{{ title }}</h1>
          <p>{{ description }}</p>
        </div>
        <div class="library-head-side">
          <div v-if="$slots.stats" class="library-stats">
            <slot name="stats" />
          </div>
          <div v-if="$slots.actions" class="library-actions">
            <slot name="actions" />
          </div>
        </div>
      </header>
      <div v-if="$slots.toolbar" class="library-toolbar">
        <slot name="toolbar" />
      </div>
      <div class="library-content">
        <slot />
      </div>
    </section>
  </main>
</template>
