import type { Component } from "vue";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: Component;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}
