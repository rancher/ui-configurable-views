import { flushPromises, shallowMount } from '@vue/test-utils';
import { RcButton } from '@components/RcButton';
import WidgetSettingsModal from '@pkg/configurable-views/components/WidgetSettingsModal.vue';
import BannerSettings from '@pkg/configurable-views/components/widgets/settings/BannerSettings.vue';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

const store = {
  dispatch: jest.fn().mockResolvedValue({ data: [{ id: 'c-1', spec: { displayName: 'One' } }] }),
  getters:  { 'i18n/t': (key: string) => key },
};

function open(widget: Partial<WidgetSpec>) {
  return shallowMount(WidgetSettingsModal, {
    props:  { widget: widget as WidgetSpec },
    global: { provide: { store } },
  });
}

const clusterField = (wrapper: ReturnType<typeof open>) => wrapper.find('[data-testid="configurable-views-widget-cluster"]');
const clusterChoices = (wrapper: ReturnType<typeof open>) => clusterField(wrapper).findAll('option').map((o) => o.element.value);

describe('the widget settings dialog', () => {
  beforeEach(() => store.dispatch.mockClear());

  it('draws what only that kind has, keeps what it changes, and hands it back on Done', async() => {
    const widget: Partial<WidgetSpec> = { kind: 'banner', title: 'Hello' };
    const wrapper = open(widget);

    wrapper.findComponent(BannerSettings).vm.$emit('update', { subtitle: 'new' });
    await wrapper.vm.$nextTick();
    wrapper.findAllComponents(RcButton).at(-1)?.vm.$emit('click');

    expect(wrapper.emitted('done')?.[0][0]).toMatchObject({
      kind: 'banner', title: 'Hello', subtitle: 'new'
    });
    expect(widget).toStrictEqual({ kind: 'banner', title: 'Hello' });
  });

  it('reads the clusters it offers without loading them, which would empty a table of clusters on the page', async() => {
    const wrapper = open({ kind: 'clusterEvents', cluster: '' });

    await flushPromises();

    expect(wrapper.text()).toContain('One');
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(store.dispatch.mock.calls[0][0]).toBe('management/request');
  });

  it('offers a table Rancher or a cluster, and says which by what is picked', async() => {
    const wrapper = open({
      kind: 'table', resource: 'pod', fromCluster: false, cluster: ''
    });

    await flushPromises();

    expect(clusterChoices(wrapper)).toStrictEqual([':rancher', '', 'c-1']);

    await clusterField(wrapper).setValue('c-1');
    wrapper.findAllComponents(RcButton).at(-1)?.vm.$emit('click');

    expect(wrapper.emitted('done')?.[0][0]).toMatchObject({ fromCluster: true, cluster: 'c-1' });
  });

  it('offers a cluster widget only clusters', async() => {
    const wrapper = open({ kind: 'clusterEvents', cluster: '' });

    await flushPromises();

    expect(clusterChoices(wrapper)).toStrictEqual(['', 'c-1']);
  });

  it('asks a widget that reads from nowhere for no cluster', () => {
    expect(clusterField(open({ kind: 'links', source: 'custom' })).exists()).toBe(false);
  });

  it('says what it says about a kind with nothing to set up', () => {
    expect(open({ kind: 'clusterTable' }).text()).toContain('configurableViews.widgetSettings.clusterTableHint');
  });
});
