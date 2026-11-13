<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import ResourceSummary from '@shell/components/ResourceSummary.vue';
import ResourceStatusCards from '@shell/pages/c/_cluster/explorer/resource-status/ResourceStatusCards.vue';
import { COUNT, NODE, WORKLOAD_TYPES } from '@shell/config/types';
import { NAME as EXPLORER } from '@shell/config/product/explorer';
import WidgetCard from './WidgetCard.vue';
import { useWidgetCluster, useOpenCluster, NO_CLUSTER } from '../../composables/useWidgetCluster';
import { useClusterStore } from '../../composables/useClusterStore';
import { summarizeCounts, totalCounts } from '../../templating/widget-data';
import type { WidgetSpec } from '../../templating/types';

// RESOURCE CARDS — the row under a cluster dashboard's header.
//
// On the cluster Rancher has open this IS the dashboard's ResourceStatusCards. Those read the `cluster`
// store, which holds only that cluster, so for any other cluster the widget draws Rancher's
// ResourceSummary - Total Resources, Nodes, Deployments - from that cluster's own counts, through its
// `spoofedCounts`.

const props = defineProps<{ widget: WidgetSpec }>();

const store = useStore();
const { t } = useI18n(store);
const { cluster } = useWidgetCluster(() => props.widget);
const isOpen = useOpenCluster(cluster);

type Counts = Record<string, { summary?: { count?: number; states?: Record<string, number> } }>;

// The open cluster's cards are stock's to read. Another cluster's counts are in its own store (see
// useClusterStore), which keeps them live, as the shell keeps the open cluster's.
const readFrom = computed(() => (isOpen.value ? '' : cluster.value));
const { name: inStore, error: storeError } = useClusterStore(() => readFrom.value);
const countsError = ref('');

watch(inStore, async(name) => {
  countsError.value = '';

  if (!name) {
    return;
  }

  try {
    await store.dispatch(`${ name }/findAll`, { type: COUNT });
  } catch (e) {
    if (inStore.value === name) {
      countsError.value = t('configurableViews.errors.counts', { cluster: readFrom.value });
    }
  }
}, { immediate: true });

const counts = computed<Counts | null>(() => (inStore.value ? store.getters[`${ inStore.value }/all`](COUNT)?.[0]?.counts || null : null));
const error = computed(() => storeError.value || countsError.value);

/** A card for one type, linking to that type's list in the widget's cluster. */
function card(resource: string) {
  const summary = summarizeCounts(counts.value, resource);

  return {
    ...summary,
    name:     store.getters['i18n/withFallback'](`typeLabel."${ resource }"`, { count: summary.useful }, resource),
    location: {
      name:   'c-cluster-product-resource',
      params: {
        cluster: cluster.value, product: EXPLORER, resource
      },
    },
  };
}

const cards = computed(() => {
  if (!counts.value) {
    return [];
  }

  // The dashboard shows Nodes and Deployments only to someone who can see them; the counts carry
  // exactly the types this user can list, so a type missing from them is the same answer.
  return [
    { ...totalCounts(store.getters, counts.value), name: t('clusterIndexPage.resourceGauge.totalResources') },
    ...[NODE, WORKLOAD_TYPES.DEPLOYMENT].filter((type) => counts.value?.[type]).map(card),
  ];
});
</script>

<template>
  <ResourceStatusCards v-if="isOpen" />
  <WidgetCard
    v-else-if="!cluster || error"
    :title="widget.title"
    :error="error || t(NO_CLUSTER)"
  />
  <div
    v-else
    class="resource-gauges"
  >
    <ResourceSummary
      v-for="entry in cards"
      :key="entry.name"
      :spoofed-counts="entry"
    />
  </div>
</template>
