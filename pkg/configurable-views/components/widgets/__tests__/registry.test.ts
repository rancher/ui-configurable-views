import { BUILDING_BLOCKS, READY_MADE } from '@pkg/configurable-views/templating/widget-catalog';
import { WIDGETS } from '@pkg/configurable-views/components/widgets/registry';

describe('the widgets', () => {
  it('knows every kind the catalog offers, and how to draw it', () => {
    [...BUILDING_BLOCKS, ...READY_MADE].forEach(({ spec }) => {
      expect(WIDGETS[spec.kind]?.component).toBeDefined();
    });
  });

  it('asks where it reads from only for a kind that reads from somewhere', () => {
    expect(WIDGETS.table.source).toBe('rancherOrCluster');
    expect(WIDGETS.clusterEvents.source).toBe('cluster');
    expect(WIDGETS.links.source).toBeUndefined();
    expect(WIDGETS.clusterTable.source).toBeUndefined();
  });

  it('hands a table the id it keeps its own views under, and a Tabs widget what it needs to hold others', () => {
    expect(WIDGETS.table.hostProps).toStrictEqual(['nodeId']);
    expect(WIDGETS.tabs.hostProps).toStrictEqual(['nodeId', 'gap']);
  });
});
