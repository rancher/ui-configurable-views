import type { VuexStore } from '@shell/types/store/vuex';
import { PAGINATION_CONTEXT, pagedStores, pageLikeItsList } from '@pkg/configurable-views/templating/table-paging';

const mockIsEnabled = jest.fn();

jest.mock('@shell/utils/pagination-utils', () => ({ __esModule: true, default: { isEnabled: (...args: unknown[]) => mockIsEnabled(...args) } }));

// The shell's answers: the types a cluster's lists page, and the ones its Home pages.
const CLUSTER_PAGES = ['pod', 'configmap'];
const HOME_PAGES = ['management.cattle.io.cluster'];

const store = { getters: { some: 'getters' }, $extension: { some: 'extensions' } } as unknown as VuexStore;

const pagedIn = (inStore: string) => pagedStores[inStore]?.resources.enableSome?.enabled;
const ours = (resource: string) => ({ resource, context: [PAGINATION_CONTEXT] });

describe('which of a widget\'s tables the server pages', () => {
  beforeEach(() => {
    Object.keys(pagedStores).forEach((name) => delete pagedStores[name]);
    mockIsEnabled.mockReset().mockImplementation((_ctx, { store: inStore, resource }) => (inStore === 'cluster' ? CLUSTER_PAGES.includes(resource.id) : resource.context === 'home' && HOME_PAGES.includes(resource.id)));
  });

  it("pages a type in another cluster's store where the type's list in a cluster is paged, under the package's own context", () => {
    pageLikeItsList(store, 'cv-c-1', 'pod');
    pageLikeItsList(store, 'cv-c-1', 'namespace');
    pageLikeItsList(store, 'cv-c-1', 'management.cattle.io.cluster');

    expect(pagedIn('cv-c-1')).toStrictEqual([ours('pod')]);
    expect(mockIsEnabled).toHaveBeenCalledWith({ rootGetters: store.getters, $extension: store.$extension }, { store: 'cluster', resource: { id: 'pod', context: undefined } });
  });

  it("pages Rancher's own types the same way, and its clusters where the shell's Home pages them", () => {
    pageLikeItsList(store, 'management', 'configmap');
    pageLikeItsList(store, 'management', 'management.cattle.io.cluster');
    pageLikeItsList(store, 'management', 'management.cattle.io.user');

    expect(pagedIn('management')).toStrictEqual([ours('configmap'), ours('management.cattle.io.cluster')]);
  });

  it('leaves the open cluster to the shell, and settles each type once', () => {
    pageLikeItsList(store, 'cluster', 'pod');

    expect(pagedStores.cluster).toBeUndefined();
    expect(mockIsEnabled).not.toHaveBeenCalled();

    pageLikeItsList(store, 'cv-c-1', 'pod');
    pageLikeItsList(store, 'cv-c-1', 'pod');

    expect(pagedIn('cv-c-1')).toStrictEqual([ours('pod')]);
  });
});
