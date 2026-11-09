import type { Component } from 'vue';
import {
  WIDGET_TABLE, WIDGET_LINKS, WIDGET_BANNER, WIDGET_CLUSTER_TABLE, WIDGET_OVERVIEW,
  WIDGET_CLUSTER_HEADER, WIDGET_RESOURCE_CARDS, WIDGET_CAPACITY, WIDGET_EVENTS, WIDGET_CERTIFICATES,
  WIDGET_COMPONENT_STATUS, WIDGET_TABS, WIDGET_ALERTS, WIDGET_METRICS, WIDGET_EXTENSION_CARDS, WIDGET_STATUS_CARDS,
  WIDGET_GENERATED
} from '../../templating/widget-catalog';
import WidgetTable from './WidgetTable.vue';
import WidgetLinks from './WidgetLinks.vue';
import WidgetBanner from './WidgetBanner.vue';
import WidgetClusterTable from './WidgetClusterTable.vue';
import WidgetOverview from './WidgetOverview.vue';
import WidgetClusterHeader from './WidgetClusterHeader.vue';
import WidgetResourceCards from './WidgetResourceCards.vue';
import WidgetCapacity from './WidgetCapacity.vue';
import WidgetEvents from './WidgetEvents.vue';
import WidgetCertificates from './WidgetCertificates.vue';
import WidgetComponentStatus from './WidgetComponentStatus.vue';
import WidgetTabs from './WidgetTabs.vue';
import WidgetAlerts from './WidgetAlerts.vue';
import WidgetMetrics from './WidgetMetrics.vue';
import WidgetExtensionCards from './WidgetExtensionCards.vue';
import WidgetStatusCards from './WidgetStatusCards.vue';
import WidgetGenerated from './WidgetGenerated.vue';
import TableSettings from './settings/TableSettings.vue';
import LinksSettings from './settings/LinksSettings.vue';
import BannerSettings from './settings/BannerSettings.vue';
import MetricsSettings from './settings/MetricsSettings.vue';
import TabsSettings from './settings/TabsSettings.vue';
import StatusCardsSettings from './settings/StatusCardsSettings.vue';

/** What a kind of widget brings with it: how it is drawn, and how it is set up. */
export interface WidgetDefinition {
  /** Draws it, handed its spec. */
  component: Component;
  /**
   * Sets up what only this kind has, under the title and the cluster in the settings dialog. Handed the
   * dialog's copy of the spec as `widget`, it emits `update` with what changed. Most kinds have nothing.
   */
  settings?: Component;
  /**
   * Whether the settings ask where it reads from: one cluster, or also Rancher's own API, which is what
   * makes `fromCluster` say which it is. A kind about nothing in particular has none.
   */
  source?: 'cluster' | 'rancherOrCluster';
  /** What else the host hands it: its own id on the grid, and the view's gap. */
  hostProps?: ('nodeId' | 'gap')[];
  /** A translation key: what the settings say about it, under the title. */
  settingsHintKey?: string;
  /** Its name is plural, which "what this <name> shows" does not suit. */
  pluralName?: boolean;
}

/** The only place a `kind` maps onto what it needs: a new widget is added here and to the catalog. */
export const WIDGETS: Record<string, WidgetDefinition> = {
  [WIDGET_TABLE]: {
    component: WidgetTable, settings: TableSettings, source: 'rancherOrCluster', hostProps: ['nodeId']
  },
  [WIDGET_LINKS]: {
    component: WidgetLinks, settings: LinksSettings, pluralName: true
  },
  [WIDGET_BANNER]:        { component: WidgetBanner, settings: BannerSettings },
  // The stock Home's own table: its columns, sorting and actions are fixed there.
  [WIDGET_CLUSTER_TABLE]: { component: WidgetClusterTable, settingsHintKey: 'configurableViews.widgetSettings.clusterTableHint' },
  [WIDGET_TABS]:          {
    component: WidgetTabs, settings: TabsSettings, hostProps: ['nodeId', 'gap'], pluralName: true
  },
  [WIDGET_OVERVIEW]:         { component: WidgetOverview, source: 'cluster' },
  [WIDGET_CLUSTER_HEADER]:   { component: WidgetClusterHeader, source: 'cluster' },
  [WIDGET_RESOURCE_CARDS]:   { component: WidgetResourceCards, source: 'cluster' },
  [WIDGET_CAPACITY]:         { component: WidgetCapacity, source: 'cluster' },
  [WIDGET_EVENTS]:           { component: WidgetEvents, source: 'cluster' },
  [WIDGET_CERTIFICATES]:     { component: WidgetCertificates, source: 'cluster' },
  [WIDGET_COMPONENT_STATUS]: { component: WidgetComponentStatus, source: 'cluster' },
  [WIDGET_ALERTS]:           { component: WidgetAlerts, source: 'cluster' },
  [WIDGET_METRICS]:          {
    component: WidgetMetrics, settings: MetricsSettings, source: 'cluster'
  },
  [WIDGET_EXTENSION_CARDS]: { component: WidgetExtensionCards, source: 'cluster' },
  [WIDGET_STATUS_CARDS]:    {
    component: WidgetStatusCards, settings: StatusCardsSettings, source: 'cluster', pluralName: true
  },
  // A widget Liz wrote: its code is approved by an admin first (see GeneratedWidgetsAdmin).
  [WIDGET_GENERATED]: { component: WidgetGenerated, source: 'cluster' },
};
