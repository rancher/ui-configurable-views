import { ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import coreStore from '@shell/plugins/dashboard-store';
import { SteveFactory, steveStoreInit } from '@shell/plugins/steve';
import { keyForSubscribe } from '@shell/plugins/steve/resourceWatcher';
import { EVENT_CONNECTED } from '@shell/utils/socket';
import type { VuexStore } from '@shell/types/store/vuex';
import { clusterUrl } from '../templating/widget-data';

// A store of the package's own for a cluster that is not the open one.
//
// The shell's `cluster` store holds one cluster, the open one, and loading another into it would switch
// the whole app's current cluster under the user. So a table of another cluster reads a store made for
// that cluster as the shell makes `cluster`, pointed at that cluster's API: the table is the stock one,
// its toolbar asks the right cluster, and the store's own socket keeps it live. The other widgets that
// read another cluster - its events, certificates and counts - read through the same store. Each is made
// the first time a widget asks for its cluster, and kept for the session, as the shell keeps its own
// stores; a log out closes them all (see forgetClusterStores).

const ready = new Map<string, Promise<string>>();

export const clusterStoreName = (cluster: string): string => `cv-${ cluster }`;

/**
 * The shell's steve store, with two things it takes for granted, that there is one store per kind of
 * API, put right. It keeps track of the reads it makes after a change by type alone, so two stores paging
 * one type would share that, and a change in one cluster be dropped as older than another cluster's; here
 * it is kept by store as well. And it asks the socket that opened last, whichever store's that is, whether
 * such a read can go ahead; here each store asks its own, and the shell's own socket stays the one the
 * shell asks.
 */
function clusterStoreModule(name: string, baseUrl: string) {
  const steve = SteveFactory(name, baseUrl);
  const { opened } = steve.actions;

  return {
    ...steve,
    getters: {
      ...steve.getters,
      backOffId:  () => (obj: object, postFix?: string) => `${ name }:${ keyForSubscribe(obj) }${ postFix ? `:detail=${ postFix }` : '' }`,
      canBackoff: (state: { socket?: { state: string } }) => () => state.socket?.state === EVENT_CONNECTED,
    },
    actions: {
      ...steve.actions,
      async opened(this: { $socket?: unknown }, ctx: Parameters<typeof opened>[0], event: unknown) {
        const shared = this.$socket;

        await opened.call(this, ctx, event);

        if (shared) {
          this.$socket = shared;
        }
      },
    },
  };
}

/** The name of the store holding `cluster`: made and loaded the first time it is asked for. */
export function clusterStore(store: VuexStore, cluster: string): Promise<string> {
  const name = clusterStoreName(cluster);
  const known = ready.get(name);

  if (known) {
    return known;
  }

  const loading = (async() => {
    if (!store.hasModule(name)) {
      const baseUrl = clusterUrl(cluster, '').replace(/\/$/, '');

      coreStore(clusterStoreModule(name, baseUrl), {
        namespace: name, baseUrl, supportsStream: false, isClusterStore: true
      }, steveStoreInit)(store);
    }

    await store.dispatch(`${ name }/loadSchemas`, true);
    store.dispatch(`${ name }/subscribe`);

    return name;
  })();

  ready.set(name, loading);
  loading.catch(() => ready.delete(name));

  return loading;
}

/**
 * The store holding `cluster`, for a widget: its name, '' while it is made or when there is no cluster to
 * read, and why it could not be made.
 */
export function useClusterStore(cluster: () => string) {
  const store = useStore();
  const { t } = useI18n(store);
  const name = ref('');
  const error = ref('');

  watch(cluster, async(from) => {
    name.value = '';
    error.value = '';

    if (!from) {
      return;
    }

    try {
      const made = await clusterStore(store, from);

      // Asked again in the meantime: that answer is the one to keep.
      if (cluster() === from) {
        name.value = made;
      }
    } catch (e) {
      if (cluster() === from) {
        error.value = t('configurableViews.errors.cluster', { cluster: from });
      }
    }
  }, { immediate: true });

  return { name, error };
}

/**
 * At a log out, close them all as the shell closes its own: whoever logs in next reads each cluster again,
 * as themselves.
 */
export async function forgetClusterStores(store: VuexStore): Promise<void> {
  const names = [...ready.keys()];

  ready.clear();

  await Promise.all(names.map(async(name) => {
    await store.dispatch(`${ name }/unsubscribe`);
    store.commit(`${ name }/reset`);
  }));
}
