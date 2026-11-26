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
//
// Liz writes what she builds into ConfigMaps of their own, beside it: a view each (see generatedViews),
// and a widget each (see generatedWidgets), whose code runs once an admin approves it. The approvals
// are kept in a Rancher setting, which only admins can write (see APPROVALS_SETTING).

import type { VuexStore } from '@shell/types/store/vuex';
import { CONFIG_MAP, MANAGEMENT } from '@shell/config/types';
import { PREF_ENABLED, PREF_VIEWS, definePrefs, savePref } from './user-prefs';
import { migratePageViews } from './view-model';
import type { PageViews, View } from './types';

type Getters = VuexStore['getters'];

const NAMESPACE = 'default';

// Every stored ConfigMap carries the marker; the type label tells them apart.
// The marker keeps its old name on purpose. It is ON the stored ConfigMaps, so renaming it orphans them.
const LABEL_MARKER = 'templates.rancher.io/ai-templating';
const LABEL_TYPE = 'templates.rancher.io/type';
const TYPE_CONFIG = 'config';
/** A view in a ConfigMap of its own - what Liz writes when asked to build a page (see generatedViews). */
const TYPE_VIEW = 'view';
/** A view Liz proposed, waiting for someone who may publish it (see generatedDrafts). */
const TYPE_DRAFT = 'view-draft';
/** A widget Liz wrote the code of - a new kind of widget (see generatedWidgets). */
const TYPE_WIDGET = 'widget';

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
  /** Whether the person signed in may change it - from the links Rancher sends with it. */
  canUpdate?: boolean;
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
  /**
   * Views in ConfigMaps of their own, built by Liz: published to everyone, beside the organization's
   * own (see generatedViews). Never part of `global`, so nothing written back to it copies them.
   */
  generated: View[];
  /** Views Liz proposed, for those who may publish them (see generatedDrafts). */
  drafts: View[];
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

  // Not forced: once read they are watched, so what the store has is current, and the package's own
  // writes land in it through the models they save. A read that failed is read again next time.
  await store.dispatch('management/findLabelSelector', {
    type:     CONFIG_MAP,
    matching: { namespace: NAMESPACE, labelSelector: { matchLabels: { [LABEL_MARKER]: 'true' } } },
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
    generated: generatedViews(getters, page),
    drafts:    generatedDrafts(getters, page),
  };
}

// ---- views built by Liz ---------------------------------------------------------------------------

/** The id a view in a ConfigMap of its own has: the ConfigMap's name, so it is stable and says where it is. */
export const GENERATED_VIEW_PREFIX = 'cm:';

export const isGeneratedView = (id: string | null | undefined): boolean => !!id?.startsWith(GENERATED_VIEW_PREFIX);

/**
 * The views in ConfigMaps of their own, for one page - what Liz writes when asked to build a page.
 *
 * One small ConfigMap per view (labels: the marker, and type `view`; data: `page` and `view`, the
 * view as JSON), rather than an edit of templating-home: an agent creates a resource, which is one
 * tool call it gets right, instead of rewriting one large JSON string everyone's views live in. Each
 * is normalized exactly as a stored view is, and shown as published - removing it from everyone
 * deletes its ConfigMap (see deleteGeneratedView).
 */
function viewMaps(getters: Getters, page: PageKey, type = TYPE_VIEW): ConfigMapModel[] {
  return (getters['management/all']?.(CONFIG_MAP) || [])
    .filter((cm: ConfigMapModel & { metadata: { namespace?: string } }) => cm.metadata?.labels?.[LABEL_MARKER] === 'true' &&
      cm.metadata?.labels?.[LABEL_TYPE] === type && (!cm.metadata.namespace || cm.metadata.namespace === NAMESPACE) &&
      (cm.data?.page || PAGE_HOME) === page);
}

/** A ConfigMap's view, read as a stored view is, under the id given */
function viewOf(cm: ConfigMapModel, id: string): View | null {
  const raw = parse(cm.data?.view) as Record<string, unknown>;
  const [view] = migratePageViews({
    views: [{
      ...raw, id, widgets: withStableIds(raw.widgets, id)
    }]
  }).views;

  return view || null;
}

