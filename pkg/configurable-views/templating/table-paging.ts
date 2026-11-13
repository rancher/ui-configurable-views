// Which of a widget's tables the server pages: wherever the type's own list would be.
//
// The shell decides that per store and type, from the UI performance setting and from what extensions
// tell it. A table of the open cluster reads its `cluster` store, and pages as that cluster's lists do.
// The others read stores the shell does not page as it pages a cluster: Rancher's own types are in the
// `management` store, where it pages only clusters and secrets, and another cluster's are in a store of
// the package's own (see useClusterStore), which it knows nothing about. Those are told here to page each
// type a table asks for as a cluster's list of it is paged - under the package's own context, so no other
// list of the type changes.

import paginationUtils from '@shell/utils/pagination-utils';
import type { ServerSidePaginationExtensionConfig } from '@shell/core/types';
import type { VuexStore } from '@shell/types/store/vuex';

/** The context a widget's table asks to be paged under: the package's own. */
export const PAGINATION_CONTEXT = 'configurable-views';

/**
 * What the package has the shell page, by store. Handed to the shell once, at init, and read by it each
 * time a table asks, so what is added here later is paged too.
 */
export const pagedStores: ServerSidePaginationExtensionConfig = {};

/** The shell's own answer: does a list of `type` in `inStore`, under `context`, page? */
function shellPages(store: VuexStore, inStore: string, type: string, context?: string): boolean {
  return paginationUtils.isEnabled({ rootGetters: store.getters, $extension: store.$extension }, { store: inStore, resource: { id: type, context } });
}

/**
 * Have the server page a widget's table of `type` in `inStore` where the type's list in a cluster is
 * paged, and Rancher's own clusters where the shell's Home pages them. Asked before the table is built:
 * the table asks the shell as it is built, and not again.
 */
export function pageLikeItsList(store: VuexStore, inStore: string, type: string): void {
  if (inStore === 'cluster') {
    return;
  }

  const settings = pagedStores[inStore] || (pagedStores[inStore] = { resources: { enableSome: { enabled: [] } } });
  const enabled = settings.resources.enableSome?.enabled || [];

  if (enabled.some((entry) => typeof entry === 'object' && entry.resource === type)) {
    return;
  }

  if (shellPages(store, 'cluster', type) || (inStore === 'management' && shellPages(store, 'management', type, 'home'))) {
    enabled.push({ resource: type, context: [PAGINATION_CONTEXT] });
  }
}
