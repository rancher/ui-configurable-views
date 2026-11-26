import type { VuexStore } from '@shell/types/store/vuex';
import { getVendor } from '@shell/config/private-label';
import { isRancherPrime } from '@shell/config/version';

describe('shareRancherState', () => {
  // A store with Rancher's settings, answering the version requests as a Prime Rancher does
  function storeWith(settings: Record<string, string>) {
    const dispatch = jest.fn((action: string, { url }: { url: string }) => Promise.resolve(
      url === '/rancherversion' ? {
        Version: 'v2.16.0', RancherPrime: 'true', GitCommit: 'abc'
      } : { gitVersion: 'v1.34.3' }
    ));
    const store = {
      dispatch,
      getters: { 'management/byId': (_: string, id: string) => (id in settings ? { id, value: settings[id] } : undefined) },
    } as unknown as VuexStore;

    return { store, dispatch };
  }

  // Each test starts from the shell's defaults: the module state is the module's own
  async function fresh() {
    jest.resetModules();
    const { shareRancherState } = await import('@pkg/configurable-views/templating/shell-state');
    const label = await import('@shell/config/private-label');
    const version = await import('@shell/config/version');

    return {
      shareRancherState, getVendor: label.getVendor, isRancherPrime: version.isRancherPrime
    };
  }

  it("tells the shell's copy the vendor, brand and version data Rancher has", async() => {
    const { shareRancherState, getVendor: vendor, isRancherPrime: prime } = await fresh();
    const { store, dispatch } = storeWith({ 'ui-pl': 'rancher', 'ui-brand': 'suse' });

    expect(vendor()).toBe('Rancher Community');
    expect(prime()).toBe(false);

    await shareRancherState(store);

    expect(vendor()).toBe('Rancher Prime');
    expect(prime()).toBe(true);
    expect(dispatch.mock.calls.map(([action, { url }]) => [action, url])).toStrictEqual([
      ['rancher/request', '/rancherversion'],
      ['rancher/request', '/version'],
    ]);
  });

  it('reads the version data once, however often the pages load', async() => {
    const { shareRancherState } = await fresh();
    const { store, dispatch } = storeWith({});

    await shareRancherState(store);
    await shareRancherState(store);

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('keeps the defaults where Rancher has no such settings, and does not fail when it does not answer', async() => {
    const { shareRancherState, getVendor: vendor } = await fresh();
    const { store, dispatch } = storeWith({});

    dispatch.mockImplementation(() => Promise.reject(new Error('unavailable')));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(shareRancherState(store)).resolves.toBeUndefined();
    expect(vendor()).toBe('Rancher Community');
  });

  it('is a separate copy from the one these tests import first', () => {
    // Guards the test above: the modules imported at the top are untouched by `fresh`
    expect(getVendor()).toBe('Rancher Community');
    expect(isRancherPrime()).toBe(false);
  });
});
