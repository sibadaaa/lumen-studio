<script setup lang="ts">
withDefaults(defineProps<{ count?: number }>(), { count: 8 });
</script>

<template>
  <div class="library-grid" aria-hidden="true">
    <div v-for="index in count" :key="index" class="media-card is-skeleton">
      <div class="media-card-thumb" />
      <div class="media-card-body">
        <span />
        <span />
      </div>
    </div>
  </div>
</template>
