<script setup lang="ts">
import { computed, watch } from 'vue';
import { useStore } from 'vuex';
import {
  CAPI, CATALOG, INGRESS, LOCAL_CLUSTER, MANAGEMENT
} from '@shell/config/types';
import { useI18n } from '@shell/composables/useI18n';
import ResourceTable from '@shell/components/ResourceTable.vue';
import PaginatedResourceTable from '@shell/components/PaginatedResourceTable.vue';
import WidgetCard from './WidgetCard.vue';
import { columnsLinkingTo } from '../../templating/widget-data';
import { PAGINATION_CONTEXT, pageLikeItsList } from '../../templating/table-paging';
import { useWidgetCluster, useOpenCluster, NO_CLUSTER } from '../../composables/useWidgetCluster';
import { useClusterStore } from '../../composables/useClusterStore';
import { useTablePage } from '../../composables/useTablePage';
import type { TableColumn } from '@shell/types/store/type-map';
import type { WidgetSpec } from '../../templating/types';

// TABLE — "Rows of a resource".
//
// The widget says WHAT the table shows: the resource, and where it is read from - Rancher's own API,
// or one cluster's (`fromCluster`). HOW it shows it is the table views': the toolbar every resource list has, with its
// filter query, columns, grouping, sort and export, and, when the widget asks (`viewTabs`), the
// saved-view tabs. The saved views are the type's own, shared with every list of it, unless the
// widget keeps its own (`ownViews`), which live under the type by the widget's id.
//
// The rows are read from a store: from RANCHER the `management` store, from the cluster that is OPEN the
// `cluster` store, and from ANY OTHER cluster a store of the package's own for that cluster (see
// useClusterStore). Where the type's own list is paged (see table-paging), the server pages the table too,
// and the page is the table's own (see useTablePage): a store keeps one page of a type, so two tables of
// the type would show whichever page was read last. Where it is not, the table is Rancher's
// PaginatedResourceTable, over every row of the type in the store, which tables of the type share as they are.
//
// It is KEYED on what it asks for (see tableKey): the table reads its saved views once, when it is
// built, so a new question is a new table.

const props = withDefaults(defineProps<{ widget: WidgetSpec; nodeId?: string }>(), { nodeId: '' });

const store = useStore();
const { t } = useI18n(store);
const { cluster, pageCluster } = useWidgetCluster(() => props.widget);

/** Rows per page: a widget is a glance at a list, not the list. */
const PER_PAGE = 10;

/** What a paged table's own list adds to its query: nothing. Its saved views count their rows within it. */
const LIST_SCOPE = {
  page: 1, sort: [], filters: [], projectsOrNamespaces: []
};

const downstream = computed(() => !!props.widget.fromCluster);
const isOpen = useOpenCluster(cluster);

/**
 * The type the table lists. Rancher's own list of provisioning clusters lists their MANAGEMENT
 * clusters - its rows and columns (provider, version, machines) are the management cluster's - so a
 * table of provisioning clusters read from Rancher does the same. Read whole, a provisioning cluster
 * has only its CRD's columns: its id for a name, and no provider, version or machines.
 */
const listed = computed(() => (!downstream.value && props.widget.resource === CAPI.RANCHER_CLUSTER ? MANAGEMENT.CLUSTER : props.widget.resource));

/**
 * Types whose shell model reads the open cluster to draw a row, and throws without one, which leaves the
 * table blank: an App reads its worker OSs, and an Ingress which fields its schema has. A Home loaded
 * fresh has none, so the table says what it needs until a cluster is opened.
 */
const NEED_OPEN_CLUSTER: string[] = [CATALOG.APP, INGRESS];

const needsOpenCluster = computed(() => NEED_OPEN_CLUSTER.includes(listed.value) && !store.getters['currentCluster']);

// A cluster that is not the open one is read through a store of its own, made the first time a widget
// asks for it.
const ownCluster = computed(() => (downstream.value && !isOpen.value && !needsOpenCluster.value ? cluster.value : ''));
const { name: ownStore, error: ownStoreError } = useClusterStore(() => ownCluster.value);

/** The store the table reads, '' while there is none to read. */
const inStore = computed(() => {
  if (!downstream.value) {
    return 'management';
  }

  return isOpen.value ? 'cluster' : ownStore.value;
});

/**
 * The schema of the type, as the store the rows are read from has it. Rows read from a cluster are drawn
 * with that cluster's columns: another cluster, or the local one, can serve the same type with different
 * ones.
 */
const schema = computed(() => (inStore.value && listed.value ? store.getters[`${ inStore.value }/schemaFor`](listed.value) : null));

