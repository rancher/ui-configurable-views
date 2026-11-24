import { flushPromises, shallowMount } from '@vue/test-utils';
import EditViewSidebar from '@pkg/configurable-views/components/EditViewSidebar.vue';
import CatalogTile from '@pkg/configurable-views/components/CatalogTile.vue';
import type { View } from '@pkg/configurable-views/templating/types';

// Two widgets Liz wrote, both approved; one has changed since its approval
jest.mock('@pkg/configurable-views/templating/template-engine', () => ({
  ...jest.requireActual('@pkg/configurable-views/templating/template-engine'),
  generatedWidgets: () => [
    {
      name: 'liz-widget-same', displayName: 'Same', description: '', source: 'same', created: ''
    },
    {
      name: 'liz-widget-changed', displayName: 'Changed', description: '', source: 'changed since', created: ''
    },
  ],
  widgetApprovals: () => ({
    'liz-widget-same': {
      hash: 'hash-of:same', by: 'admin', at: ''
    },
    'liz-widget-changed': {
      hash: 'hash-of:changed', by: 'admin', at: ''
    },
  }),
}));
jest.mock('@pkg/configurable-views/templating/widget-hash', () => ({ widgetHash: (source: string) => Promise.resolve(`hash-of:${ source }`) }));

describe('the Add tab', () => {
  it('offers the widgets Liz wrote only while their code is the code approved', async() => {
    const view = {
      id: 'v', name: 'V', gap: 0, pad: 0, widgets: []
    } as unknown as View;
    const wrapper = shallowMount(EditViewSidebar, {
      props:  { view },
      global: {
        provide: { store: { getters: { 'i18n/t': (key: string) => key } } },
        stubs:   { Tabbed: { template: '<div><slot /></div>' }, Tab: { template: '<div><slot /></div>' } },
      },
    });

    await flushPromises();

    const generated = wrapper.findAllComponents(CatalogTile).map((tile) => tile.props('entry')).filter((entry) => entry.spec.kind === 'generated');

    expect(generated.map((entry) => entry.spec.component)).toStrictEqual(['liz-widget-same']);
  });
});
