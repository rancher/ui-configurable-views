<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { useI18n } from '@shell/composables/useI18n';
import { SCHEMA } from '@shell/config/types';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import { fetchClusterSchemas } from '../../../templating/widget-data';
import { typeOptions, type TypeOption, type TypeSchema } from '../../../templating/resource-types';
import { pageClusterOf } from '../../../composables/useWidgetCluster';
import { useSettingsField } from './useSettingsField';
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

const typeSchemas = ref<TypeSchema[]>([]);
const loadingTypes = ref(false);

/**
 * The schemas of where the table reads: Rancher's, or its cluster's.
 *
 * A table following the page on the Home has no cluster yet, so it is offered the local cluster's
 * types - the Kubernetes ones are the same everywhere. A type only another cluster has can be typed.
 */
const typesFrom = computed(() => (props.widget.fromCluster ? props.widget.cluster || pageClusterOf(route) : ''));

let typesAsked = 0;

watch(typesFrom, async(cluster) => {
  const asked = ++typesAsked;
  const local = () => store.getters['management/all'](SCHEMA) as TypeSchema[];

  if (!cluster) {
    typeSchemas.value = local();

    return;
  }

  loadingTypes.value = true;

  try {
    const schemas = await fetchClusterSchemas(store, cluster);

    if (asked === typesAsked) {
      typeSchemas.value = schemas;
    }
  } catch {
    if (asked === typesAsked) {
      typeSchemas.value = local();
    }
  } finally {
    if (asked === typesAsked) {
      loadingTypes.value = false;
    }
  }
}, { immediate: true });

const resourceOptions = computed(() => typeOptions(typeSchemas.value, props.widget.resource));

/**
 * A picked entry is its type; one typed in is the text itself, which the select hands back as a
 * `{ label }` of its own making, with no value.
 */
const typeOf = (option: Partial<TypeOption> | string): string => (typeof option === 'string' ? option : option.value ?? option.label ?? '');
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
    :reduce="typeOf"
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
