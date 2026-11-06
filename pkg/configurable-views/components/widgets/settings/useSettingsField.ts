import { computed } from 'vue';
import type { WidgetSpec } from '../../../templating/types';

/**
 * A widget's settings edit the dialog's copy of it, and only hand back what changed. This makes one
 * field of that copy something to `v-model`.
 */
export function useSettingsField(props: { widget: WidgetSpec }, emit: (event: 'update', changes: Partial<WidgetSpec>) => void) {
  return <K extends keyof WidgetSpec>(key: K) => computed({
    get: () => props.widget[key],
    set: (value: WidgetSpec[K]) => emit('update', { [key]: value }),
  });
}
