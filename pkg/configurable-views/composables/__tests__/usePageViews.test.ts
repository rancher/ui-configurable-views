import type { VuexStore } from '@shell/types/store/vuex';
import { usePageViews } from '@pkg/configurable-views/composables/usePageViews';

jest.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));

const READ = 'management/findLabelSelector';
const USER = 'auth/getUser';

describe('usePageViews load', () => {
  // A store that can read ConfigMaps, or not (`schema`), and finds nothing in them.
  function storeWith({ schema = true, read = () => Promise.resolve([]) }: { schema?: boolean; read?: () => Promise<unknown> } = {}) {
    const dispatch = jest.fn((action: string) => (action === READ ? read() : Promise.resolve()));
    const store = {
      dispatch,
      getters: {
        'management/schemaFor': () => (schema ? {} : undefined),
        'management/byId':      () => undefined,
        'management/all':       () => [],
        'auth/user':            { id: 'u-1' },
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

  it('asks who the user is, then reads once, when nothing is stored', async() => {
    const { store, dispatch } = storeWith();
    const views = await load(store);

    expect(actions(dispatch)).toStrictEqual([USER, READ]);
    expect(views.loaded.value).toBe(true);
    expect(views.userId.value).toBe('u-1');
  });

  it('does not read again when the read fails, as it does for someone who may not read the ConfigMaps', async() => {
    const { store, dispatch } = storeWith({ read: () => Promise.reject(new Error('403')) });
    const views = await load(store);

    expect(actions(dispatch)).toStrictEqual([USER, READ]);
    expect(views.loaded.value).toBe(true);
    expect(views.views.value.map((view) => 'kind' in view && view.kind)).toStrictEqual(['stock']);
  });

  it('does not read at all, or wait, when the user has no ConfigMaps to read', async() => {
    const { store, dispatch } = storeWith({ schema: false });
    const views = await load(store);

    expect(actions(dispatch)).toStrictEqual([USER]);
    expect(views.loaded.value).toBe(true);
  });
});
