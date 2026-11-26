import { ref, watch } from 'vue';
import { widgetHash } from '../templating/widget-hash';
import type { GeneratedWidget } from '../templating/template-engine';

/**
 * The hash of each other widget (code, by Liz or an admin), by name - what an approval is compared with.
 * Hashed again whenever the widgets are read again; a hashing overtaken by a newer one never lands.
 */
export function useWidgetHashes(widgets: () => GeneratedWidget[]) {
  const hashes = ref<Record<string, string>>({});
  let asked = 0;

  watch(widgets, async(list) => {
    const mine = ++asked;
    const out: Record<string, string> = {};

    for (const w of list) {
      out[w.name] = await widgetHash(w.source);
    }

    if (mine === asked) {
      hashes.value = out;
    }
  }, { immediate: true });

  return hashes;
}
