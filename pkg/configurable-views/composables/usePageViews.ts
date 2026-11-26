import { computed, ref, watch } from 'vue';
import type { VuexStore } from '@shell/types/store/vuex';
import { useRoute, useRouter } from 'vue-router';
import type { I18n } from '@shell/composables/useI18n';
import {
  isTemplatingEnabled, viewsOffInUrl, appliedViewScopes, saveView, fetchTemplatingConfigMaps, DRAFT_VIEW_PREFIX, GENERATED_VIEW_PREFIX, type PageKey
} from '../templating/template-engine';
import { definePrefs } from '../templating/user-prefs';
import {
  DEFAULT_GAP, newId, isStockView, builtInStockView, orderKeyOf, orderViews, storedForm
} from '../templating/view-model';
import type { SettingsAnchor } from './viewEditor';
import type { LayoutView, View, PageViews } from '../templating/types';


export const clone = <T, >(value: T): T => JSON.parse(JSON.stringify(value));

/** JSON with every object's keys in order: the same content reads the same however it was put together. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
}

/**
 * What a view shows, without what only says WHICH view it is (its id, the published view it was copied
 * from, whether it is the organization's) - so a copy and its source compare equal until one changes.
 * Read as storage reads it back, keys in order: the editor's own version of a view holds the same
 * content in another order, and with values storage rewrites.
 */
export function viewContent(view: View): string {
  const copy: Partial<View> = { ...storedForm(view) };

  delete copy.id;
  delete copy.from;
  delete copy.fromHash;
  delete copy.org;

  return canonical(copy);
}

