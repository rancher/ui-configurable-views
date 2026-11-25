<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import PaginatedResourceTable from '@shell/components/PaginatedResourceTable.vue';
import ClusterRowPin from '@shell/components/ClusterRowPin.vue';
import { RcButton } from '@components/RcButton';
import type { ButtonVariant } from '@components/RcButton/types';
import { BadgeState } from '@components/BadgeState';
import { STATE, CLUSTER_BADGE, MGMT_CLUSTER_PROVIDER, MGMT_CLUSTER_KUBE_VERSION } from '@shell/config/table-headers';
import { STEVE_MGMT_STATE_COL, STEVE_NAME_COL, STEVE_MGMT_CLUSTER_PROVIDER, STEVE_MGMT_CLUSTER_KUBE_VERSION } from '@shell/config/pagination-table-headers';
import { CAPI, MANAGEMENT, SAVED_COUNTS } from '@shell/config/types';
import { NAME as MANAGER } from '@shell/config/product/manager';
import { MODE, _IMPORT } from '@shell/config/query-params';
import { BLANK_CLUSTER } from '@shell/store/store-types.js';
import { parseSi, formatSi, createMemoryFormat } from '@shell/utils/units';
import ManagementClusterUtils from '@shell/list/utils/management.cattle.io.cluster.utils';
import { isConfigurableTablesEnabled } from '@shell/utils/table-views/feature';
import { clusterPinnedQueryFields } from '@shell/utils/table-views/query-fields';
import type MgmtCluster from '@shell/models/management.cattle.io.cluster';
import type { PaginationArgs } from '@shell/types/store/pagination.types';
import type { PagTableFetchPageSecondaryResourcesOpts, PagTableFetchSecondaryResourcesOpts } from '@shell/types/components/paginatedResourceTable';
import type { WidgetSpec } from '../../templating/types';

// HOME CLUSTER TABLE — the stock Home's cluster section, exactly.
//
// This is NOT the configurable Table building block pointed at clusters. It is the real thing from
// shell/pages/home.vue: the "Clusters" heading, the Manage / Import Existing / Create buttons, and
// the same table — headers State / Name / Badge / Provider·Distro / Version·Architecture / CPU / Memory /
// Pods, the name linking into the cluster.
//
// Nothing about it is configurable but the heading. Its columns, its sorting and its buttons belong
// to the Home, and reproducing them through the generic Table's column pickers would be a worse
// copy of something we can simply use.
//
// With Rancher's table views on, it is the Home's table views list: the query box, the View menu and
// the Home's own saved views (`table-views-page="home"`), shared with the stock Home's cluster list,
// and the Home's buttons in their order for it. The table is the shell's copy built into the package,
// which the shell keeps as written unless it asks, so it asks.
//
// It PAGES, through the stock Home's own paginated path, built from the shell's pieces rather than
// copies of them:
//
//   schema                  MANAGEMENT.CLUSTER, not the provisioning type. The paginated backend
//                           answers for mgmt clusters, and the rows carry what these columns read.
//                           The provisioning schema stays, but only to decide whether the Manage
//                           and Create buttons appear — which is a permission question.
//   paginationHeaders       the STEVE_* columns. A server-side sort needs the real field path
//                           (`spec.displayName`), which the client-side headers do not carry.
//   context 'home'          what turns server-side paging ON for this type. The store's defaults
//                           allow it for a short list of types in a named context, and this is that
//                           context. Without it the table asks for every row (pagesize=100000).
//   api-filter              pushes the search into the REQUEST. Filtering a page of ten would
//                           otherwise search ten rows and call the rest absent.
//   *SecondaryResources     CPU, memory and pods are not on the cluster row; they are fetched for
//                           the page that is actually on screen, and forgotten on the way out.

// The management cluster fields this table reads.
interface MgmtClusterRow {
  status?: { allocatable?: { cpu?: string; memory?: string } };
}

