import { flushPromises, mount } from '@vue/test-utils';
import WidgetGenerated from '@pkg/configurable-views/components/widgets/WidgetGenerated.vue';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

// What the store holds and whether the cluster is gone, set by each test
const mockState = {
  widgets:   [] as { name: string; displayName: string; description: string; source: string; created: string }[],
  approvals: {} as Record<string, { hash: string; by: string; at: string }>,
  gone:      false,
};

jest.mock('@pkg/configurable-views/templating/template-engine', () => ({
  generatedWidgets: () => mockState.widgets,
  widgetApprovals:  () => mockState.approvals,
}));
// A hash that says which code it is of
jest.mock('@pkg/configurable-views/templating/widget-hash', () => ({ widgetHash: (source: string) => Promise.resolve(`hash-of:${ source }`) }));
// The compiler, standing in for code that would run: kept to see whether it was ever asked
jest.mock('@pkg/configurable-views/templating/widget-compiler', () => {
  const { h } = jest.requireActual('vue');

  return { compileWidget: jest.fn(() => ({ component: { render: () => h('p', { class: 'ran' }, 'the code ran') }, styles: [] })) };
});
jest.mock('@pkg/configurable-views/composables/useWidgetCluster', () => {
  const { ref } = jest.requireActual('vue');

  return { NO_CLUSTER: 'configurableViews.widget.noCluster', useWidgetCluster: () => ({ cluster: ref('local') }) };
});
jest.mock('@pkg/configurable-views/templating/widget-data', () => ({
  ...jest.requireActual('@pkg/configurable-views/templating/widget-data'),
  clusterGone: () => Promise.resolve(mockState.gone),
}));

const { compileWidget } = jest.requireMock('@pkg/configurable-views/templating/widget-compiler') as { compileWidget: jest.Mock };

const widget = {
  kind: 'generated', component: 'liz-widget-a', title: ''
} as unknown as WidgetSpec;
const written = (source: string) => ({
  name: 'liz-widget-a', displayName: 'Widget A', description: '', source, created: ''
});

async function render() {
  const wrapper = mount(WidgetGenerated, {
    props:  { widget },
    global: {
      provide: { store: { getters: { 'i18n/t': (key: string) => key }, dispatch: jest.fn() } },
      stubs:   { WidgetCard: { props: ['error', 'title'], template: '<div class="card-message">{{ error }}</div>' } },
    },
  });

  await flushPromises();

  return wrapper;
}

const message = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.find('.card-message').text();

describe('a widget Liz wrote', () => {
  beforeEach(() => {
    mockState.widgets = [written('<p>v1</p>')];
    mockState.approvals = {};
    mockState.gone = false;
    compileWidget.mockClear();
  });

  it('does not run until its code is approved, and says it waits', async() => {
    const wrapper = await render();

    expect(message(wrapper)).toContain('configurableViews.generated.pending');
    expect(compileWidget).not.toHaveBeenCalled();
  });

  it('does not run code that changed since it was approved', async() => {
    mockState.approvals = {
      'liz-widget-a': {
        hash: 'hash-of:<p>v0</p>', by: 'admin', at: ''
      }
    };
    const wrapper = await render();

    expect(message(wrapper)).toContain('configurableViews.generated.changed');
    expect(compileWidget).not.toHaveBeenCalled();
  });

  it('runs exactly the code approved', async() => {
    mockState.approvals = {
      'liz-widget-a': {
        hash: 'hash-of:<p>v1</p>', by: 'admin', at: ''
      }
    };
    const wrapper = await render();

    expect(compileWidget).toHaveBeenCalledWith('<p>v1</p>', 'liz-widget-a.vue');
    expect(wrapper.find('.ran').exists()).toBe(true);
  });

  it('says so when the widget is not there any more', async() => {
    mockState.widgets = [];
    const wrapper = await render();

    expect(message(wrapper)).toContain('configurableViews.generated.missing');
  });

  it('says so, rather than run, when its cluster was removed from Rancher', async() => {
    mockState.approvals = {
      'liz-widget-a': {
        hash: 'hash-of:<p>v1</p>', by: 'admin', at: ''
      }
    };
    mockState.gone = true;
    const wrapper = await render();

    expect(message(wrapper)).toContain('configurableViews.errors.clusterGone');
    expect(wrapper.find('.ran').exists()).toBe(false);
  });
});
