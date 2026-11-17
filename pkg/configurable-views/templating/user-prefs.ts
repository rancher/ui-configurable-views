// What a person keeps for themselves, in their own user preferences: every role can read and write
// its own, which is not true of the ConfigMaps published views are stored in.
//
// An extension bundles its own copy of the shell's `create`, so what that defines never reaches the
// host's store. These are defined at runtime, through the store itself.

import type { VuexStore } from '@shell/types/store/vuex';
import { STEVE } from '@shell/config/types';

/** Whether the configurable pages are on. */
export const PREF_ENABLED = 'configurable-views-enabled';
/** Whether the view bar shows. */
export const PREF_BAR_VISIBLE = 'configurable-views-bar-visible';
/** Their own views, by the page they are for. */
export const PREF_VIEWS = 'configurable-views-saved';

const DEFAULTS: Record<string, unknown> = {
  [PREF_ENABLED]:     true,
  [PREF_BAR_VISIBLE]: false,
  [PREF_VIEWS]:       {},
};

const defined = new WeakSet<VuexStore>();

/**
 * Define the preferences, once, before anything reads them: the shell throws on one it does not know.
 *
 * The shell's own read of what is saved only keeps the keys defined at that moment, and it has usually
 * been by now, so each saved value is taken from the preferences that read left in the store.
 */
export function definePrefs(store: VuexStore): void {
  if (defined.has(store)) {
    return;
  }

  defined.add(store);

  const saved: Record<string, string> = store.getters['management/all'](STEVE.PREFERENCE)?.[0]?.data || {};

  Object.entries(DEFAULTS).forEach(([name, def]) => {
    store.commit('prefs/setDefinition', {
      name,
      definition: {
        def, parseJSON: true, asUserPreference: true
      },
    });

    if (saved[name] !== undefined) {
      try {
        store.commit('prefs/load', { key: name, value: JSON.parse(saved[name]) });
      } catch (e) {
        // Not something we wrote, so it stays at its default.
      }
    }
  });
}

/**
 * Save one, and fail if that failed. The shell's action says so in what it returns, having already
 * changed the value here, so the value is put back and the caller gets an error to show.
 */
export async function savePref(store: VuexStore, key: string, value: unknown): Promise<void> {
  const before = store.getters['prefs/get'](key);
  const failed = await store.dispatch('prefs/set', { key, value });

  if (failed) {
    store.commit('prefs/load', { key, value: before });

    throw new Error(store.getters['i18n/t']('configurableViews.errors.savePreference'));
  }
}
