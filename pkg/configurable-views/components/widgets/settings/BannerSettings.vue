<script setup lang="ts">
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { useSettingsField } from './useSettingsField';
import type { WidgetSpec } from '../../../templating/types';

const props = defineProps<{ widget: WidgetSpec }>();
const emit = defineEmits<{ update: [changes: Partial<WidgetSpec>] }>();

const store = useStore();
const { t } = useI18n(store);
const field = useSettingsField(props, emit);
const subtitle = field('subtitle');
const image = field('image');
</script>

<template>
  <label class="wsm__label">{{ t('configurableViews.widgetSettings.subtitle') }}</label>
  <input
    v-model="subtitle"
    class="wsm__field"
  >
  <label class="wsm__label">{{ t('configurableViews.widgetSettings.image') }}</label>
  <input
    v-model="image"
    class="wsm__field"
    :placeholder="t('configurableViews.widgetSettings.imagePlaceholder')"
  >
</template>
