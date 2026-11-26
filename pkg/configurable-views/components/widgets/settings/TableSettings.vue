<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { useI18n } from '@shell/composables/useI18n';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import { typeOptions, typeOfOption } from '../../../templating/resource-types';
import { pageClusterOf } from '../../../composables/useWidgetCluster';
import { useSettingsField } from './useSettingsField';
import { useTypeSchemas } from './useTypeSchemas';
import type { WidgetSpec } from '../../../templating/types';

// A table needs a resource where it reads, and how much of the table views it shows. Its columns, sort,
// filter and grouping are the table views', set in the table itself.

const props = defineProps<{ widget: WidgetSpec }>();
const emit = defineEmits<{ update: [changes: Partial<WidgetSpec>] }>();

const store = useStore();
const { t } = useI18n(store);
const route = useRoute();
const field = useSettingsField(props, emit);
const resource = field('resource');
const viewTabs = field('viewTabs');
const ownViews = field('ownViews');

/**
 * Where the table reads: its cluster's types, or Rancher's. A table following the page on the Home has
 * no cluster yet, so it is offered the local cluster's (see useTypeSchemas).
 */
const typesFrom = computed(() => (props.widget.fromCluster ? props.widget.cluster || pageClusterOf(route) : ''));
const { typeSchemas, loadingTypes } = useTypeSchemas(() => typesFrom.value);

const resourceOptions = computed(() => typeOptions(typeSchemas.value, props.widget.resource));
</script>

<template>
  <label class="wsm__label">{{ t('configurableViews.widgetSettings.resource') }}</label>
  <LabeledSelect
    v-model:value="resource"
    class="table-settings__resource"
    :options="resourceOptions"
    :loading="loadingTypes"
    :searchable="true"
    :taggable="true"
    :clearable="false"
    :reduce="typeOfOption"
    data-testid="configurable-views-widget-resource"
  />
  <p class="wsm__hint">
    {{ t('configurableViews.widgetSettings.resourceHint') }}
  </p>

  <label class="wsm__label">{{ t('configurableViews.widgetSettings.views') }}</label>
  <label class="wsm__radio">
    <input
      v-model="viewTabs"
      type="checkbox"
      data-testid="configurable-views-table-view-tabs"
    >
    {{ t('configurableViews.widgetSettings.viewTabs') }}
  </label>
  <label class="wsm__radio">
    <input
      v-model="ownViews"
      type="checkbox"
      :disabled="!viewTabs"
      data-testid="configurable-views-table-own-views"
    >
    {{ t('configurableViews.widgetSettings.ownViews') }}
  </label>
  <p class="wsm__hint">
    {{ t('configurableViews.widgetSettings.viewsHint') }}
  </p>
</template>

<style lang="scss" scoped>
// The shell's searchable select, across the dialog like the fields around it
.table-settings__resource {
  width: 100%;
}
</style>
