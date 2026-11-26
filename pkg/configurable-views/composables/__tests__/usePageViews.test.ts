import type { VuexStore } from '@shell/types/store/vuex';
import { reactive, ref } from 'vue';
import { contentHash, copyOf, followPublished, usePageViews } from '@pkg/configurable-views/composables/usePageViews';
import { useViewActions } from '@pkg/configurable-views/composables/useViewActions';
import { useEditSession } from '@pkg/configurable-views/composables/useEditSession';
import type { PageViews, View } from '@pkg/configurable-views/templating/types';

// The page's URL, which a test can give a query, and where the query is replaced
const mockRoute: { query: Record<string, string> } = { query: {} };
const mockReplace = jest.fn(() => Promise.resolve());

jest.mock('vue-router', () => ({ useRoute: () => mockRoute, useRouter: () => ({ replace: mockReplace }) }));

beforeEach(() => {
  mockRoute.query = {};
  mockReplace.mockClear();
});

const READ = 'management/findLabelSelector';

describe('usePageViews load', () => {
  // A store that can read ConfigMaps, or not (`schema`), and finds nothing in them.
  function storeWith({ schema = true, read = () => Promise.resolve([]) }: { schema?: boolean; read?: () => Promise<unknown> } = {}) {
    const dispatch = jest.fn((action: string) => (action === READ ? read() : Promise.resolve()));
    const store = {
      dispatch,
      commit:  jest.fn(),
      getters: {
        'management/schemaFor': () => (schema ? {} : undefined),
        'management/byId':      () => undefined,
        'management/all':       () => [],
        'prefs/get':            () => ({}),
      },
    } as unknown as VuexStore;

    return { store, dispatch };
  }
  const load = async(store: VuexStore) => {
    const views = usePageViews({ page: 'home' }, store, (key: string) => key);

    await views.load();

    return views;
  };
  const actions = (dispatch: jest.Mock) => dispatch.mock.calls.map(([action]) => action);

  it('reads once when nothing is stored', async() => {
    const { store, dispatch } = storeWith();
    const views = await load(store);

    expect(actions(dispatch)).toStrictEqual([READ]);
    expect(views.loaded.value).toBe(true);
  });

  it('does not read again when the read fails, as it does for someone who may not read the ConfigMaps', async() => {
    const { store, dispatch } = storeWith({ read: () => Promise.reject(new Error('403')) });
    const views = await load(store);

    expect(actions(dispatch)).toStrictEqual([READ]);
    expect(views.loaded.value).toBe(true);
    expect(views.views.value.map((view) => 'kind' in view && view.kind)).toStrictEqual(['stock']);
  });

  it('does not read at all, or wait, when the user has no ConfigMaps to read', async() => {
    const { store, dispatch } = storeWith({ schema: false });
    const views = await load(store);

    expect(actions(dispatch)).toStrictEqual([]);
    expect(views.loaded.value).toBe(true);
  });
});

