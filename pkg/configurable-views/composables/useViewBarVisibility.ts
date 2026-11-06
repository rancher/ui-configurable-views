import { ref } from 'vue';
import type { VuexStore } from '@shell/types/store/vuex';
import { PREF_BAR_VISIBLE, savePref } from '../templating/user-prefs';

/**
 * Whether the view bar shows. Hidden until asked for, through the header button or its shortcut -
 * shared by both, so the button's pressed state follows the shortcut.
 */
export const viewBarVisible = ref(false);

/** A view is being edited. The bar is the way out of the editor then, so it can't be hidden. */
export const viewBarLocked = ref(false);

/** What the person last chose, which the shell has read by the time a page is drawn. */
export function loadViewBar(store: VuexStore): void {
  viewBarVisible.value = store.getters['prefs/get'](PREF_BAR_VISIBLE) === true;
}

export function toggleViewBar(store: VuexStore): void {
  if (viewBarLocked.value) {
    return;
  }

  viewBarVisible.value = !viewBarVisible.value;
  // If it can't be saved, the choice holds for this page load only.
  savePref(store, PREF_BAR_VISIBLE, viewBarVisible.value).catch(() => undefined);
}
