import type { VuexStore } from '@shell/types/store/vuex';
import { usePageViews } from '@pkg/configurable-views/composables/usePageViews';

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

  it('leaves the URL alone while the view it names is not there', async() => {
    mockRoute.query = { view: 'draft:liz-view-nothing' };
    const page = viewsWith([proposal]);

    await page.load();

    expect(page.activeViewId.value).not.toBe('draft:liz-view-nothing');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