describe('usePageViews and what Liz proposed', () => {
  const MARKER = 'templates.rancher.io/ai-templating';
  const cm = (name: string, type: string, view: unknown, extra: Record<string, string> = {}) => ({
    metadata: {
      name, namespace: 'default', labels: { [MARKER]: 'true', 'templates.rancher.io/type': type }
    },
    data: {
      page: 'home', view: JSON.stringify(view), ...extra
    },
  });
  const proposal = cm('liz-view-new', 'view-draft', { name: 'New', widgets: [] });

  // A store holding the given ConfigMaps of this package, and nothing of this person's own
  function viewsWith(maps: ReturnType<typeof cm>[]) {
    const store = {
      dispatch: jest.fn().mockResolvedValue([]),
      commit:   jest.fn(),
      getters:  {
        'management/schemaFor': () => ({}),
        'management/byId':      (_type: string, id: string) => maps.find((m) => `default/${ m.metadata.name }` === id),
        'management/all':       () => maps,
        'prefs/get':            () => ({}),
      },
    } as unknown as VuexStore;

    return usePageViews({ page: 'home' }, store, (key: string) => key);
  }

  it('keeps proposals out of the views, ordered or made the default, and out of the way while editing', () => {
    const page = viewsWith([proposal, cm('liz-view-platform', 'view', { name: 'Platform', widgets: [] })]);

    expect(page.views.value.map((v) => v.id)).not.toContain('draft:liz-view-new');
    expect(page.drafts.value.map((v) => v.id)).toStrictEqual(['draft:liz-view-new']);
    expect(page.activeDraft.value).toBeNull();

    page.editing.value = true;
    expect(page.drafts.value).toStrictEqual([]);
  });

  it('opens the view a link names, then takes the link out of the URL', async() => {
    mockRoute.query = { view: 'draft:liz-view-new', keep: 'this' };
    const page = viewsWith([proposal]);

    await page.load();

    expect(page.activeViewId.value).toBe('draft:liz-view-new');
    expect(page.activeDraft.value?.name).toBe('New');
    expect(mockReplace).toHaveBeenCalledWith({ query: { keep: 'this' } });
  });

  it('opens the published view for a link to a proposal approved since', async() => {
    mockRoute.query = { view: 'draft:liz-view-new' };
    const page = viewsWith([cm('liz-view-new', 'view', { name: 'New', widgets: [] })]);

    await page.load();

    expect(page.activeViewId.value).toBe('cm:liz-view-new');
    expect(page.activeDraft.value).toBeNull();
  });

  it('takes a proposal off the page once it is approved or discarded, and shows a new one by the same name', async() => {
    const maps = reactive([{ ...proposal, metadata: { ...proposal.metadata, resourceVersion: '1' } }]);
    const page = viewsWith(maps as unknown as ReturnType<typeof cm>[]);
    const [shown] = page.drafts.value;

    page.settleDraft(shown);
    // The store still has it, as when a read it started before the change lands after it
    expect(page.drafts.value).toStrictEqual([]);

    maps[0].metadata.resourceVersion = '2';
    expect(page.drafts.value.map((v) => v.id)).toStrictEqual(['draft:liz-view-new']);
  });

  it('leaves the URL alone while the view it names is not there', async() => {
    mockRoute.query = { view: 'draft:liz-view-nothing' };
    const page = viewsWith([proposal]);

    await page.load();

    expect(page.activeViewId.value).not.toBe('draft:liz-view-nothing');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('your copy of a published view', () => {
  const MARKER = 'templates.rancher.io/ai-templating';
  const PUBLISHED = 'cm:liz-view-platform';
  const widget = (title: string) => ({
    type: 'widget', colSpan: 12, widget: { kind: 'banner', title }
  });
  // Liz's view as published: one banner, or two once she changed it
  const before = { name: 'Platform', widgets: [widget('one')] };
  const after = { name: 'Platform', widgets: [widget('one'), widget('two')] };

  // The page with Liz's view as given, and this person's own views for the Home; writes kept to read back
  function page(published: unknown, mine: PageViews | null = null) {
    // No published view: Liz's ConfigMap is gone, as after it is unpublished
    const maps = published === null ? [] : [{
      metadata: {
        name: 'liz-view-platform', namespace: 'default', labels: { [MARKER]: 'true', 'templates.rancher.io/type': 'view' }
      },
      data: { page: 'home', view: JSON.stringify(published) },
    }];
    const prefs: Record<string, unknown> = { 'configurable-views-saved': mine ? { home: JSON.parse(JSON.stringify(mine)) } : {} };
    // A ConfigMap the page creates, as publishing creates the organization's: saved as it is
    const dispatch = jest.fn((action: string, _payload?: unknown) => Promise.resolve(action === 'management/create' ? {
      metadata: {}, data: {}, save: () => Promise.resolve()
    } : undefined));
    const store = {
      dispatch,
      commit:  jest.fn(),
      getters: {
        'management/schemaFor': () => ({}),
        'management/byId':      (_type: string, id: string) => maps.find((m) => `default/${ m.metadata.name }` === id),
        'management/all':       () => maps,
        'prefs/get':            (key: string) => prefs[key] ?? {},
      },
    } as unknown as VuexStore;
    const views = usePageViews({ page: 'home' }, store, (key: string) => key);
    const confirm = jest.fn().mockResolvedValue(false);
    const actions = useViewActions(views, { page: 'home', title: 'Home' }, store, ((key: string) => key) as never, confirm, ref(null), jest.fn());
    const edit = useEditSession(views, {
      page: 'home', title: 'Home', firstViewName: 'First'
    }, store, ((key: string) => key) as never, confirm);
    const written = (): PageViews | undefined => (dispatch.mock.calls.filter(([action]) => action === 'prefs/set').pop()?.[1] as { value: { home?: PageViews } } | undefined)?.value.home;
    // What publishing wrote for everyone: the organization's views in the page's config
    const publishedNow = (): View[] => {
      const made = dispatch.mock.calls.filter(([action]) => action === 'management/create').pop()?.[1] as { data: { home: string } } | undefined;

      return made ? JSON.parse(made.data.home).global.views : [];
    };

    return {
      views, actions, edit, confirm, written, publishedNow
    };
  }

  // A copy made of the published view as the page holds it
  const copyMadeOf = (published: unknown, change: Partial<View> = {}): View => ({
    ...copyOf(page(published).views.orgViews.value[0]), id: 'mine', ...change
  } as View);
  const shown = (views: ReturnType<typeof page>['views']) => views.views.value.find((v) => v.id === 'mine') as View & { widgets: unknown[] };

  it('compares what views show, not which view they are', () => {
    const view = page(before).views.orgViews.value[0];

    expect(contentHash({
      ...view, id: 'other', from: 'x', fromHash: 'y'
    } as View)).toBe(contentHash(view));
    expect(contentHash({ ...view, name: 'Renamed' })).not.toBe(contentHash(view));
  });

  it('follows the published view while you have not changed it, under its own id', () => {
    const { views } = page(after, { views: [copyMadeOf(before)], defaultViewId: 'mine' });

    expect(shown(views).widgets).toHaveLength(2);
    expect(shown(views).fromHash).toBe(contentHash(views.orgViews.value[0]));
    expect(views.changedIds.value).toStrictEqual([]);
    expect(views.outdatedIds.value).toStrictEqual([]);
    expect(views.defaultViewId.value).toBe('mine');
  });

  it('stays yours once you changed it, and says the published view changed under it', () => {
    const { views } = page(after, { views: [copyMadeOf(before, { name: 'My platform' })] });

    expect(shown(views).widgets).toHaveLength(1);
    expect(views.outdatedIds.value).toStrictEqual(['mine']);
  });

  it('is only changed, not outdated, when the published view is as it was when you copied it', () => {
    const { views } = page(before, { views: [copyMadeOf(before, { name: 'My platform' })] });

    expect(views.changedIds.value).toStrictEqual(['mine']);
    expect(views.outdatedIds.value).toStrictEqual([]);
  });

  it('asks about a copy made before copies remembered their source, when it differs', () => {
    const legacy = copyMadeOf(before);

    delete legacy.fromHash;
    const { views } = page(after, { views: [legacy] });

    expect(views.outdatedIds.value).toStrictEqual(['mine']);
  });

  it('leaves the stored views as they are when nothing follows', () => {
    const set = { views: [copyMadeOf(before)] };

    expect(followPublished(set, page(before).views.orgViews.value)).toBe(set);
  });

  it('takes the published view on request: same tab, what is published now, following it from then on', async() => {
    const { actions, written } = page(after, { views: [copyMadeOf(before, { name: 'My platform' })] });

    await actions.takePublishedView('mine');

    const mine = written()?.views.find((v) => v.id === 'mine') as View & { widgets: unknown[] };

    expect([mine.name, mine.widgets.length, mine.from]).toStrictEqual(['Platform', 2, PUBLISHED]);
  });

  it('keeps your copy on request: it is then your changes to what is published now', async() => {
    const { actions, written, views } = page(after, { views: [copyMadeOf(before, { name: 'My platform' })] });

    await actions.keepOwnCopy('mine');

    const mine = written()?.views.find((v) => v.id === 'mine');

    expect([mine?.name, mine?.fromHash]).toStrictEqual(['My platform', contentHash(views.orgViews.value[0])]);
  });

  it('remembers what was published after publishing your changes, so the copy follows that view from then on', async() => {
    const { actions, confirm, written } = page(before, { views: [copyMadeOf(before, { name: 'My platform' })] });

    confirm.mockResolvedValueOnce(true);
    await actions.publishView('mine');

    const mine = written()?.views.find((v) => v.id === 'mine') as View;

    expect(mine.fromHash).toBe(contentHash(mine));
  });

  it('publishes the view without your record of what it showed, and remembers it on your copy while editing too', async() => {
    const {
      views, actions, edit, confirm, publishedNow
    } = page(before, { views: [copyMadeOf(before, { name: 'My platform' })] });

    views.setActiveView('mine');
    edit.enterEdit();
    confirm.mockResolvedValueOnce(true);
    await actions.publishView('mine');

    const working = views.working.value?.views.find((v) => v.id === 'mine') as View;

    expect(publishedNow().map((v) => [v.id, v.name, 'fromHash' in v])).toStrictEqual([[PUBLISHED, 'My platform', false]]);
    expect(working.fromHash).toBe(contentHash(working));
  });

  it('drops a copy left as it was when an edit is saved, and keeps the default on the published view', async() => {
    const { views, edit, written } = page(before, { views: [copyMadeOf(before)], defaultViewId: 'mine' });

    views.setActiveView('mine');
    edit.enterEdit();
    await edit.save();

    expect(written()).toStrictEqual({ views: [], defaultViewId: PUBLISHED });
  });

  it('saves the changes to a copy as a view of your own, with no record of the published view', async() => {
    const { views, edit, written } = page(before, { views: [copyMadeOf(before)] });

    views.setActiveView('mine');
    edit.enterEdit();
    (views.workingView() as View).name = 'Changed';
    await edit.saveAsNewView();

    const added = written()?.views.find((v) => v.id !== 'mine') as View;

    expect([added.from, added.fromHash]).toStrictEqual([undefined, undefined]);
  });

  it('keeps a copy you made your default as the default once its view is unpublished', () => {
    const { views } = page(null, { views: [copyMadeOf(before, { name: 'My platform' })], defaultViewId: PUBLISHED });

    expect(views.defaultViewId.value).toBe('mine');
  });

  it('says only that the published view may have changed, before publishing a copy that cannot tell', async() => {
    const legacy = copyMadeOf(before, { name: 'My platform' });

    delete legacy.fromHash;
    const { actions, confirm } = page(after, { views: [legacy] });

    await actions.publishView('mine');

    expect(confirm.mock.calls[0][0].body).toBe('configurableViews.page.publish.bodyDiffers');
  });

  it('warns before publishing a copy whose published view changed since', async() => {
    const { actions, confirm } = page(after, { views: [copyMadeOf(before, { name: 'My platform' })] });

    await actions.publishView('mine');

    expect(confirm.mock.calls[0][0].body).toBe('configurableViews.page.publish.bodyOutdated');
  });

  it('makes a published view your default without copying it, and opens your copy for it when you have one', async() => {
    const { actions, written } = page(before);

    await actions.setDefaultView(PUBLISHED);
    expect(written()).toStrictEqual({ views: [], defaultViewId: PUBLISHED });

    const { views } = page(before, { views: [copyMadeOf(before)], defaultViewId: PUBLISHED });

    expect(views.defaultViewId.value).toBe('mine');
    views.setActiveView(PUBLISHED);
    expect(views.activeViewId.value).toBe('mine');
  });
});