// Whether the server pages it is settled before the table is built, which is when the table asks.
watch(() => [inStore.value, listed.value], ([from, type]) => {
  if (from && type) {
    pageLikeItsList(store, from, type);
  }
}, { immediate: true });

/** Whether the server pages the table: the shell's answer for the type in its store, as settled above. */
const paged = computed(() => !!schema.value && !!store.getters[`${ inStore.value }/paginationEnabled`]?.({ id: listed.value, context: PAGINATION_CONTEXT }));

// The cluster the rows are in, which is the one their links go to: the one read from, or, for Rancher's
// own API, the local cluster. That is rarely the one in the page's URL: the Home has none, and a
// cluster's dashboard can hold a table of another cluster.
const rowsCluster = computed(() => (downstream.value ? cluster.value : LOCAL_CLUSTER));

/**
 * The type's own columns, as its list page has them - and, for a list the server pages, the ones the
 * server can sort and filter by.
 */
const headersFor = (pagedList: boolean): TableColumn[] => (schema.value ? columnsLinkingTo(store.getters['type-map/headersFor'](schema.value, pagedList) || [], rowsCluster.value, pageCluster.value === rowsCluster.value) : []);
const headers = computed(() => headersFor(false));
const pagedHeaders = computed(() => headersFor(true));

// The table views' saved-view tabs, and whose saved views they are: the type's, or this widget's.
const viewTabs = computed(() => !!props.widget.viewTabs);
const tableViewsPage = computed(() => (props.widget.ownViews && props.nodeId ? `widget-${ props.nodeId }` : null));

const tableKey = computed(() => JSON.stringify([listed.value, inStore.value, !!schema.value, paged.value, viewTabs.value, tableViewsPage.value]));

// A paged table's own page, read as it asks.
const {
  rows, loading, args, asked, result, load, reset
} = useTablePage(() => ({
  inStore: paged.value ? inStore.value : '', type: listed.value, pageSize: PER_PAGE
}));

// A table built anew asks for its first page.
watch(tableKey, reset);

/**
 * The count beside the title, as a list's heading shows it: how many rows there are - the total of the
 * table's last page, or, when the store holds every row, how many it holds.
 */
const count = computed<number | null>(() => {
  if (!schema.value) {
    return null;
  }

  if (paged.value) {
    return result.value?.count ?? null;
  }

  return (store.getters[`${ inStore.value }/all`]?.(listed.value) || []).length;
});

// The store of the widget's cluster is still being made.
const loadingStore = computed(() => !!ownCluster.value && !ownStore.value && !ownStoreError.value);

const message = computed(() => {
  if (downstream.value && !cluster.value) {
    return t(NO_CLUSTER);
  }

  if (needsOpenCluster.value) {
    return t('configurableViews.widget.needsOpenCluster', { type: t(`typeLabel."${ listed.value }"`, { count: 2 })?.trim() || listed.value });
  }

  if (ownStoreError.value) {
    return ownStoreError.value;
  }

  if (loadingStore.value) {
    return '';
  }

  return schema.value ? '' : t('configurableViews.widget.noType', { type: props.widget.resource });
});
</script>

<template>
  <WidgetCard
    :title="widget.title"
    :count="widget.title && !message ? count : null"
    :loading="loadingStore"
    :error="message"
  >
    <ResourceTable
      v-if="paged"
      :key="tableKey"
      :schema="schema"
      :rows="rows"
      :headers="pagedHeaders"
      :loading="loading || !asked"
      :alt-loading="!!result"
      :override-in-store="inStore"
      :table-views="true"
      :table-view-tabs="viewTabs"
      :table-views-page="tableViewsPage"
      :table-actions="false"
      :row-actions="false"
      :namespaced="false"
      :search="false"
      :rows-per-page="PER_PAGE"
      :external-pagination-enabled="true"
      :external-pagination-result="result"
      :external-pagination-args="args"
      :external-pagination-scope="LIST_SCOPE"
      key-field="id"
      @pagination-changed="load"
    />
    <PaginatedResourceTable
      v-else
      :key="tableKey"
      :schema="schema"
      :headers="headers"
      :pagination-headers="pagedHeaders"
      :context="PAGINATION_CONTEXT"
      :override-in-store="inStore"
      :table-views="true"
      :table-view-tabs="viewTabs"
      :table-views-page="tableViewsPage"
      :table-actions="false"
      :row-actions="false"
      :namespaced="false"
      :search="false"
      :rows-per-page="PER_PAGE"
      key-field="id"
    />
  </WidgetCard>
</template>

<style lang="scss" scoped>
// The table brings its own top margin for the toolbar it is not showing here.
.wcard :deep(.sortable-table-header) {
  margin-bottom: 0;
}
</style>
