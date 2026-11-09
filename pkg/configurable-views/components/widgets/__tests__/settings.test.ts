import { shallowMount } from '@vue/test-utils';
import { RcButton } from '@components/RcButton';
import BannerSettings from '@pkg/configurable-views/components/widgets/settings/BannerSettings.vue';
import LinksSettings from '@pkg/configurable-views/components/widgets/settings/LinksSettings.vue';
import TabsSettings from '@pkg/configurable-views/components/widgets/settings/TabsSettings.vue';
import StatusCardsSettings from '@pkg/configurable-views/components/widgets/settings/StatusCardsSettings.vue';
import { DEFAULT_STATUS_CARDS } from '@pkg/configurable-views/templating/status-cards';
import type { WidgetSpec } from '@pkg/configurable-views/templating/types';

const global = { provide: { store: { getters: { 'i18n/t': (key: string) => key } } } };

describe('a widget\'s own settings', () => {
  it('hands back the one field that changed, and leaves the copy it was given alone', async() => {
    const widget = { kind: 'banner', subtitle: 'old' } as WidgetSpec;
    const wrapper = shallowMount(BannerSettings, { props: { widget }, global });

    await wrapper.findAll('input')[0].setValue('new');

    expect(wrapper.emitted('update')).toStrictEqual([[{ subtitle: 'new' }]]);
    expect(widget.subtitle).toBe('old');
  });

  describe('links', () => {
    const custom = (links: WidgetSpec['links'] = []) => ({
      kind: 'links', source: 'custom', links
    } as WidgetSpec);

    it('shows one per line, as a label and a url', () => {
      const wrapper = shallowMount(LinksSettings, { props: { widget: custom([{ label: 'The wiki', url: 'https://a' }, { label: 'B', url: 'https://b' }]) }, global });

      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('The wiki https://a\nB https://b');
    });

    it('reads the url from after the last space, and drops a line that has none', async() => {
      const wrapper = shallowMount(LinksSettings, { props: { widget: custom() }, global });

      await wrapper.find('textarea').setValue('The wiki https://a\nno-url\n');

      expect(wrapper.emitted('update')).toStrictEqual([[{ links: [{ label: 'The wiki', url: 'https://a' }] }]]);
    });

    it('asks for links only when they are custom', () => {
      const wrapper = shallowMount(LinksSettings, { props: { widget: { kind: 'links', source: 'home' } as WidgetSpec }, global });

      expect(wrapper.find('textarea').exists()).toBe(false);
    });
  });

  describe('tabs', () => {
    const tab = (id: string) => ({
      id, name: id, widgets: []
    });
    const mountTabs = (ids: string[]) => shallowMount(TabsSettings, { props: { widget: { kind: 'tabs', tabs: ids.map(tab) } as unknown as WidgetSpec }, global });
    const lastTabs = (wrapper: ReturnType<typeof mountTabs>) => (wrapper.emitted('update')?.pop()?.[0] as WidgetSpec).tabs?.map((t) => t.name);
    // Each row has left, right and remove; the add button is last
    const press = (wrapper: ReturnType<typeof mountTabs>, row: number, button: number) => wrapper.findAllComponents(RcButton)[(row * 3) + button].vm.$emit('click');

    it('renames one', async() => {
      const wrapper = mountTabs(['a', 'b']);

      await wrapper.findAll('input')[1].setValue('renamed');

      expect(lastTabs(wrapper)).toStrictEqual(['a', 'renamed']);
    });

    it('moves one either way, and goes no further than the ends', () => {
      const wrapper = mountTabs(['a', 'b', 'c']);

      press(wrapper, 0, 1);
      expect(lastTabs(wrapper)).toStrictEqual(['b', 'a', 'c']);

      press(wrapper, 2, 0);
      expect(lastTabs(wrapper)).toStrictEqual(['a', 'c', 'b']);

      press(wrapper, 0, 0);
      press(wrapper, 2, 1);
      expect(wrapper.emitted('update')).toHaveLength(0);
    });

    it('removes one, and adds one with an id of its own', () => {
      const wrapper = mountTabs(['a', 'b']);

      press(wrapper, 0, 2);
      expect(lastTabs(wrapper)).toStrictEqual(['b']);

      wrapper.findAllComponents(RcButton)[6].vm.$emit('click');

      const added = (wrapper.emitted('update')?.pop()?.[0] as WidgetSpec).tabs || [];

      expect(added).toHaveLength(3);
      expect(added[2].id).toBeTruthy();
    });
  });

  describe('status cards', () => {
    const status = (changes = {}) => ({ kind: 'statusCards', status: { ...DEFAULT_STATUS_CARDS, ...changes } } as WidgetSpec);
    const lastStatus = (wrapper: ReturnType<typeof shallowMount>) => (wrapper.emitted('update')?.pop()?.[0] as WidgetSpec).status;

    it('hands back every card setting with the one that changed', async() => {
      const widget = status();
      const wrapper = shallowMount(StatusCardsSettings, { props: { widget }, global });

      await wrapper.find('[data-testid="configurable-views-status-cards"]').setValue('namespace');

      expect(lastStatus(wrapper)).toStrictEqual({ ...DEFAULT_STATUS_CARDS, cards: 'namespace' });
      expect(widget.status?.cards).toBe('type');
    });

    it('reads the types as a list, and the custom colours as one state each, leaving out a colour it does not know', async() => {
      const wrapper = shallowMount(StatusCardsSettings, { props: { widget: status({ colors: 'custom' }) }, global });

      await wrapper.find('[data-testid="configurable-views-status-resources"]').setValue('pod, apps.deployment,');
      expect(lastStatus(wrapper)?.resources).toStrictEqual(['pod', 'apps.deployment']);

      await wrapper.find('textarea').setValue('Running=success\npending=purple\nfailed = error');
      expect(lastStatus(wrapper)?.customColors).toStrictEqual({ running: 'success', failed: 'error' });
    });

    it('asks for custom colours only when they are custom', () => {
      const wrapper = shallowMount(StatusCardsSettings, { props: { widget: status() }, global });

      expect(wrapper.find('textarea').exists()).toBe(false);
    });
  });
});
