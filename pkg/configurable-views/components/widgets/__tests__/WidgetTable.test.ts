import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import PaginatedResourceTable from '@shell/components/PaginatedResourceTable.vue';
import WidgetTable from '@pkg/configurable-views/components/widgets/WidgetTable.vue';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

const mockClusterStore = jest.fn();
const mockPageLikeItsList = jest.fn();

jest.mock('vue-router', () => ({ useRoute: () => ({ params: {} }) }));
// The store of the widget's cluster as the widget sees it: its name once made, or why it could not be.
jest.mock('@pkg/configurable-views/composables/useClusterStore', () => {
  const { ref } = jest.requireActual('vue');

  return {
    useClusterStore: (cluster: () => string) => {
      const name = ref('');
      const error = ref('');
      const from = cluster();

      if (from) {
        mockClusterStore(from).then((made: string) => {
          name.value = made;
        }, () => {
          error.value = 'configurableViews.errors.cluster';
        });
      }

      return { name, error };
    },
  };
});
jest.mock('@pkg/configurable-views/templating/table-paging', () => ({
  PAGINATION_CONTEXT: 'the package context',
  pageLikeItsList:    (...args: unknown[]) => mockPageLikeItsList(...args),
}));

// The card, as far as the table cares: a message, or loading, or what it holds.
const WidgetCard = defineComponent({
  props: {
    title: { type: String, default: '' }, count: { type: Number, default: null }, loading: Boolean, error: { type: String, default: '' }
  },
  setup(props, { slots }) {
    return () => h('div', props.error || (props.loading ? 'loading' : slots.default?.()));
  },
});

// Rancher's store, the open cluster's (c-1) and the package's own for c-2, each serving pods.
function storeWith(open = 'c-1') {
  const getters: Record<string, unknown> = {
    'i18n/t':              (key: string) => key,
    clusterReady:          true,
    clusterId:             open,
    currentCluster:        { id: open },
    'type-map/headersFor': () => [],
  };

  ['management', 'cluster', 'cv-c-2'].forEach((name) => {
    getters[`${ name }/schemaFor`] = (type: string) => (type === 'pod' ? { id: 'pod', store: name } : null);
    getters[`${ name }/havePage`] = () => null;
    getters[`${ name }/all`] = () => [];
  });

  return { getters, dispatch: jest.fn() };
}

function table(widget: Partial<WidgetSpec>, store = storeWith()) {
  const wrapper = mount(WidgetTable, {
    props: {
      widget: {
        kind: 'table', resource: 'pod', ...widget
      } as WidgetSpec
    },
    global: { provide: { store }, stubs: { WidgetCard, PaginatedResourceTable: true } },
  });

  return {
    wrapper, store, rows: () => wrapper.findComponent(PaginatedResourceTable)
  };
}

describe('a table widget', () => {
  beforeEach(() => {
    mockClusterStore.mockReset();
    mockPageLikeItsList.mockReset();
  });

  it("reads Rancher's own types from the management store, paged where the type's list is", () => {
    const { store, rows } = table({ fromCluster: false });

    expect(rows().props()).toMatchObject({ overrideInStore: 'management', schema: { id: 'pod', store: 'management' } });
    expect(rows().attributes('context')).toBe('the package context');
    expect(mockPageLikeItsList).toHaveBeenCalledWith(store, 'management', 'pod');
    expect(mockClusterStore).not.toHaveBeenCalled();
  });

  it("reads the open cluster from the shell's cluster store", () => {
    const { rows } = table({ fromCluster: true, cluster: 'c-1' });

    expect(rows().props()).toMatchObject({ overrideInStore: 'cluster', schema: { id: 'pod', store: 'cluster' } });
    expect(mockClusterStore).not.toHaveBeenCalled();
  });

  it('reads another cluster through a store of its own, made as it is asked for, and pages it there', async() => {
    mockClusterStore.mockResolvedValue('cv-c-2');

    const { wrapper, store, rows } = table({ fromCluster: true, cluster: 'c-2' });

    expect(wrapper.text()).toBe('loading');
    expect(mockClusterStore).toHaveBeenCalledWith('c-2');

    await flushPromises();

    expect(rows().props()).toMatchObject({ overrideInStore: 'cv-c-2', schema: { id: 'pod', store: 'cv-c-2' } });
    expect(mockPageLikeItsList).toHaveBeenCalledWith(store, 'cv-c-2', 'pod');
  });

  it.each([
    ['an App', 'catalog.cattle.io.app'],
    ['an Ingress', 'networking.k8s.io.ingress'],
  ])('says a table of %s needs a cluster opened, with no count beside it, on a Home with none, because the shell cannot draw its rows', (_, resource) => {
    const store = storeWith('');

    store.getters.currentCluster = null;
    store.getters.clusterReady = false;
    // Rancher serves the type, and holds none of it while its table isn't drawn.
    store.getters['management/schemaFor'] = (type: string) => ({ id: type, store: 'management' });

    const fromRancher = table({
      resource, title: 'Rows', fromCluster: false
    }, store);
    const fromCluster = table({
      resource, title: 'Rows', fromCluster: true, cluster: 'c-2'
    }, store);

    [fromRancher, fromCluster].forEach(({ wrapper, rows }) => {
      expect(wrapper.text()).toContain('configurableViews.widget.needsOpenCluster');
      expect(wrapper.findComponent(WidgetCard).props('count')).toBeNull();
      expect(rows().exists()).toBe(false);
    });
    expect(mockClusterStore).not.toHaveBeenCalled();
  });

  it('says so when another cluster cannot be read', async() => {
    mockClusterStore.mockRejectedValue(new Error('503'));

    const { wrapper, rows } = table({ fromCluster: true, cluster: 'c-2' });

    await flushPromises();

    expect(wrapper.text()).toContain('configurableViews.errors.cluster');
    expect(rows().exists()).toBe(false);
  });
});