const props = defineProps<{ widget: WidgetSpec }>();

const store = useStore();
const { t } = useI18n(store);

// The context the pagination settings are keyed on. Sharing the stock Home's is deliberate: it is the
// same list of the same type on the same page, so it should page by the same rules.
const paginationContext = 'home';
const provClusterSchema = store.getters['management/schemaFor'](CAPI.RANCHER_CLUSTER);
const mgmtClusterSchema = store.getters['management/schemaFor'](MANAGEMENT.CLUSTER);

const title = computed(() => props.widget.title || t('landing.clusters.title'));

// Rancher's table views, as the Home reads the switch: they change the buttons and the heading too.
const configurableTables = isConfigurableTablesEnabled(store);

// The count beside the heading, as the Home shows it: the count the store has kept, else the total
// of the page the table last asked for.
const clusterCount = ref(0);
const clusterCountDisplay = computed<number>(() => {
  const saved = store.getters['management/getSavedCount'](SAVED_COUNTS.K8S_CLUSTERS);

  return typeof saved !== 'undefined' ? saved : clusterCount.value;
});

// Same create/manage/import targets as the stock Home header buttons.
const manageLocation = {
  name:   'c-cluster-product-resource',
  params: {
    product: MANAGER, cluster: BLANK_CLUSTER, resource: CAPI.RANCHER_CLUSTER
  },
};
const createLocation = {
  name:   'c-cluster-product-resource-create',
  params: {
    product: MANAGER, cluster: BLANK_CLUSTER, resource: CAPI.RANCHER_CLUSTER
  },
};
const importLocation = { ...createLocation, query: { [MODE]: _IMPORT } };

const canCreateCluster = !!provClusterSchema?.collectionMethods?.find((x: string) => x.toLowerCase() === 'post');

// The Home's buttons, in its order: with table views, Create and Import Existing first and Manage the
// primary one; without, Manage first and the other two primary.
const clusterActions = computed(() => {
  const create = {
    key: 'create', to: createLocation, label: t('generic.create'), shown: canCreateCluster
  };
  const importExisting = {
    key: 'import', to: importLocation, label: t('cluster.importAction'), shown: canCreateCluster
  };
  const manage = {
    key: 'manage', to: manageLocation, label: t('cluster.manageAction'), shown: !!provClusterSchema
  };
  const ordered = configurableTables ? [create, importExisting, manage] : [manage, importExisting, create];
  const variants: Record<string, ButtonVariant> = configurableTables ? {
    create: 'secondary', import: 'secondary', manage: 'primary'
  } : {
    manage: 'secondary', import: 'primary', create: 'primary'
  };

  return ordered.filter((action) => action.shown).map((action) => ({ ...action, variant: variants[action.key] }));
});

// `pinned:true` / `pinned:false` in the query box: the rows are management clusters, as the pins are.
const pinnedQueryFields = computed(() => clusterPinnedQueryFields(store, t, {
  idPath: 'id', serverPath: 'metadata.name', total: clusterCountDisplay.value
}));

const cpuHeader = {
  label: t('tableHeaders.cpu'), value: '', name: 'cpu', sort: ['status.allocatable.cpuRaw'], search: ['status.allocatable.cpuRaw']
};
const memoryHeader = {
  label: t('tableHeaders.memory'), value: '', name: 'memory', sort: ['status.allocatable.memoryRaw'], search: ['status.allocatable.memoryRaw']
};
const podsHeader = {
  label:        t('tableHeaders.pods'),
  name:         'pods',
  value:        '',
  sort:         ['status.allocatable.pods', 'status.requested.pods'],
  search:       ['status.allocatable.pods', 'status.requested.pods'],
  // Pods come with the page's secondary resources, so the column waits rather than showing a dash it
  // would have to take back.
  formatter:    'PodsUsage',
  delayLoading: true,
};