export function generatedViews(getters: Getters, page: PageKey = PAGE_HOME): View[] {
  return viewMaps(getters, page)
    .flatMap((cm) => {
      const view = viewOf(cm, `${ GENERATED_VIEW_PREFIX }${ cm.metadata.name }`);

      return view ? [view] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- views Liz proposed ---------------------------------------------------------------------------

/** The id of a view Liz proposed: its ConfigMap's name, as for her published views. */
export const DRAFT_VIEW_PREFIX = 'draft:';

export const isDraftView = (id: string | null | undefined): boolean => !!id?.startsWith(DRAFT_VIEW_PREFIX);

/**
 * What Liz proposed for a page, before anyone has approved it: ConfigMaps of type `view-draft`, each a
 * view as her published ones are, and, for a change to one of them, `data.replaces` - the name of its
 * ConfigMap. Shown only to those who may change the draft's ConfigMap, who are the ones who may
 * publish a view; anyone else never sees one.
 *
 * Approving a new view makes the draft a published view where it is (see approveDraft); approving a
 * change writes it into the view it replaces. Discarding deletes the draft.
 */
export function generatedDrafts(getters: Getters, page: PageKey = PAGE_HOME): View[] {
  return viewMaps(getters, page, TYPE_DRAFT)
    .filter((cm) => cm.canUpdate !== false)
    .flatMap((cm) => {
      const view = viewOf(cm, `${ DRAFT_VIEW_PREFIX }${ cm.metadata.name }`);
      const replaces = cm.data?.replaces || '';

      return view ? [{ ...view, draft: replaces ? { replaces, replacesName: viewNamed(getters, replaces) } : {} }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The name of the published view in a ConfigMap of Liz's - what a change to it is shown against */
function viewNamed(getters: Getters, cmName: string): string {
  const cm = cmNamed(getters, cmName);

  if (!cm || cm.metadata.labels?.[LABEL_TYPE] !== TYPE_VIEW) {
    return '';
  }

  return viewOf(cm, cmName)?.name || cmName;
}

/** Why a draft could not be approved: it is gone, or the view it changes is. */
export class DraftError extends Error {
  constructor(public readonly reason: 'gone' | 'targetGone') {
    super(reason);
  }
}

/**
 * Publish what Liz proposed. A new view: its ConfigMap becomes a published view, as one written by Liz
 * before drafts. A change: the view it replaces takes the draft's, and the draft goes. Resolves to the
 * id of the published view, to open it.
 */
export async function approveDraft(store: VuexStore, id: string): Promise<string> {
  const name = id.slice(DRAFT_VIEW_PREFIX.length);
  const draft = cmNamed(store.getters, name) as (ConfigMapModel & { remove(): Promise<unknown> }) | undefined;

  if (!draft || draft.metadata.labels?.[LABEL_TYPE] !== TYPE_DRAFT) {
    throw new DraftError('gone');
  }

  const replaces = draft.data?.replaces;

  if (replaces) {
    const target = cmNamed(store.getters, replaces);

    if (!target || target.metadata.labels?.[LABEL_TYPE] !== TYPE_VIEW) {
      throw new DraftError('targetGone');
    }

    // On a copy, so a write that fails leaves the published view - and the draft - as they were
    const copy: ConfigMapModel = await store.dispatch('management/clone', { resource: target });

    copy.data = { ...(copy.data || {}), view: draft.data?.view || '' };
    await copy.save();
    await draft.remove();

    return `${ GENERATED_VIEW_PREFIX }${ replaces }`;
  }

  const copy: ConfigMapModel = await store.dispatch('management/clone', { resource: draft });

  copy.metadata.labels = { ...(copy.metadata.labels || {}), [LABEL_TYPE]: TYPE_VIEW };
  await copy.save();

  return `${ GENERATED_VIEW_PREFIX }${ name }`;
}

/** Throw away what Liz proposed: its ConfigMap goes. */
export async function discardDraft(store: VuexStore, id: string): Promise<void> {
  const draft = cmNamed(store.getters, id.slice(DRAFT_VIEW_PREFIX.length)) as (ConfigMapModel & { remove(): Promise<unknown> }) | undefined;

  if (draft && draft.metadata.labels?.[LABEL_TYPE] === TYPE_DRAFT) {
    await draft.remove();
  }
}

/**
 * Ids for the widgets of a view in a ConfigMap of its own, where they have none - Liz and the examples
 * leave them out. Made from the view and the widget's place, so they are the same every time the view
 * is read: a new id each read would make the page take them for new widgets and draw them all again,
 * every time the stored views are read - which is whenever any of this package's ConfigMaps changes.
 */
function withStableIds(widgets: unknown, prefix: string): unknown {
  if (!Array.isArray(widgets)) {
    return widgets;
  }

  return widgets.map((node, i) => {
    if (!node || typeof node !== 'object') {
      return node;
    }

    const n = node as Record<string, unknown>;
    const nodeId = typeof n.id === 'string' && n.id ? n.id : `${ prefix }-w${ i }`;
    const widget = n.widget && typeof n.widget === 'object' ? n.widget as Record<string, unknown> : null;

    // A Tabs widget's tabs, and the widgets in them, get theirs the same way
    const tabs = Array.isArray(widget?.tabs) ? (widget?.tabs as Record<string, unknown>[]).map((tab, t) => ({
      ...tab,
      id:      typeof tab?.id === 'string' && tab.id ? tab.id : `${ nodeId }-t${ t }`,
      widgets: withStableIds(tab?.widgets, `${ nodeId }-t${ t }`),
    })) : undefined;

    return {
      ...n, id: nodeId, ...(widget && tabs ? { widget: { ...widget, tabs } } : {})
    };
  });
}

/** Take a view Liz built away from everyone: its ConfigMap goes. */
export async function deleteGeneratedView(store: VuexStore, id: string): Promise<void> {
  const cm = cmNamed(store.getters, id.slice(GENERATED_VIEW_PREFIX.length)) as (ConfigMapModel & { remove(): Promise<unknown> }) | undefined;

  if (cm) {
    await cm.remove();
  }
}

// ---- other widgets: code, by Liz or an admin ----------------------------------------------------

/** A widget whose code Liz wrote, from a ConfigMap of its own. */
export interface GeneratedWidget {
  /** The ConfigMap's name - what a view's widget names it by. */
  name: string;
  displayName: string;
  description: string;
  /** The widget, as a Vue single-file component. */
  source: string;
  created: string;
  /** When it last changed, by Liz or by hand: the latest write Kubernetes recorded, else when it was created. */
  updated: string;
}

/** The time of the latest write Kubernetes recorded for an object, if it kept any. */
function lastWrite(metadata: { managedFields?: { time?: string }[] }): string {
  return (metadata.managedFields || []).map((f) => f.time || '').filter(Boolean).sort().pop() || '';
}

/**
 * The widgets Liz wrote: ConfigMaps labelled type `widget`, each with `displayName`, `description` and
 * `component` (a Vue single-file component). Their code only runs once an admin approves it (see
 * widgetApprovals).
 */
export function generatedWidgets(getters: Getters): GeneratedWidget[] {
  return (getters['management/all']?.(CONFIG_MAP) || [])
    .filter((cm: ConfigMapModel & { metadata: { namespace?: string } }) => cm.metadata?.labels?.[LABEL_MARKER] === 'true' &&
      cm.metadata?.labels?.[LABEL_TYPE] === TYPE_WIDGET && (!cm.metadata.namespace || cm.metadata.namespace === NAMESPACE))
    .map((cm: ConfigMapModel & { metadata: { creationTimestamp?: string, managedFields?: { time?: string }[] } }) => ({
      name:        cm.metadata.name,
      displayName: cm.data?.displayName || cm.metadata.name,
      description: cm.data?.description || '',
      source:      cm.data?.component || '',
      created:     cm.metadata.creationTimestamp || '',
      updated:     lastWrite(cm.metadata) || cm.metadata.creationTimestamp || '',
    }))
    .sort((a: GeneratedWidget, b: GeneratedWidget) => a.displayName.localeCompare(b.displayName));
}

/** An approval of a widget's code: exactly which code (the SHA-256 of its source), who approved it and when. */
export interface WidgetApproval {
  hash: string;
  /** The approver's username, or user id. */
  by: string;
  /** When, as an ISO date. */
  at: string;
}

/**
 * WHERE APPROVALS ARE KEPT: a Rancher setting, not a ConfigMap. Every signed-in user can read settings,
 * so every browser can check a widget's approval; only admins - and anyone given the right to manage
 * settings - can write them. A ConfigMap beside the widgets would not do: Rancher's default project-member
 * role can write ConfigMaps in the local cluster's Default project, where `default` is, and approved code
 * runs in Rancher for everyone who opens a page with it, with that person's access.
 *
 * Approvals kept in templating-config before this no longer count, for that reason: those widgets wait
 * to be approved again.
 */
export const APPROVALS_SETTING = 'ui-configurable-views-widget-approvals';

interface SettingModel {
  value?: string;
  canUpdate?: boolean;
  save(): Promise<unknown>;
}

const approvalsSetting = (getters: Getters): SettingModel | undefined => getters['management/byId']?.(MANAGEMENT.SETTING, APPROVALS_SETTING);

/**
 * Read the approvals again. The shell loads every setting when Rancher opens, without watching them, so
 * an approval made since - by another admin - shows once this is read. Never rejects: no setting yet
 * means nothing is approved.
 */
export async function fetchWidgetApprovals(store: VuexStore): Promise<void> {
  await store.dispatch('management/find', {
    type: MANAGEMENT.SETTING, id: APPROVALS_SETTING, opt: { force: true }
  }).catch(() => undefined);
}

/**
 * Which widgets' code was approved, and exactly which code: widget name -> its approval. A widget runs
 * only while its source still has the approved hash, so any change - by Liz or by hand - needs
 * approving again.
 */
export function widgetApprovals(getters: Getters): Record<string, WidgetApproval> {
  const parsed = parse(approvalsSetting(getters)?.value) as Record<string, unknown>;
  const out: Record<string, WidgetApproval> = {};
  const text = (v: unknown) => (typeof v === 'string' ? v : '');

  for (const [name, value] of Object.entries(parsed)) {
    const v = (value && typeof value === 'object' ? value : {}) as Partial<WidgetApproval>;

    if (text(v.hash)) {
      out[name] = {
        hash: text(v.hash), by: text(v.by), at: text(v.at)
      };
    }
  }

  return out;
}

/** Approve a widget's code - the source with this hash - as the person signed in, or revoke the approval (null). */
export async function setWidgetApproval(store: VuexStore, name: string, hash: string | null): Promise<void> {
  const approvals = { ...widgetApprovals(store.getters) };

  if (hash) {
    const user = store.getters['auth/user'] as { username?: string; id?: string } | null;

    approvals[name] = {
      hash, by: user?.username || user?.id || '', at: new Date().toISOString()
    };
  } else {
    delete approvals[name];
  }

  const value = JSON.stringify(approvals);
  const existing = approvalsSetting(store.getters);

  if (existing) {
    // Changed on a copy: a write that fails leaves the stored approvals - and what the page shows - as
    // they were, rather than showing an approval that was never saved
    const copy: SettingModel = await store.dispatch('management/clone', { resource: existing });

    copy.value = value;
    await copy.save();

    return;
  }

  const setting: SettingModel = await store.dispatch('management/create', {
    type: MANAGEMENT.SETTING, metadata: { name: APPROVALS_SETTING }, value
  });

  await setting.save();
}

/**
 * Whether the person signed in can approve widgets: change the approvals setting - or, before there is
 * one, create settings. The same RBAC the write itself meets, so nobody is offered buttons that can only
 * fail.
 */
export function canApproveWidgets(getters: Getters): boolean {
  const setting = approvalsSetting(getters);

  if (setting) {
    return !!setting.canUpdate;
  }

  const schema = getters['management/schemaFor']?.(MANAGEMENT.SETTING) as { collectionMethods?: string[] } | undefined;

  return !!schema?.collectionMethods?.some((method) => method.toUpperCase() === 'POST');
}

/** Remove a widget Liz wrote: its ConfigMap goes, and its approval with it. */
export async function deleteGeneratedWidget(store: VuexStore, name: string): Promise<void> {
  const cm = cmNamed(store.getters, name) as (ConfigMapModel & { remove(): Promise<unknown> }) | undefined;

  if (widgetApprovals(store.getters)[name]) {
    await setWidgetApproval(store, name, null);
  }
  if (cm) {
    await cm.remove();
  }
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
