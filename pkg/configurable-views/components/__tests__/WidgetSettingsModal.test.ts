import { flushPromises, shallowMount } from '@vue/test-utils';
import { RcButton } from '@components/RcButton';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import WidgetSettingsModal from '@pkg/configurable-views/components/WidgetSettingsModal.vue';
import BannerSettings from '@pkg/configurable-views/components/widgets/settings/BannerSettings.vue';
import type { ClusterOption } from '@pkg/configurable-views/templating/widget-data';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

const mockPageOfClusters = jest.fn();
const mockClusterOption = jest.fn();
const mockAllClusterOptions = jest.fn();
const mockPageLikeItsList = jest.fn();

jest.mock('@pkg/configurable-views/templating/widget-data', () => ({
  ...jest.requireActual('@pkg/configurable-views/templating/widget-data'),
  pageOfClusters:    (...args: unknown[]) => mockPageOfClusters(...args),
  clusterOption:     (...args: unknown[]) => mockClusterOption(...args),
  allClusterOptions: (...args: unknown[]) => mockAllClusterOptions(...args),
}));
jest.mock('@pkg/configurable-views/templating/table-paging', () => ({
  PAGINATION_CONTEXT: 'the package context',
  pageLikeItsList:    (...args: unknown[]) => mockPageLikeItsList(...args),
}));

const ONE: ClusterOption = { value: 'c-1', label: 'One' };
let paged = false;

const store = {
  dispatch: jest.fn(),
  getters:  {
    'i18n/t':                       (key: string) => key,
    'management/paginationEnabled': ({ context }: { context: string }) => paged && context === 'the package context',
  },
};

function open(widget: Partial<WidgetSpec>) {
  return shallowMount(WidgetSettingsModal, {
    props:  { widget: widget as WidgetSpec },
    global: { provide: { store } },
  });
}

const clusterField = (wrapper: ReturnType<typeof open>) => wrapper.findComponent(LabeledSelect);
const clusterChoices = (wrapper: ReturnType<typeof open>) => (clusterField(wrapper).props('options') as ClusterOption[]).map((o) => o.value);
const labelOf = (wrapper: ReturnType<typeof open>) => clusterField(wrapper).vm.$attrs['get-option-label'] as (option: ClusterOption | string) => string;
const firstPage = {
  page: 1, pageSize: 10, filter: '', pageContent: [], resetPage: true
};

describe('the widget settings dialog', () => {
  beforeEach(() => {
    paged = false;
    mockPageOfClusters.mockReset().mockResolvedValue({
      page: [ONE], pages: 1, total: 1
    });
    mockClusterOption.mockReset().mockResolvedValue(undefined);
    mockAllClusterOptions.mockReset().mockResolvedValue([ONE]);
    mockPageLikeItsList.mockReset();
  });

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

  it("reads the clusters a page at a time where the shell's Home pages them, with what it offers above them first", async() => {
    paged = true;

    const wrapper = open({ kind: 'clusterEvents', cluster: '' });

    await flushPromises();

    expect(mockPageLikeItsList).toHaveBeenCalledWith(store, 'management', 'management.cattle.io.cluster');
    expect(clusterField(wrapper).props()).toMatchObject({
      resourceType: 'management.cattle.io.cluster', inStore: 'management', context: 'the package context'
    });
    expect(mockAllClusterOptions).not.toHaveBeenCalled();

    const paginate = clusterField(wrapper).props('paginate') as (opts: object) => Promise<{ page: ClusterOption[] }>;
    const { page } = await paginate(firstPage);

    expect(page.map((o) => o.value)).toStrictEqual([':page', 'c-1']);

    // The next page is asked for with what was read, without what the field offers above it
    await paginate({
      ...firstPage, page: 2, pageContent: page, resetPage: false
    });
    expect(mockPageOfClusters.mock.calls[1][1].pageContent).toStrictEqual([ONE]);
  });

  it("shows the widget's own cluster by name though it is on a page of the list not read, and every cluster read", async() => {
    paged = true;
    mockClusterOption.mockResolvedValue({ value: 'c-9', label: 'Nine' });

    const wrapper = open({ kind: 'clusterEvents', cluster: 'c-9' });

    await flushPromises();
    await (clusterField(wrapper).props('paginate') as (opts: object) => Promise<unknown>)(firstPage);

    expect(mockClusterOption).toHaveBeenCalledWith(store, 'c-9');
    expect(labelOf(wrapper)('c-9')).toBe('Nine');
    expect(labelOf(wrapper)('c-1')).toBe('One');
    expect(labelOf(wrapper)('c-unknown')).toBe('c-unknown');
    expect(labelOf(wrapper)(ONE)).toBe('One');
  });

  it('offers a table Rancher or a cluster, and says which by what is picked', async() => {
    const wrapper = open({
      kind: 'table', resource: 'pod', fromCluster: false, cluster: ''
    });

    await flushPromises();

    expect(clusterChoices(wrapper)).toStrictEqual([':rancher', ':page', 'c-1']);
    expect(clusterField(wrapper).props('value')).toBe(':rancher');

    const pick = async(value: string) => {
      clusterField(wrapper).vm.$emit('update:value', value);
      await wrapper.vm.$nextTick();
      wrapper.findAllComponents(RcButton).at(-1)?.vm.$emit('click');

      return wrapper.emitted('done')?.at(-1)?.[0];
    };

    expect(await pick('c-1')).toMatchObject({ fromCluster: true, cluster: 'c-1' });
    expect(await pick(':page')).toMatchObject({ fromCluster: true, cluster: '' });
    expect(await pick(':rancher')).toMatchObject({ fromCluster: false, cluster: '' });
  });

  it('offers a cluster widget only clusters, and every one where the shell does not page them', async() => {
    const wrapper = open({ kind: 'clusterEvents', cluster: '' });

    await flushPromises();

    expect(clusterChoices(wrapper)).toStrictEqual([':page', 'c-1']);
    expect(clusterField(wrapper).props('value')).toBe(':page');
    expect(mockPageOfClusters).not.toHaveBeenCalled();
  });

  it('asks a widget that reads from nowhere for no cluster', () => {
    expect(clusterField(open({ kind: 'links', source: 'custom' })).exists()).toBe(false);
  });

  it('says what it says about a kind with nothing to set up', () => {
    expect(open({ kind: 'clusterTable' }).text()).toContain('configurableViews.widgetSettings.clusterTableHint');
  });
});
