<script setup lang="ts">
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { METRICS_DASHBOARDS } from '../../../templating/widget-data';
import { useSettingsField } from './useSettingsField';
import type { WidgetSpec } from '../../../templating/types';

const props = defineProps<{ widget: WidgetSpec }>();
const emit = defineEmits<{ update: [changes: Partial<WidgetSpec>] }>();

const store = useStore();
const { t } = useI18n(store);
const metrics = useSettingsField(props, emit)('metrics');
</script>

<template>
  <label class="wsm__label">{{ t('configurableViews.widgetSettings.dashboard') }}</label>
  <select
    v-model="metrics"
    class="wsm__field"
  >
    <option
      v-for="(board, id) in METRICS_DASHBOARDS"
      :key="id"
      :value="id"
    >
      {{ t(board.labelKey) }}
    </option>
  </select>
  <p class="wsm__hint">
    {{ t('configurableViews.widgetSettings.dashboardHint') }}
  </p>
</template>
