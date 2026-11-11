import { defineComponent, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { VuexStore } from '@shell/types/store/vuex';
import { EVENT_CONNECTED } from '@shell/utils/socket';
import { clusterStore, forgetClusterStores, useClusterStore } from '@pkg/configurable-views/composables/useClusterStore';

const mockCoreStore = jest.fn();

jest.mock('@shell/plugins/dashboard-store', () => ({ __esModule: true, default: (...args: unknown[]) => mockCoreStore(...args) }));
// The shell's steve store, as far as the package changes it: its getters are kept, and opening its
// socket makes it the one the shell asks.
jest.mock('@shell/plugins/steve', () => ({
  SteveFactory: (namespace: string, baseUrl: string) => ({
    namespace,
    baseUrl,
    getters: { kept: 'a steve getter' },
    actions: {
      opened(this: { $socket?: string }) {
        this.$socket = "this store's socket";
      }
    },
  }),
  steveStoreInit: 'the steve init',
}));

interface StoreModule {
  getters: Record<string, (state?: object) => (...args: unknown[]) => unknown>;
  actions: { opened(this: { $socket?: string }, ctx: unknown, event: unknown): Promise<void> };
}

describe('a store of its own for a cluster that is not the open one', () => {
  let store: VuexStore;

  beforeEach(() => {
    const modules = new Set<string>();

    mockCoreStore.mockReset().mockImplementation((_module, config) => () => modules.add(config.namespace));
    store = {
      getters:   { 'i18n/t': (key: string) => key },
      hasModule: (name: string) => modules.has(name),
      dispatch:  jest.fn().mockResolvedValue(undefined),
      commit:    jest.fn(),
    } as unknown as VuexStore;
  });

  afterEach(() => forgetClusterStores(store));

  const made = () => mockCoreStore.mock.calls[0][0] as StoreModule;

  it("is made the first time it is asked for, at that cluster's API, loaded and listening, and shared after", async() => {
    await expect(clusterStore(store, 'c-1')).resolves.toBe('cv-c-1');
    await expect(clusterStore(store, 'c-1')).resolves.toBe('cv-c-1');

    expect(mockCoreStore).toHaveBeenCalledTimes(1);
    expect(mockCoreStore.mock.calls[0].slice(1)).toStrictEqual([{
      namespace: 'cv-c-1', baseUrl: '/k8s/clusters/c-1/v1', supportsStream: false, isClusterStore: true
    }, 'the steve init']);
    expect((store.dispatch as jest.Mock).mock.calls).toStrictEqual([['cv-c-1/loadSchemas', true], ['cv-c-1/subscribe']]);
  });

  it('is loaded again when it could not be, without being made again', async() => {
    (store.dispatch as jest.Mock).mockRejectedValueOnce(new Error('503'));

    await expect(clusterStore(store, 'c-1')).rejects.toThrow('503');
    await expect(clusterStore(store, 'c-1')).resolves.toBe('cv-c-1');

    expect(mockCoreStore).toHaveBeenCalledTimes(1);
    expect(store.dispatch).toHaveBeenCalledWith('cv-c-1/subscribe');
  });

  it("keeps its reads after a change apart from another store's, and asks its own socket whether one can go ahead", async() => {
    await clusterStore(store, 'c-1');

    const { getters } = made();

    expect(getters.kept).toBe('a steve getter');
    expect(getters.backOffId()({ type: 'pod', mode: 'resource.changes' }, 'fetchPageResources')).toMatch(/^cv-c-1:.*pod.*:detail=fetchPageResources$/);
    expect(getters.canBackoff({ socket: { state: EVENT_CONNECTED } })()).toBe(true);
    expect(getters.canBackoff({ socket: { state: 'disconnected' } })()).toBe(false);
  });

  it("leaves the shell's own socket as the one the shell asks when its socket opens", async() => {
    await clusterStore(store, 'c-1');

    const { actions } = made();
    const root: { $socket?: string } = { $socket: "the shell's socket" };

    await actions.opened.call(root, {}, {});
    expect(root.$socket).toBe("the shell's socket");

    const alone: { $socket?: string } = {};

    await actions.opened.call(alone, {}, {});
    expect(alone.$socket).toBe("this store's socket");
  });

  it('is closed at a log out, and loaded again, as whoever logs in next, when it is asked for', async() => {
    await clusterStore(store, 'c-1');
    await forgetClusterStores(store);

    expect(store.dispatch).toHaveBeenCalledWith('cv-c-1/unsubscribe');
    expect(store.commit).toHaveBeenCalledWith('cv-c-1/reset');

    await clusterStore(store, 'c-1');

    expect((store.dispatch as jest.Mock).mock.calls.filter(([action]) => action === 'cv-c-1/loadSchemas')).toHaveLength(2);
    expect(mockCoreStore).toHaveBeenCalledTimes(1);
  });

  describe('for a widget', () => {
    function using(start: string) {
      const cluster = ref(start);
      let made: ReturnType<typeof useClusterStore> | undefined;

      mount(defineComponent({
        setup() {
          made = useClusterStore(() => cluster.value);

          return () => null;
        }
      }), { global: { provide: { store } } });

      return { made: made as ReturnType<typeof useClusterStore>, cluster };
    }

    it("names the store of the widget's cluster once it is made, and none with no cluster", async() => {
      const { made, cluster } = using('c-1');

      expect(made.name.value).toBe('');
      await flushPromises();
      expect(made.name.value).toBe('cv-c-1');

      cluster.value = '';
      await flushPromises();
      expect(made.name.value).toBe('');
    });

    it('says so when the cluster cannot be read', async() => {
      (store.dispatch as jest.Mock).mockRejectedValueOnce(new Error('403'));

      const { made } = using('c-2');

      await flushPromises();

      expect(made.name.value).toBe('');
      expect(made.error.value).toContain('configurableViews.errors.cluster');
    });
  });
});
