import { flushPromises, shallowMount } from '@vue/test-utils';
import WidgetStatusCards from '@pkg/configurable-views/components/widgets/WidgetStatusCards.vue';
import { DEFAULT_STATUS_CARDS } from '@pkg/configurable-views/templating/status-cards';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

// The cluster the widget shows, set by each test.
const mockCluster = { id: '' };

jest.mock('@pkg/configurable-views/composables/useWidgetCluster', () => {
  const { computed } = jest.requireActual('vue');

  return {
    NO_CLUSTER:       'configurableViews.widget.noCluster',
    useWidgetCluster: () => ({ cluster: computed(() => mockCluster.id) }),
  };
});
jest.mock('@shell/composables/useStateColor', () => ({ useStateColor: () => ({ toStateColor: () => 'success', resolveStateColors: () => Promise.resolve() }) }));

// How the store rejects a record it does not have: the answer's body, with its status alongside
const notFound = () => Object.defineProperty({ code: 'NotFound' }, '_status', { value: 404 });

/** A store where `existing` clusters have a record, and every cluster API answers with a pod count. */
function storeWith(existing: string[]) {
  const dispatch = jest.fn((action: string, arg: { id?: string; url?: string }) => {
    if (action === 'management/find') {
      return existing.includes(arg.id || '') ? Promise.resolve({ id: arg.id }) : Promise.reject(notFound());
    }

    return Promise.resolve({ data: [{ counts: { pod: { summary: { count: 3, states: {} } } } }] });
  });

  return {
    getters: {
      'i18n/t':            (key: string) => key,
      'i18n/withFallback': (_key: string, _args: unknown, fallback: string) => fallback,
      'auth/user':         { id: 'u-1' },
    },
    dispatch,
  };
}

const widget = { kind: 'statusCards', status: { ...DEFAULT_STATUS_CARDS, resources: [] } } as unknown as WidgetSpec;

async function mountWith(cluster: string, existing: string[]) {
  mockCluster.id = cluster;
  const store = storeWith(existing);
  const wrapper = shallowMount(WidgetStatusCards, { props: { widget }, global: { provide: { store } } });

  await flushPromises();

  return { wrapper, store };
}

describe('the status cards', () => {
  it('says at once that a cluster removed from Rancher is gone, without asking that cluster anything', async() => {
    const { wrapper, store } = await mountWith('c-m-gone', ['c-m-1']);

    expect(wrapper.find('.text-error').text()).toBe('configurableViews.errors.clusterGone-{"cluster":"c-m-gone"}');
    expect(store.dispatch.mock.calls.filter(([action]) => action === 'management/request')).toHaveLength(0);
  });

  it('reads the counts of a cluster Rancher has', async() => {
    const { wrapper, store } = await mountWith('c-m-1', ['c-m-1']);

    expect(wrapper.find('.text-error').exists()).toBe(false);
    expect(store.dispatch).toHaveBeenCalledWith('management/request', { url: '/k8s/clusters/c-m-1/v1/counts' });
  });
});
