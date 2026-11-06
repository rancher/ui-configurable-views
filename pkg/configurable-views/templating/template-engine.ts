// Where the configurable pages are STORED.
//
// What a person keeps for themselves - their own views, and whether the pages are on - is in their
// user preferences (see user-prefs).
//
// The views published for everyone are in one labeled ConfigMap in the local cluster's `default`
// namespace, read and written through the management store (Steve `/v1/`):
//
//   templating-home    one key per PAGE, each holding the views published for that page:
//                        data.home              the Home
//                        data.clusterDashboard  the cluster dashboard - one set of views for every
//                                               cluster, whose widgets follow the cluster they are on
//                      each shaped { global: <View> }
//
// Someone who cannot read that ConfigMap does not see published views. It is a prototype's storage,
// until they move to a CRD.

import type { VuexStore } from '@shell/types/store/vuex';
import { CONFIG_MAP } from '@shell/config/types';
import { PREF_ENABLED, PREF_VIEWS, definePrefs, savePref } from './user-prefs';
import { migratePageViews } from './view-model';
import type { PageViews } from './types';

type Getters = VuexStore['getters'];

const NAMESPACE = 'default';

// Every stored ConfigMap carries the marker; the type label tells them apart.
// The marker keeps its old name on purpose. It is ON the stored ConfigMaps, so renaming it orphans them.
const LABEL_MARKER = 'templates.rancher.io/ai-templating';
const LABEL_TYPE = 'templates.rancher.io/type';
const TYPE_CONFIG = 'config';

const HOME_CONFIG_NAME = 'templating-home';

const configLabels = { [LABEL_MARKER]: 'true', [LABEL_TYPE]: TYPE_CONFIG };

// The pages that can be configured, by the key their views are stored under.
export const PAGE_HOME = 'home';
export const PAGE_CLUSTER_DASHBOARD = 'clusterDashboard';

/** A page that can be configured. */
export type PageKey = typeof PAGE_HOME | typeof PAGE_CLUSTER_DASHBOARD;

// This package's product and its pages. The name has no dashes: the Product API takes them out of a
// product's name, so its routes do not read as nested route names.
export const PRODUCT_NAME = 'configurableviews';
export const PAGE_SETTINGS = 'settings';
export const PAGE_VIEWS = 'views';

/** A ConfigMap as the management store hands it back: its fields, and `save`. */
interface ConfigMapModel {
  metadata: { name: string; labels?: Record<string, string> };
  data?: Record<string, string>;
  save(): Promise<unknown>;
}

/** What one page's key of `templating-home` holds, parsed. Views stay `unknown` until migratePageViews has checked them. */
export interface PageConfig {
  global?: unknown;
}

/** The saved views as one user sees them. */
export interface ViewScopes {
  /** The organization's view, as stored (disabled or not) - what an editor edits. */
  global: PageViews | null;
  /** This user's own view, as stored. */
  user: PageViews | null;
  /** What actually renders: the user's if enabled, else the organization's if enabled, else none. */
  resolved: PageViews | null;
  hasGlobal: boolean;
  hasUser: boolean;
}

// ---- reading ----------------------------------------------------------------------------------------

function parse(json: string | undefined): PageConfig {
  if (!json) {
    return {};
  }
  try {
    const out = JSON.parse(json);

    return out && typeof out === 'object' ? out : {};
  } catch (e) {
    return {};
  }
}

function cmNamed(getters: Getters, name: string): ConfigMapModel | undefined {
  return getters['management/byId']?.(CONFIG_MAP, `${ NAMESPACE }/${ name }`) ||
    (getters['management/all']?.(CONFIG_MAP) || []).find((cm: ConfigMapModel) => cm.metadata?.name === name && cm.metadata?.labels?.[LABEL_MARKER] === 'true');
}

/**
 * Load this package's ConfigMaps into the management store - and only those.
 *
 * Through the shell's label-selector read, which filters on the SERVER. The query this replaced put
 * `?labelSelector=` on `/v1/configmaps`, which Steve ignores: it returned every ConfigMap in the
 * cluster, 349 of them and 7 MB on the development server, on every visit to the Home, to find 7.
 *
 * Never rejects: a failed read leaves the store as it was, and the Home shows what it last had.
 */
export async function fetchTemplatingConfigMaps(store: VuexStore): Promise<void> {
  if (!store.getters['management/schemaFor'](CONFIG_MAP)) {
    return;
  }

  await store.dispatch('management/findLabelSelector', {
    type:     CONFIG_MAP,
    matching: { namespace: NAMESPACE, labelSelector: { matchLabels: { [LABEL_MARKER]: 'true' } } },
    opt:      { force: true },
  }).catch(() => undefined);
}

