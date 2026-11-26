import { defineComponent, h } from 'vue';
import { shallowMount } from '@vue/test-utils';
import { RcButton } from '@components/RcButton';
import { BadgeState } from '@components/BadgeState';
import { CAPI, MANAGEMENT } from '@shell/config/types';
import WidgetClusterTable from '@pkg/configurable-views/components/widgets/WidgetClusterTable.vue';
import { WIDGET_CLUSTER_TABLE } from '@pkg/configurable-views/templating/widget-catalog';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

// The table, with the heading and the buttons the widget puts in its slots drawn.
const Table = defineComponent({
  name:  'PaginatedResourceTable',
  props: {
    schema: { type: Object, default: null }, tableViews: { type: Boolean, default: null }, tableViewsPage: { type: String, default: null }, queryFields: { type: Array, default: () => [] }
  },
  setup(_, { slots }) {
    return () => h('div', [slots['header-left']?.(), slots['header-middle']?.()]);
  },
});

// The Home's clusters, for someone who may create clusters, with Rancher's table views on or off.
function clusters({ tableViews }: { tableViews: boolean }) {
  const store = {
    getters: {
      'i18n/t':                   (key: string) => key,
      'features/get':             (name: string) => name === 'ui-configurable-tables' && tableViews,
      'management/schemaFor':     (type: string) => ({ [CAPI.RANCHER_CLUSTER]: { collectionMethods: ['GET', 'POST'] }, [MANAGEMENT.CLUSTER]: { id: MANAGEMENT.CLUSTER } })[type],
      'management/getSavedCount': () => 3,
      'management/all':           () => [],
      'management/canList':       () => false,
      'prefs/get':                () => [],
    },
    dispatch: jest.fn(),
  };
  const wrapper = shallowMount(WidgetClusterTable, {
    props:  { widget: { kind: WIDGET_CLUSTER_TABLE } as WidgetSpec },
    global: { provide: { store }, stubs: { PaginatedResourceTable: Table } },
  });
  const buttons = () => wrapper.findAllComponents(RcButton).map((button) => [button.attributes('aria-label'), button.props('variant')]);

  return {
    wrapper, table: () => wrapper.findComponent(Table), buttons
  };
}

describe('the Home clusters widget', () => {
  it("is the Home's table views list when Rancher has table views on, with the Home's own saved views", () => {
    const { table } = clusters({ tableViews: true });

    expect(table().props('tableViews')).toBe(true);
    expect(table().props('tableViewsPage')).toBe('home');
    expect((table().props('queryFields') as { name?: string, key?: string }[]).length).toBeGreaterThan(0);
  });

  it("has the Home's buttons for table views: Create and Import Existing first, Manage the primary one, and no count", () => {
    const { wrapper, buttons } = clusters({ tableViews: true });

    expect(buttons()).toStrictEqual([
      ['generic.create', 'secondary'],
      ['cluster.importAction', 'secondary'],
      ['cluster.manageAction', 'primary'],
    ]);
    expect(wrapper.findComponent(BadgeState).exists()).toBe(false);
    expect(wrapper.find('.cluster-actions').exists()).toBe(true);
  });

  it("keeps the Home's buttons and count as they were without table views", () => {
    const { wrapper, buttons } = clusters({ tableViews: false });

    expect(buttons()).toStrictEqual([
      ['cluster.manageAction', 'secondary'],
      ['cluster.importAction', 'primary'],
      ['generic.create', 'primary'],
    ]);
    expect(wrapper.findComponent(BadgeState).props('label')).toBe('3');
    expect(wrapper.find('.cluster-actions').exists()).toBe(false);
  });
});
