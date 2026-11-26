// What Rancher's own shell knows about the Rancher it runs in, told to the shell's copy built into this
// package.
//
// That copy keeps state of its own, which Rancher sets up only in its own copy as it starts: the vendor
// and brand (from the `ui-pl` and `ui-brand` settings), and the version data that says whether this is
// Rancher Prime. Left unset, the shell components the package draws - the Home's banner and links among
// its widgets - read the defaults, so a Prime Rancher's banner welcomed to Rancher Community and its
// links were the community's. They are set here as Rancher sets its own.

import { setBrand, setVendor } from '@shell/config/private-label';
import { SETTING } from '@shell/config/settings';
import { MANAGEMENT } from '@shell/config/types';
import versions from '@shell/utils/versions';
import type { VuexStore } from '@shell/types/store/vuex';

/**
 * Sets the vendor and brand from Rancher's settings, as Rancher does when it loads them, and has the
 * version data read once, as Rancher reads it at start. Resolves once the version data is in, never
 * with an error: a Rancher that does not answer leaves the defaults, as it leaves Rancher's own.
 */
export async function shareRancherState(store: VuexStore): Promise<void> {
  const setting = (id: string): string | undefined => store.getters['management/byId']?.(MANAGEMENT.SETTING, id)?.value;
  const vendor = setting(SETTING.PL);
  const brand = setting(SETTING.BRAND);

  if (vendor) {
    setVendor(vendor);
  }
  if (brand) {
    setBrand(brand);
  }

  await versions.fetch({ store });
}
