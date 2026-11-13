import { flushPromises, shallowMount } from '@vue/test-utils';
import ResourceTable from '@shell/components/ResourceTable.vue';
import { MESSAGE, REASON } from '@shell/config/table-headers';
import { STEVE_EVENT_FIRST_SEEN, STEVE_EVENT_LAST_SEEN, STEVE_EVENT_OBJECT, STEVE_NAME_COL } from '@shell/config/pagination-table-headers';
import WidgetEvents from '@pkg/configurable-views/components/widgets/WidgetEvents.vue';
import type { StorePageQuery } from '@pkg/configurable-views/composables/useStorePage';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

let mockQuery: () => StorePageQuery = () => ({
  inStore: '', type: '', page: 0, pageSize: 0
});

// Another cluster's events: c-2, whose store is the package's own.
jest.mock('@pkg/configurable-views/composables/useWidgetCluster', () => {
  const { computed, ref } = jest.requireActual('vue');

  return {
    NO_CLUSTER:       'configurableViews.widget.noCluster',
    useWidgetCluster: () => ({ cluster: ref('c-2') }),
    useOpenCluster:   () => computed(() => false),
  };
});
jest.mock('@pkg/configurable-views/composables/useClusterStore', () => {
  const { ref } = jest.requireActual('vue');

  return { useClusterStore: () => ({ name: ref('cv-c-2'), error: ref('') }) };
});
// What the widget asks its store for, kept to be read back.
jest.mock('@pkg/configurable-views/composables/useStorePage', () => {
  const { ref } = jest.requireActual('vue');

  return {
    useStorePage: (query: () => StorePageQuery) => {
      mockQuery = query;

      return {
        rows: ref([]), count: ref(0), loading: ref(false), error: ref('')
      };
    },
  };
});

function events() {
  const store = {
    getters: {
      'i18n/t':               (key: string) => key,
      'prefs/options':        () => [10, 25],
      'management/schemaFor': () => null,
    },
    dispatch: jest.fn(),
  };
  const wrapper = shallowMount(WidgetEvents, {
    props:  { widget: { kind: 'clusterEvents' } as WidgetSpec },
    global: { provide: { store } },
  });

  return { wrapper, table: () => wrapper.findComponent(ResourceTable) };
}

describe('the Events widget of another cluster', () => {
  it('sorts by every column the dashboard\'s paged events table does', () => {
    const { table } = events();
    const headers = table().props('headers') as { name: string; sort: unknown }[];

    expect(headers.map((h) => [h.name, h.sort])).toStrictEqual([
      [REASON.name, REASON.sort],
      [STEVE_EVENT_OBJECT.name, STEVE_EVENT_OBJECT.sort],
      [MESSAGE.name, MESSAGE.sort],
      [STEVE_NAME_COL.name, STEVE_NAME_COL.sort],
      [STEVE_EVENT_FIRST_SEEN.name, STEVE_EVENT_FIRST_SEEN.sort],
      [STEVE_EVENT_LAST_SEEN.name, STEVE_EVENT_LAST_SEEN.sort],
    ]);
  });

  it('reads nothing until the table asks, then the page and order it asks for', async() => {
    const { table } = events();

    expect(mockQuery().inStore).toStrictEqual('');

    table().vm.$emit('pagination-changed', {
      page: 2, perPage: 10, sort: ['metadata.fields.0:desc', 'nameSort'], descending: true
    });
    await flushPromises();

    expect(mockQuery()).toStrictEqual({
      inStore:  'cv-c-2',
      type:     'event',
      page:     2,
      pageSize: 10,
      sort:     [{ field: 'metadata.fields.0:desc', asc: false }, { field: 'nameSort', asc: false }],
    });
  });
});
