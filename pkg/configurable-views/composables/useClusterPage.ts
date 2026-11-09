import { ref, useId, watch, type Ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { fetchClusterPage, type SteveSort } from '../templating/widget-data';
import { readChange } from './useClusterChanges';
import type { ResourceRow } from '../templating/types';

export interface ClusterPageQuery {
  resource: string;
  /** '' reads nothing: the widget has no cluster to read from. */
  cluster: string;
  perPage: number;
  /** A fixed order, as Steve fields. */
  sort?: SteveSort[];
}

/**
 * A type from one named cluster, a page at a time - the server pages, the table shows it.
 *
 * `load` is what a ResourceTable's `pagination-changed` calls. That event fires when the table
 * MOUNTS as well, on top of the query's own first load, so the same request would be made twice;
 * each request is keyed by everything it depends on and an identical one is not repeated (a failed
 * one clears the key, so asking again really asks again).
 */
export function useClusterPage(query: () => ClusterPageQuery) {
  const store = useStore();
  const { t } = useI18n(store);
  const rows: Ref<ResourceRow[]> = ref([]);
  const count = ref(0);
  const loading = ref(false);
  const error = ref('');
  const page = ref(1);
  let lastKey = '';
  let lastPageSize = 0;
  /** The type's revision the rows were read at. */
  let revision: string | undefined;
  // This list's reads after a change, apart from every other's (see readChange).
  const reader = useId();

  async function load(pagination?: { page?: number; perPage?: number }): Promise<void> {
    const q = query();

    if (!q.cluster) {
      rows.value = [];
      count.value = 0;

      return;
    }

    const pageNo = pagination?.page || page.value;
    const pageSize = pagination?.perPage || q.perPage;
    const key = JSON.stringify([q.resource, q.cluster, q.sort || [], pageNo, pageSize]);

    if (key === lastKey) {
      return;
    }

    lastKey = key;
    lastPageSize = pageSize;
    revision = undefined;
    page.value = pageNo;
    loading.value = true;
    error.value = '';

    try {
      const res = await fetchClusterPage(store, {
        resource: q.resource,
        cluster:  q.cluster,
        page:     pageNo,
        pageSize,
        sort:     q.sort,
      });

      rows.value = res.rows;
      count.value = res.count;
      revision = res.revision;
    } catch (e) {
      rows.value = [];
      count.value = 0;
      lastKey = '';
      error.value = (e as Error)?.message || t('configurableViews.errors.resource', { resource: q.resource, cluster: q.cluster });
    } finally {
      loading.value = false;
    }
  }

  /**
   * Ask the same question again, because the answer has changed - at `changedAt`, the revision it changed
   * at, when that is known. In place: nothing shows as loading, and a read that fails leaves the rows as
   * they are.
   */
  async function refresh(changedAt?: string): Promise<void> {
    const q = query();
    const asked = lastKey;

    if (!q.cluster || !asked || loading.value) {
      return;
    }

    try {
      const res = await readChange({
        id:       `configurable-views/${ q.cluster }/${ q.resource }/${ reader }`,
        revision: changedAt,
        last:     revision,
        read:     (at) => fetchClusterPage(store, {
          resource: q.resource,
          cluster:  q.cluster,
          page:     page.value,
          pageSize: lastPageSize,
          sort:     q.sort,
          revision: at,
        }),
      });

      if (res && asked === lastKey) {
        rows.value = res.rows;
        count.value = res.count;
        revision = res.revision;
      }
    } catch (e) {}
  }

  // A different question starts again at page one.
  watch(() => JSON.stringify(query()), () => {
    page.value = 1;
    load();
  }, { immediate: true });

  return {
    rows, count, loading, error, load, refresh
  };
}
