<script setup lang="ts">
defineProps<{ message: string }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="library-error" role="alert">
    <span>{{ message }}</span>
    <button @click="emit('retry')">重试</button>
  </div>
</template>
