import { flushPromises, shallowMount } from '@vue/test-utils';
import GeneratedWidgetsAdmin from '@pkg/configurable-views/components/GeneratedWidgetsAdmin.vue';

// What the page is answered with, set by each test.
const mockState = {
  canApprove: true,
  confirm:    jest.fn(),
  approve:    jest.fn(),
  remove:     jest.fn(),
};

// The stored widgets and approvals, as Vue refs, so a change shows on the page as the store's would.
jest.mock('@pkg/configurable-views/templating/template-engine', () => {
  const { ref } = jest.requireActual('vue');
  const widgets = ref([]);
  const approvals = ref({});

  return {
    mockStored:                { widgets, approvals },
    generatedWidgets:          () => widgets.value,
    widgetApprovals:           () => approvals.value,
    canApproveWidgets:         () => mockState.canApprove,
    setWidgetApproval:         (...args: unknown[]) => mockState.approve(...args),
    deleteGeneratedWidget:     (...args: unknown[]) => mockState.remove(...args),
    fetchTemplatingConfigMaps: () => Promise.resolve(),
  };
});
// A hash that says which code it is of
jest.mock('@pkg/configurable-views/templating/widget-hash', () => ({ widgetHash: (source: string) => Promise.resolve(`hash-of:${ source }`) }));
jest.mock('@pkg/configurable-views/composables/useConfirm', () => ({ useConfirm: () => mockState.confirm }));
jest.mock('@shell/apis', () => ({ useShell: () => ({ notification: { send: jest.fn() } }) }));

type Widget = { name: string; displayName: string; description: string; source: string; created: string };
const { mockStored } = jest.requireMock('@pkg/configurable-views/templating/template-engine') as {
  mockStored: { widgets: { value: Widget[] }; approvals: { value: Record<string, { hash: string; by: string; at: string }> } };
};

const global = { provide: { store: { getters: { 'i18n/t': (key: string) => key } } } };
const widget = (source: string) => ({
  name: 'liz-widget-a', displayName: 'A', description: '', source, created: ''
});

async function mountAdmin() {
  const wrapper = shallowMount(GeneratedWidgetsAdmin, { global });

  await flushPromises();

  return wrapper;
}

const button = (wrapper: Awaited<ReturnType<typeof mountAdmin>>, what: string) => wrapper.find(`[data-testid="generated-widget-${ what }-liz-widget-a"]`);

describe('the widgets Liz wrote, on Settings', () => {
  beforeEach(() => {
    mockState.canApprove = true;
    mockStored.widgets.value = [widget('<p>one</p>')];
    mockStored.approvals.value = {};
    mockState.confirm.mockReset().mockResolvedValue(true);
    mockState.approve.mockReset().mockResolvedValue(undefined);
    mockState.remove.mockReset().mockResolvedValue(undefined);
  });

  it('is not shown to someone who cannot approve', async() => {
    mockState.canApprove = false;

    expect((await mountAdmin()).find('[data-testid="generated-widgets-admin"]').exists()).toBe(false);
  });

  it('approves only once the code was opened, and then the code as it was read', async() => {
    const wrapper = await mountAdmin();

    expect(button(wrapper, 'approve').attributes('disabled')).toBeDefined();
    expect(button(wrapper, 'read-hint').text()).toContain('configurableViews.generatedAdmin.readFirst');

    await button(wrapper, 'code').trigger('click');
    expect(button(wrapper, 'approve').attributes('disabled')).toBeUndefined();
    expect(button(wrapper, 'read-hint').exists()).toBe(false);

    await button(wrapper, 'approve').trigger('click');
    await flushPromises();
    expect(mockState.approve).toHaveBeenCalledWith(expect.anything(), 'liz-widget-a', 'hash-of:<p>one</p>');
  });

  it('will not approve code that changed after it was opened, until it is opened again', async() => {
    const wrapper = await mountAdmin();

    await button(wrapper, 'code').trigger('click');
    mockStored.widgets.value = [widget('<p>two</p>')];
    await flushPromises();

    expect(button(wrapper, 'approve').attributes('disabled')).toBeDefined();
    expect(button(wrapper, 'read-hint').text()).toContain('configurableViews.generatedAdmin.codeChanged');

    // Hide it and show it again: now the new code is what was read
    await button(wrapper, 'code').trigger('click');
    await button(wrapper, 'code').trigger('click');
    await button(wrapper, 'approve').trigger('click');
    await flushPromises();
    expect(mockState.approve).toHaveBeenCalledWith(expect.anything(), 'liz-widget-a', 'hash-of:<p>two</p>');
  });

  it('says who approved it, and when', async() => {
    mockStored.approvals.value = {
      'liz-widget-a': {
        hash: 'hash-of:<p>one</p>', by: 'admin', at: '2026-11-24T10:00:00Z'
      }
    };
    const wrapper = await mountAdmin();

    expect(button(wrapper, 'approved-by').text()).toContain('configurableViews.generatedAdmin.approvedBy');
    expect(button(wrapper, 'approve').exists()).toBe(false);
  });

  it('asks before deleting, and deletes nothing when the answer is no', async() => {
    const wrapper = await mountAdmin();

    mockState.confirm.mockResolvedValueOnce(false);
    await button(wrapper, 'delete').trigger('click');
    await flushPromises();
    expect(mockState.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(mockState.remove).not.toHaveBeenCalled();

    await button(wrapper, 'delete').trigger('click');
    await flushPromises();
    expect(mockState.remove).toHaveBeenCalledWith(expect.anything(), 'liz-widget-a');
  });
});
