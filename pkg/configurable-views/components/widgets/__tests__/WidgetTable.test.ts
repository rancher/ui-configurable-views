import { defineComponent, h, type Ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import ResourceTable from '@shell/components/ResourceTable.vue';
import PaginatedResourceTable from '@shell/components/PaginatedResourceTable.vue';
import WidgetTable from '@pkg/configurable-views/components/widgets/WidgetTable.vue';
import type { StorePageQuery } from '@pkg/configurable-views/composables/useStorePage';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

const mockClusterStore = jest.fn();
const mockPageLikeItsList = jest.fn();

// Each table's own reads, in the order the tables were made: what it asks for, and what it is answered with.
interface MockRead {
  query: () => StorePageQuery;
  rows: Ref<object[]>;
  count: Ref<number>;
  args: Ref<object | null>;
}
const mockReads: MockRead[] = [];

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
jest.mock('@pkg/configurable-views/composables/useStorePage', () => {
  const { ref } = jest.requireActual('vue');

  return {
    useStorePage: (query: () => StorePageQuery) => {
      const read = {
        query, rows: ref([]), count: ref(0), loading: ref(false), error: ref(''), args: ref(null)
      };

      mockReads.push(read);

      return read;
    },
  };
});

// The card, as far as the table cares: a message, or loading, or what it holds.
const WidgetCard = defineComponent({
  props: {
    title: { type: String, default: '' }, count: { type: Number, default: null }, loading: Boolean, error: { type: String, default: '' }
  },
  setup(props, { slots }) {
    return () => h('div', props.error || (props.loading ? 'loading' : slots.default?.()));
  },
});

// Rancher's store, the open cluster's (c-1) and the package's own for c-2, each serving pods, which the
// server pages in the stores given.
function storeWith(open = 'c-1', pagedIn: string[] = []) {
  const getters: Record<string, unknown> = {
    'i18n/t':              (key: string) => key,
    clusterReady:          true,
    clusterId:             open,
    currentCluster:        { id: open },
    'type-map/headersFor': (_: unknown, paged: boolean) => [{ name: paged ? 'paged column' : 'column' }],
  };

  ['management', 'cluster', 'cv-c-2'].forEach((name) => {
    getters[`${ name }/schemaFor`] = (type: string) => (type === 'pod' ? { id: 'pod', store: name } : null);
    getters[`${ name }/havePage`] = () => null;
    getters[`${ name }/all`] = () => [];
    getters[`${ name }/paginationEnabled`] = ({ context }: { context: string }) => pagedIn.includes(name) && context === 'the package context';
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
    global: {
      provide: { store },
      stubs:   {
        WidgetCard, PaginatedResourceTable: true, ResourceTable: true
      }
    },
  });

  return {
    wrapper,
    store,
    rows:  () => wrapper.findComponent(PaginatedResourceTable),
    paged: () => wrapper.findComponent(ResourceTable),
    read:  mockReads[mockReads.length - 1],
  };
}

describe('a table widget', () => {
  beforeEach(() => {
    mockClusterStore.mockReset();
    mockPageLikeItsList.mockReset();
    mockReads.length = 0;
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

  it('shows every row the store holds of a type the server does not page, and reads no page of its own', () => {
    const { rows, paged, read } = table({ fromCluster: false });

    expect(rows().props('headers')).toStrictEqual([{ name: 'column' }]);
    expect(paged().exists()).toBe(false);
    expect(read.query().inStore).toStrictEqual('');
  });

  it.each([
    ['Rancher', { fromCluster: false }, 'management'],
    ['the open cluster', { fromCluster: true, cluster: 'c-1' }, 'cluster'],
  ])('pages a type the server pages from %s as a page of its own, read when the table asks for it', async(_, from, inStore) => {
    const { rows, paged, read } = table(from, storeWith('c-1', [inStore]));

    expect(rows().exists()).toBe(false);
    expect(paged().props()).toMatchObject({
      overrideInStore: inStore, schema: { id: 'pod', store: inStore }, headers: [{ name: 'paged column' }], externalPaginationEnabled: true
    });
    expect(read.query().inStore).toStrictEqual('');

    paged().vm.$emit('pagination-changed', {
      page: 1, perPage: 10, sort: ['metadata.name'], descending: false, viewFilters: []
    });
    await flushPromises();

    expect(read.query()).toStrictEqual({
      inStore, type: 'pod', page: 1, pageSize: 10, sort: [{ field: 'metadata.name', asc: true }], filters: []
    });
  });

  it('pages apart from another table of the same type in the same store', async() => {
    const store = storeWith('c-1', ['management']);
    const first = table({ fromCluster: false, title: 'First' }, store);
    const second = table({ fromCluster: false, title: 'Second' }, store);

    first.paged().vm.$emit('pagination-changed', {
      page: 1, perPage: 10, sort: ['metadata.name']
    });
    second.paged().vm.$emit('pagination-changed', {
      page: 2, perPage: 10, sort: ['metadata.name']
    });
    first.read.rows.value = [{ id: 'pod-1' }];
    first.read.args.value = { page: 1 };
    second.read.rows.value = [{ id: 'pod-11' }];
    second.read.args.value = { page: 2 };
    await flushPromises();

    expect([first.read.query().page, second.read.query().page]).toStrictEqual([1, 2]);
    expect(first.paged().props()).toMatchObject({ rows: [{ id: 'pod-1' }], externalPaginationArgs: { page: 1 } });
    expect(second.paged().props()).toMatchObject({ rows: [{ id: 'pod-11' }], externalPaginationArgs: { page: 2 } });
  });

  it('counts the rows of a paged table from its own last page, and none before it has one', async() => {
    const { wrapper, read } = table({ fromCluster: false, title: 'Pods' }, storeWith('c-1', ['management']));
    const count = () => wrapper.findComponent(WidgetCard).props('count');

    expect(count()).toBeNull();

    read.count.value = 42;
    read.args.value = { page: 1 };
    await flushPromises();

    expect(count()).toStrictEqual(42);
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
