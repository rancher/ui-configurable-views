<script setup lang="ts">
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { computed } from 'vue';
import { WIDGETS } from './registry';
import type { WidgetSpec } from '../../templating/types';

const props = withDefaults(defineProps<{
  widget: WidgetSpec;
  /** The widget's id on the grid: where a drop into a Tabs widget goes, and what a table keeps its own views under. */
  nodeId?: string;
  gap?: number;
}>(), { nodeId: '', gap: undefined });

const store = useStore();
const { t } = useI18n(store);
const definition = computed(() => WIDGETS[props.widget.kind]);

// Every widget is handed its spec, and whichever of the rest it says it needs.
const rendererProps = computed(() => ({
  widget: props.widget,
  ...Object.fromEntries((definition.value?.hostProps || []).map((name) => [name, props[name]])),
}));
</script>

<template>
  <component
    :is="definition.component"
    v-if="definition"
    :key="widget.kind"
    v-bind="rendererProps"
    class="whost"
  />
  <div
    v-else
    class="whost whost--unknown"
  >
    {{ t('configurableViews.widget.unknown', { kind: widget.kind }) }}
  </div>
</template>

<style lang="scss" scoped>
.whost {
  height: 100%;

  &--unknown {
    border:        1px dashed var(--border);
    border-radius: 4px;
    color:         var(--muted);
    font-size:     14px;
    padding:       20px 24px;
  }
}
</style>
