<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { useSettingsField } from './useSettingsField';
import type { WidgetLink, WidgetSpec } from '../../../templating/types';

const props = defineProps<{ widget: WidgetSpec }>();
const emit = defineEmits<{ update: [changes: Partial<WidgetSpec>] }>();

const store = useStore();
const { t } = useI18n(store);
const source = useSettingsField(props, emit)('source');

// One link per line, "Label https://url" - the URL is whatever follows the last space.
const linksText = computed({
  get: () => (props.widget.links || []).map((l) => `${ l.label } ${ l.url }`).join('\n'),
  set: (value: string) => {
    emit('update', {
      links: `${ value }`.split('\n').map((line): WidgetLink | null => {
        const at = line.trim().lastIndexOf(' ');

        return at < 0 ? null : { label: line.trim().slice(0, at).trim(), url: line.trim().slice(at + 1).trim() };
      }).filter((l): l is WidgetLink => !!l && !!l.label && !!l.url),
    });
  },
});
</script>

<template>
  <label class="wsm__label">{{ t('configurableViews.widgetSettings.show') }}</label>
  <label class="wsm__radio">
    <input
      v-model="source"
      type="radio"
      value="home"
    >
    {{ t('configurableViews.widgetSettings.linksHome') }}
  </label>
  <label class="wsm__radio">
    <input
      v-model="source"
      type="radio"
      value="custom"
    >
    {{ t('configurableViews.widgetSettings.linksCustom') }}
  </label>
  <p class="wsm__hint">
    {{ t('configurableViews.widgetSettings.linksHomeHint') }}
  </p>

  <template v-if="source === 'custom'">
    <label class="wsm__label">{{ t('configurableViews.widgetSettings.links') }}</label>
    <textarea
      v-model="linksText"
      class="wsm__field wsm__field--area"
      rows="6"
      placeholder="Runbook https://wiki.example.com/runbook"
    />
    <p class="wsm__hint">
      {{ t('configurableViews.widgetSettings.linksHint') }}
    </p>
  </template>
</template>