/** A short fingerprint of what a view shows (FNV-1a over viewContent): what a copy keeps of its source. */
export function contentHash(view: View): string {
  const text = viewContent(view);
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Your copy of a published view, as it is made: remembering what that view showed. */
export function copyOf(view: View, id = newId('view')): View {
  const copy: View = {
    ...clone(view), id, from: view.id, fromHash: contentHash(view)
  };

  delete copy.org;

  return copy;
}

/**
 * Your stored views, with each copy of a published view that you have not changed following that view:
 * a copy still showing what the published view showed when it was made takes what it shows now, under
 * its own id - so a default, a place in the bar and an open tab stay put. A copy you changed stays
 * yours, and the page says when the published view changed under it (see outdatedIds).
 */
export function followPublished(set: PageViews | null, published: View[]): PageViews | null {
  if (!set) {
    return set;
  }

  const sources = new Map(published.map((p) => [p.id, p]));
  let followed = false;
  const views = set.views.map((view) => {
    const source = view.from ? sources.get(view.from) : undefined;

    if (!source || !view.fromHash || contentHash(source) === view.fromHash || contentHash(view) !== view.fromHash) {
      return view;
    }
    followed = true;

    return copyOf(source, view.id);
  });

  return followed ? { ...set, views } : set;
}

/**
 * A configurable page's VIEWS: what is stored, what the bar shows, and which one is open.
 *
 * The state every other part of the page reads - the editor, the bar's actions, the grid - lives here,
 * so each of those can be a composable of its own over the same views. Includes the editor's own
 * state (the draft, the selected widget, the drawer), because opening another view resets it.
 *
 * WHERE VIEWS LIVE. Your views are saved in YOUR user preferences; the ones an admin publishes live in
 * the organization's scope and appear in the same bar. Editing one of those does not change what everyone
 * else sees: it forks the view into your account first.
 */
export function usePageViews(props: { page: PageKey }, store: VuexStore, t: I18n['t']) {
  definePrefs(store);

  // ---- state ----

  const loaded = ref(false);
  const editing = ref(false);
  /** The draft: a working copy of YOUR views while editing. */
  const working = ref<PageViews | null>(null);
  /** JSON of the last SAVED state, for the dirty check. */
  const savedBaseline = ref<string | null>(null);
  const activeViewId = ref<string | null>(null);
  // True once the active view is a DELIBERATE choice (you clicked it, or an action moved you to it)
  // rather than the fallback taken while the config was still loading.
  const pinnedView = ref(false);
  const selectedNodeId = ref<string | null>(null);
  /** The view being created, while it has never been saved. */
  const newViewId = ref<string | null>(null);
  /** What a new view was started from, for the bar's "From …". */
  const startedFrom = ref('');
  /** The widget whose settings are open, and where it is on screen so they open beside it. */
  const settingsNodeId = ref<string | null>(null);
  const settingsAnchor = ref<SettingsAnchor | null>(null);
  const saving = ref(false);
  /** The editor's drawer. Closing it keeps you editing, with the whole width for the grid. */
  const drawerOpen = ref(true);
  const error = ref('');
  /**
   * What a view-mode action just wrote, shown until the stored copy catches up - so a dragged tab, a
   * rename or a delete lands at once rather than after the round trip.
   */
  const optimistic = ref<PageViews | null>(null);

  // ---- what is stored, and what is shown ----

  // Off when this person's switch is off - or, for as long as the URL says so, when it carries
  // `?confviews=false`: Rancher's own page, with nothing stored and the switch untouched.
  const route = useRoute();
  const templatingEnabled = computed(() => isTemplatingEnabled(store.getters) && !viewsOffInUrl(route?.query));

  const scopes = computed(() => appliedViewScopes(store.getters, props.page));

  // The organization's views, and after them the ones Liz built - unless the organization's already
  // has one by that id (a copy of Liz's view published back), which then stands in for it.
  const orgViews = computed(() => {
    const own = scopes.value.global?.views || [];
    const ids = new Set(own.map((p) => p.id));

    return [...own, ...scopes.value.generated.filter((p) => !ids.has(p.id))];
  });
  const orgIds = computed(() => new Set(orgViews.value.map((p) => p.id)));
  // Your saved views (what the editor writes), with the copies you have not changed following the
  // published views they came from (see followPublished).
  const userSet = computed<PageViews | null>(() => followPublished(optimistic.value || scopes.value.user, orgViews.value));

  /** A working copy of your stored views, for an action to change and write back. */
  const userDraft = (): PageViews => (userSet.value ? clone(userSet.value) : { views: [] });

  /**
   * The view a set opens on. A default can name a published view, which a copy of it then stands in for:
   * making a view your default does not copy it, so it keeps following the published view. Once that
   * view is unpublished, the copy is kept as a view of your own, and stays the default.
   */
  function resolveDefault(set: PageViews | null | undefined): string {
    const id = set?.defaultViewId || '';

    return (id && !set?.views.some((p) => p.id === id) && set?.views.find((p) => p.from === id)?.id) || id;
  }

  const defaultViewId = computed(() => resolveDefault(editing.value ? working.value : userSet.value));

  // Every view in the bar, in the order you dragged them into: the organization's, then your own,
  // until you do. The view the page opens on leads.
  //
  // A view you have forked takes its source's PLACE rather than being appended — the bar has to stay
  // still. Editing "Cluster overview" must not make it jump to the end of the strip.
  const views = computed<View[]>(() => {
    const set = editing.value ? working.value : userSet.value;
    const mine = set?.views || [];
    const forks = new Map(mine.filter((p) => p.from).map((p) => [p.from, p]));

    const published = orgViews.value.map((p) => forks.get(p.id) || { ...p, org: true });
    const own = mine.filter((p) => !p.from || !orgIds.value.has(p.from));
    const all = [...published, ...own];

    // Rancher's own page is always one of the tabs.
    const list = all.some(isStockView) ? all : [builtInStockView(t('configurableViews.page.stockName')), ...all];

    return orderViews(list, set?.order, (view) => orderKeyOf(view, orgIds.value), resolveDefault(set));
  });

  // Proposals approved or discarded on this page, by id and version: the store can hold one a few
  // seconds longer, when a read it started before the change lands after it. Each goes from here once
  // the store no longer has it, so a new proposal by the same name shows.
  const settled = ref<string[]>([]);
  const draftKey = (view: View): string => `${ view.id }@${ view.draft?.version || '' }`;

  // What Liz proposed for this page, for those who may publish it (see generatedDrafts): tabs of their
  // own after the views, never ordered, edited or made the default. Out of the way while editing.
  const drafts = computed<View[]>(() => (editing.value ? [] : scopes.value.drafts.filter((p) => !settled.value.includes(draftKey(p)))));

  watch(() => scopes.value.drafts.map(draftKey), (now) => {
    settled.value = settled.value.filter((key) => now.includes(key));
  });

  /** A proposal is approved or discarded: it leaves the page now, whatever the store still holds. */
  function settleDraft(view: View): void {
    settled.value = [...settled.value, draftKey(view)];
  }

  /** The tabs showing a published view, or your copy of one. */
  const publishedIds = computed(() => views.value.filter((p) => p.org || (p.from && orgIds.value.has(p.from))).map((p) => p.id));

  /** Your copies of a published view that no longer match it: what "Publish your changes" sends. */
  const changedIds = computed(() => {
    const published = new Map(orgViews.value.map((p) => [p.id, viewContent(p)]));

    return views.value.filter((p) => !p.org && p.from && published.has(p.from) && published.get(p.from) !== viewContent(p)).map((p) => p.id);
  });

  /**
   * Your changed copies whose published view changed since they were made - by Liz, or another publish
   * - or that do not say what it showed then (copies made before they did). Those are not your changes
   * alone: the page asks whether to take the published view or keep yours.
   */
  const outdatedIds = computed(() => {
    const published = new Map(orgViews.value.map((p) => [p.id, contentHash(p)]));

    return changedIds.value.filter((id) => {
      const view = views.value.find((p) => p.id === id);

      return !!view?.from && view.fromHash !== published.get(view.from);
    });
  });

  /** A view's id as the bar has it: a published view you have a copy of is your copy. */
  function viewIdFor(id: string | null): string | null {
    if (!id || views.value.some((p) => p.id === id)) {
      return id;
    }

    return views.value.find((p) => p.from === id)?.id || id;
  }

  /** A view of the bar, or a draft: anything that can be open */
  const findView = (id: string | null): View | undefined => (id ? views.value.find((p) => p.id === id) || drafts.value.find((p) => p.id === id) : undefined);

  const activeView = computed(() => findView(activeViewId.value) || views.value[0] || null);

  /** The open view, when it is one Liz proposed */
  const activeDraft = computed(() => (activeView.value?.draft ? activeView.value : null));

  const isNewView = computed(() => !!newViewId.value && newViewId.value === activeViewId.value);

  // A STOCK view renders the page's stock component and has no layout to edit.
  const activeIsStock = computed(() => isStockView(activeView.value));

  // The active view's widgets, in order. A flat list — they wrap onto lines by themselves.
  const widgets = computed(() => (activeView.value && !isStockView(activeView.value) ? activeView.value.widgets : []));

  const gap = computed(() => (activeView.value && !isStockView(activeView.value) ? activeView.value.gap : DEFAULT_GAP));

  // True when the draft differs from the last saved state.
  const dirty = computed(() => editing.value && savedBaseline.value !== null && JSON.stringify(working.value) !== savedBaseline.value);

  const viewById = (id: string): View | null => findView(id) || null;

  /** The view being edited, as it is in the draft. */
  function workingView(): View | null {
    return working.value?.views.find((p) => p.id === activeViewId.value) || null;
  }

  /** The same, when it is a view with a grid - which is the only kind with widgets to change. */
  function workingLayout(): LayoutView | null {
    const view = workingView();

    return view && !isStockView(view) ? view : null;
  }

  // ---- which view is open ----

  /**
   * Open on your default view, or the first one there is.
   *
   * The config arrives in pieces — the organization's views resolve before your own — so the first
   * pass can only fall back to the first view there is. That fallback is NOT a choice, and this runs
   * again when the rest lands: your default still wins. A view you actually picked (`pinnedView`) is
   * never moved underneath you.
   */
  function syncActiveView(): void {
    if (pinnedView.value && findView(activeViewId.value)) {
      return;
    }

    const preferred = views.value.find((p) => p.id === defaultViewId.value);

    if (preferred) {
      activeViewId.value = preferred.id;
      selectedNodeId.value = null;

      return;
    }

    if (!views.value.find((p) => p.id === activeViewId.value)) {
      activeViewId.value = views.value[0]?.id || null;
      selectedNodeId.value = null;
    }
  }

  /** Move to a view on purpose — and remember that it was on purpose. */
  function setActiveView(id: string | null): void {
    activeViewId.value = viewIdFor(id);
    pinnedView.value = true;
    selectedNodeId.value = null;
  }

  // If what is stored changes underneath us (or on first load), keep a valid active view.
  watch(scopes, () => {
    if (!editing.value) {
      syncActiveView();
    }
  });

  // A link to one view: `?view=<id>` opens it - what Liz links to when she has built one. Once it is open
  // the query goes, so the tabs work as always and a reload opens the page as it would. A draft approved
  // since keeps its name, so a link to it opens the published view. Waits for the views to arrive, as a
  // new one may still be on its way to the store.
  const router = useRouter();

  watch([() => route?.query?.view, views, drafts], ([wanted]) => {
    if (typeof wanted !== 'string' || !wanted || editing.value) {
      return;
    }

    const published = wanted.startsWith(DRAFT_VIEW_PREFIX) ? `${ GENERATED_VIEW_PREFIX }${ wanted.slice(DRAFT_VIEW_PREFIX.length) }` : '';
    const id = [wanted, published].map(viewIdFor).find((candidate) => candidate && findView(candidate));

    if (!id) {
      return;
    }

    setActiveView(id);

    const query = { ...route.query };

    delete query.view;
    router?.replace({ query })?.catch?.(() => {});
  }, { immediate: true });

  /**
   * What is published, read once; the person's own views are already here, with their preferences.
   * Nothing stored and no access to it are the same answer: Rancher's own page, straight away. A read
   * that failed is read again on the next visit.
   */
  async function load(): Promise<void> {
    await fetchTemplatingConfigMaps(store);

    syncActiveView();
    loaded.value = true;
  }

  // Views also arrive from elsewhere - Liz builds one into a ConfigMap of its own while the page is
  // open. Nothing here polls for them: the read above watches this package's ConfigMaps, and the
  // management store fetches them again as soon as one is created, changed or deleted.

  // ---- writing ----

  /**
   * Write a whole user-scope draft straight through (the view-mode actions, which have no draft). It
   * shows at once, and the stored copy takes over when it lands.
   */
  async function persist(draft: PageViews, activeId: string | null): Promise<void> {
    saving.value = true;
    error.value = '';
    optimistic.value = draft;
    activeViewId.value = activeId;
    pinnedView.value = !!activeId;

    try {
      await saveView(store, 'user', draft, props.page);
    } catch (e) {
      error.value = (e as Error)?.message || String(e);
    } finally {
      optimistic.value = null;
      saving.value = false;
      syncActiveView();
    }
  }

  /**
   * A published view is everyone's, so changing it for yourself - renaming it, making it your default,
   * editing it - forks it into your account first. Returns the id to change.
   */
  function ownCopy(draft: PageViews, view: View): string {
    if (!view.org) {
      return view.id;
    }

    const fork = copyOf(view);

    draft.views.push(fork);

    return fork.id;
  }

  return {
    loaded,
    editing,
    working,
    savedBaseline,
    activeViewId,
    pinnedView,
    selectedNodeId,
    newViewId,
    startedFrom,
    settingsNodeId,
    settingsAnchor,
    saving,
    drawerOpen,
    error,
    templatingEnabled,
    scopes,
    orgViews,
    orgIds,
    userDraft,
    defaultViewId,
    views,
    drafts,
    publishedIds,
    changedIds,
    outdatedIds,
    viewIdFor,
    settleDraft,
    activeView,
    activeDraft,
    isNewView,
    activeIsStock,
    widgets,
    gap,
    dirty,
    viewById,
    workingView,
    workingLayout,
    syncActiveView,
    setActiveView,
    load,
    persist,
    ownCopy,
  };
}

/** A page's views, as usePageViews returns them - what the other parts of the page work over. */
export type PageViewsState = ReturnType<typeof usePageViews>;