// What the table draws when it is paging CLIENT-side — the fallback the shell keeps for a backend
// that cannot page this type.
const headers = [
  STATE,
  {
    name: 'name', labelKey: 'tableHeaders.name', value: 'nameDisplay', sort: ['nameSort'], canBeVariable: true
  },
  CLUSTER_BADGE,
  {
    ...MGMT_CLUSTER_PROVIDER, labelKey: 'landing.clusters.provider', subLabel: t('landing.clusters.distro')
  },
  {
    ...MGMT_CLUSTER_KUBE_VERSION, labelKey: 'landing.clusters.kubernetesVersion', subLabel: t('landing.clusters.architecture')
  },
  cpuHeader,
  memoryHeader,
  podsHeader,
];

// The same columns for the SERVER-side path. They differ in one thing that matters: what they sort
// and search on is a field the API knows, so it can do both.
const paginationHeaders = [
  STEVE_MGMT_STATE_COL,
  {
    ...STEVE_NAME_COL, canBeVariable: true, value: 'spec.displayName', sort: ['spec.displayName'], search: 'spec.displayName'
  },
  CLUSTER_BADGE,
  {
    ...STEVE_MGMT_CLUSTER_PROVIDER, labelKey: 'landing.clusters.provider', subLabel: t('landing.clusters.distro')
  },
  {
    ...STEVE_MGMT_CLUSTER_KUBE_VERSION, labelKey: 'landing.clusters.kubernetesVersion', subLabel: t('landing.clusters.architecture')
  },
  cpuHeader,
  memoryHeader,
  podsHeader,
];

const filterRowsLocal = (rows: MgmtCluster[]) => ManagementClusterUtils.filterRowsLocal(rows, { $store: store });
const filterRowsApi = (pagination: PaginationArgs) => ManagementClusterUtils.filterRowsApi(pagination, { $store: store });

// For the bar in the Machines column, which only table views has. Not awaited, as on the Home: the
// column shows a count until they land.
function fetchMachineStates(): void {
  if (!configurableTables) {
    return;
  }
  if (store.getters['management/canList'](CAPI.MACHINE_DEPLOYMENT)) {
    store.dispatch('management/findAll', { type: CAPI.MACHINE_DEPLOYMENT });
  }
  if (store.getters['management/canList'](MANAGEMENT.NODE_POOL)) {
    store.dispatch('management/findAll', { type: MANAGEMENT.NODE_POOL });
  }
}

function fetchSecondaryResources(opts: PagTableFetchSecondaryResourcesOpts) {
  const promises = ManagementClusterUtils.fetchSecondaryResources(opts, { $store: store });

  fetchMachineStates();

  return Promise.all(promises);
}

async function fetchPageSecondaryResources(opts: PagTableFetchPageSecondaryResourcesOpts): Promise<void> {
  clusterCount.value = !opts.canPaginate || !opts.page?.length ? 0 : opts.pagResult.count;

  const promises = await ManagementClusterUtils.fetchPageSecondaryResources(opts, { $store: store });

  fetchMachineStates();

  await Promise.all(promises);
}

function cpuAllocatable(cluster: MgmtClusterRow): number {
  return parseSi(cluster?.status?.allocatable?.cpu || '');
}

function memoryAllocatable(cluster: MgmtClusterRow): string {
  const parsed = (parseSi(cluster?.status?.allocatable?.memory || '') || 0).toString();

  return formatSi(parsed, createMemoryFormat(parsed));
}

// The secondary resources are fetched per page and cached against this context. A widget that goes
// away without saying so leaves them behind for a page that no longer exists.
onBeforeUnmount(() => ManagementClusterUtils.forgetSecondaryResources({ context: paginationContext }, { $store: store }));
</script>

