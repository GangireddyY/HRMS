import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const SIDEBAR_KEY = 'hrms.sidebarCollapsed';

/** Shell UI state: sidebar, mobile navigation, command palette. Theme lives in the theme store. */
export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_KEY) === '1');
  const mobileNavOpen = ref(false);
  const searchOpen = ref(false);
  /** The "More" menu of the phone / tablet layout. */
  const moreOpen = ref(false);

  watch(sidebarCollapsed, (value) => localStorage.setItem(SIDEBAR_KEY, value ? '1' : '0'));

  return { sidebarCollapsed, mobileNavOpen, searchOpen, moreOpen };
});
