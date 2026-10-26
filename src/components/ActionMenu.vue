<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";
import { MoreHorizontal } from "lucide-vue-next";
import type { ActionMenuItem } from "./action-menu";

const props = withDefaults(
  defineProps<{
    label: string;
    items: ActionMenuItem[];
    align?: "start" | "end";
    className?: string;
    iconSize?: number;
  }>(),
  { align: "end", className: "", iconSize: 14 }
);

const POP_WIDTH = 148;
const ITEM_HEIGHT = 32;
const GAP = 6;

const open = ref(false);
const position = ref<{ top: number; left: number } | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const popRef = ref<HTMLElement | null>(null);

function cleanup() {
  document.removeEventListener("mousedown", onPointerDown);
  document.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("resize", close);
  window.removeEventListener("scroll", close, true);
}

function close() {
  open.value = false;
  cleanup();
}

function onPointerDown(event: MouseEvent) {
  const target = event.target as Node;
  if (!rootRef.value?.contains(target) && !popRef.value?.contains(target)) close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

function toggle(event: MouseEvent) {
  event.stopPropagation();
  if (open.value) {
    close();
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const height = props.items.length * ITEM_HEIGHT + 10;
  const left = Math.max(
    8,
    Math.min(
      props.align === "start" ? rect.left : rect.right - POP_WIDTH,
      window.innerWidth - POP_WIDTH - 8
    )
  );
  const below = rect.bottom + GAP;
  const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - GAP) : below;
  position.value = { top, left };
  open.value = true;
  nextTick(() => {
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
  });
}

function select(item: ActionMenuItem) {
  close();
  item.onSelect();
}

onBeforeUnmount(cleanup);
</script>

<template>
  <div ref="rootRef" :class="['action-menu', className, { 'is-open': open }]" @click.stop>
    <button
      type="button"
      class="action-menu-trigger"
      :aria-label="label"
      :title="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <MoreHorizontal :size="iconSize" />
    </button>
    <Teleport to="body">
      <div
        v-if="open && position"
        ref="popRef"
        :class="['action-menu-pop', { 'align-start': align === 'start' }]"
        role="menu"
        :style="{ top: `${position.top}px`, left: `${position.left}px` }"
      >
        <button
          v-for="item in items"
          :key="item.key"
          type="button"
          role="menuitem"
          :disabled="item.disabled"
          :class="item.danger ? 'is-danger' : undefined"
          @click.stop="select(item)"
        >
          <component :is="item.icon" v-if="item.icon" :size="12" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
