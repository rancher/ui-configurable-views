<script setup lang="ts">
import StockHome from '@shell/pages/home.vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import ConfigurablePage from '../components/ConfigurablePage.vue';
import { PAGE_HOME } from '../templating/template-engine';
import { stockPage } from '../templating/stock-pages';

// The Home, as a configurable page: its views, with Rancher's own Home kept as one of them - as the
// running Rancher has it, and the shell's copy this package was built with only when that was not kept.
const store = useStore();
const { t } = useI18n(store);
const stock = stockPage('home', StockHome);
</script>

<template>
  <ConfigurablePage
    :page="PAGE_HOME"
    :stock="stock"
    :title="t('nav.home')"
    layout="home"
    :first-view-name="t('configurableViews.pages.home.firstView')"
  />
</template>
