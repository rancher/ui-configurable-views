<script setup lang="ts">
import StockClusterDashboard from '@shell/pages/c/_cluster/explorer/index.vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import ConfigurablePage from '../components/ConfigurablePage.vue';
import { PAGE_CLUSTER_DASHBOARD } from '../templating/template-engine';
import { stockPage } from '../templating/stock-pages';

// A cluster's dashboard, as a configurable page: its views, with Rancher's own dashboard kept as
// one of them - as the running Rancher has it, and the shell's copy this package was built with only
// when that was not kept.
//
// One set of views serves every cluster. A widget on them that names no cluster of its own follows
// the page's (see useWidgetCluster), so the same view shows each cluster on its own dashboard.
const store = useStore();
const { t } = useI18n(store);
const stock = stockPage('c-cluster-explorer', StockClusterDashboard);
</script>

<template>
  <ConfigurablePage
    :page="PAGE_CLUSTER_DASHBOARD"
    :stock="stock"
    :title="t('clusterIndexPage.header')"
    layout="default"
    :first-view-name="t('configurableViews.pages.clusterDashboard.firstView')"
  />
</template>