<template>
  <PaginatedResourceTable
    v-if="mgmtClusterSchema"
    :schema="mgmtClusterSchema"
    :class="{ 'configurable-tables': configurableTables }"
    :table-views="true"
    table-views-page="home"
    :query-fields="pinnedQueryFields"
    override-in-store="management"
    :headers="headers"
    :pagination-headers="paginationHeaders"
    :context="paginationContext"
    :local-filter="filterRowsLocal"
    :api-filter="filterRowsApi"
    :fetch-secondary-resources="fetchSecondaryResources"
    :fetch-page-secondary-resources="fetchPageSecondaryResources"
    :table-actions="false"
    :row-actions="false"
    :namespaced="false"
    :groupable="false"
    key-field="id"
    manual-refresh-button-size="sm"
  >
    <template #header-left>
      <div class="row table-heading">
        <h1 class="mb-0">
          {{ title }}
        </h1>
        <BadgeState
          v-if="clusterCountDisplay && !configurableTables"
          :label="clusterCountDisplay.toString()"
          color="bg-info ml-20 mr-20"
        />
      </div>
    </template>

    <template
      v-if="canCreateCluster || !!provClusterSchema"
      #header-middle
    >
      <div :class="['table-heading', { 'cluster-actions': configurableTables }]">
        <RcButton
          v-for="action in clusterActions"
          :key="action.key"
          :variant="action.variant"
          :to="action.to"
          :aria-label="action.label"
        >
          {{ action.label }}
        </RcButton>
      </div>
    </template>

    <template #col:name="{ row }">
      <td class="col-name">
        <div class="list-cluster-name">
          <p
            v-if="row"
            class="cluster-name"
          >
            <router-link
              v-if="row.canExplore"
              :to="{ name: 'c-cluster-explorer', params: { cluster: row.id } }"
              role="link"
              :aria-label="row.nameDisplay"
            >
              {{ row.nameDisplay }}
            </router-link>
            <span v-else>{{ row.nameDisplay }}</span>
            <i
              v-if="row.unavailableMachines"
              v-clean-tooltip="row.unavailableMachines"
              class="conditions-alert-icon icon-alert icon"
            />
            <ClusterRowPin :cluster="row" />
          </p>
          <p
            v-if="row.description"
            class="cluster-description"
          >
            {{ row.description }}
          </p>
        </div>
      </td>
    </template>

    <template #col:cpu="{ row }">
      <td v-if="cpuAllocatable(row)">
        {{ `${ cpuAllocatable(row) } ${ t('landing.clusters.cores', { count: cpuAllocatable(row) }) }` }}
      </td>
      <td v-else>
        &mdash;
      </td>
    </template>

    <template #col:memory="{ row }">
      <td v-if="memoryAllocatable(row) && !memoryAllocatable(row).match(/^0 [a-zA-z]/)">
        {{ memoryAllocatable(row) }}
      </td>
      <td v-else>
        &mdash;
      </td>
    </template>
  </PaginatedResourceTable>
</template>

<style lang="scss" scoped>
// The Home's name cell (scoped to shell/pages/home.vue, so copied): the name truncates, the
// description is muted, and the status icon and the pin keep 8px from the name.
.col-name {
  max-width: 280px;
}

.list-cluster-name {
  .cluster-name {
    align-items: center;
    display:     flex;

    > a, > span {
      overflow:      hidden;
      text-overflow: ellipsis;
    }
  }

  .cluster-description {
    color:         var(--muted);
    overflow:      hidden;
    text-overflow: ellipsis;
    white-space:   nowrap;
  }

  .conditions-alert-icon {
    color:       var(--error);
    margin-left: 8px;
  }
}

.table-heading {
  align-items: center;
  display:     flex;
  gap:         10px;
}

// The Home's heading row: 39px tall, the count sitting beside the title; 32px with table views.
.row.table-heading {
  gap:    0;
  height: 39px;
}

.configurable-tables .table-heading {
  height: 32px;
}

// With table views the buttons sit at the end, 16px apart.
.cluster-actions {
  gap:             16px;
  justify-content: flex-end;
}
</style>