function pageConfig(getters: Getters, page: PageKey): PageConfig {
  return parse(cmNamed(getters, HOME_CONFIG_NAME)?.data?.[page]);
}

/** A page's raw published config ({ global }) - for the Configurable Views page's YAML editor. */
export function getPageConfig(getters: Getters, page: PageKey = PAGE_HOME): PageConfig {
  return pageConfig(getters, page);
}

/**
 * The saved views split by scope, and the one THIS user sees: their own overrides the
 * organization's, and a disabled view is skipped so the scope beneath it shows. Old stored shapes
 * are migrated on read (see migratePageViews).
 */
export function appliedViewScopes(getters: Getters, page: PageKey = PAGE_HOME): ViewScopes {
  const rawGlobal = pageConfig(getters, page).global || null;
  const rawUser = getters['prefs/get'](PREF_VIEWS)?.[page] || null;

  const global = rawGlobal ? migratePageViews(rawGlobal) : null;
  const user = rawUser ? migratePageViews(rawUser) : null;
  const userApplied = user && !user.disabled ? user : null;
  const globalApplied = global && !global.disabled ? global : null;

  return {
    global,
    user,
    resolved:  userApplied || globalApplied,
    hasGlobal: !!rawGlobal,
    hasUser:   !!rawUser,
  };
}

// ---- the on/off switch ------------------------------------------------------------------------------

/** Each person's own: on, until they turn it off. */
export function isTemplatingEnabled(getters: Getters): boolean {
  return getters['prefs/get'](PREF_ENABLED) !== false;
}

/** The URL's own switch: `?confviews=false`. */
export const VIEWS_QUERY = 'confviews';

/**
 * Whether the URL turns the configurable pages off: `?confviews=false` shows Rancher's own page, as
 * the switch does, but only for as long as it is in the URL - nothing is stored, and the switch itself
 * is not touched.
 */
export function viewsOffInUrl(query: Record<string, unknown> | null | undefined): boolean {
  const value = query?.[VIEWS_QUERY];

  return (Array.isArray(value) ? value[0] : value) === 'false';
}

/**
 * Set this person's switch - or flip it, with no argument. Resolves to the new state. Its shortcut works
 * on any page, so it may be the first thing here to touch the preferences.
 */
export async function toggleTemplating(store: VuexStore, enabled?: boolean): Promise<boolean> {
  definePrefs(store);

  const desired = typeof enabled === 'boolean' ? enabled : !isTemplatingEnabled(store.getters);

  await savePref(store, PREF_ENABLED, desired);

  return desired;
}

// ---- writing ------------------------------------------------------------------------------------------

/**
 * Write one page's whole published config to `templating-home`, creating it if needed. Each page is
 * its own key, and the other pages' keys are written back as they were.
 */
async function persistPage(store: VuexStore, page: PageKey, config: PageConfig): Promise<void> {
  const existing = cmNamed(store.getters, HOME_CONFIG_NAME);

  if (existing && existing.metadata.labels?.[LABEL_TYPE] === TYPE_CONFIG) {
    existing.data = { ...(existing.data || {}), [page]: JSON.stringify(config) };
    await existing.save();
  } else {
    const cm: ConfigMapModel = await store.dispatch('management/create', {
      type:     CONFIG_MAP,
      metadata: {
        name: HOME_CONFIG_NAME, namespace: NAMESPACE, labels: configLabels
      },
      data: { [page]: JSON.stringify(config) },
    });

    await cm.save();
  }
}

/** Write a page's raw published config - from the Configurable Views page's YAML editor. */
export async function savePageConfig(store: VuexStore, config: PageConfig | null, page: PageKey = PAGE_HOME): Promise<void> {
  await persistPage(store, page, config || {});
}

/** Save one scope's view of a page. `null` clears that scope. */
export async function saveView(store: VuexStore, scope: 'global' | 'user', view: PageViews | null, page: PageKey = PAGE_HOME): Promise<void> {
  if (scope === 'user') {
    const saved = store.getters['prefs/get'](PREF_VIEWS);

    if (view) {
      saved[page] = JSON.parse(JSON.stringify(view));
    } else {
      delete saved[page];
    }

    await savePref(store, PREF_VIEWS, saved);

    return;
  }

  const home = pageConfig(store.getters, page);

  if (view) {
    home.global = view;
  } else {
    delete home.global;
  }

  await persistPage(store, page, home);
}
