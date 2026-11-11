import {
  onBeforeUnmount, ref, useId, watch, type Ref
} from 'vue';
import { useStore } from 'vuex';
import PaginationWrapper from '@shell/utils/pagination-wrapper';
import { PaginationArgs, type PaginationParamFilter, type PaginationSort } from '@shell/types/store/pagination.types';
import { PAGINATION_CONTEXT, pageLikeItsList } from '../templating/table-paging';
import type { ResourceRow } from '../templating/types';

export interface StorePageQuery {
  /** The store to read, '' while there is none to read. */
  inStore: string;
  type: string;
  page: number;
  pageSize: number;
  sort?: PaginationSort[];
  filters?: PaginationParamFilter[];
}

/**
 * A page of a type from one store, kept live.
 *
 * Read through the shell's PaginationWrapper, which asks the store for the page without keeping it there, so
 * it is this widget's own, and a table of the same type showing another page is left as it is. The wrapper
 * listens through the store's own socket, and the page is read again when the type changes, by the shell's
 * rules for that.
 */
export function useStorePage<T extends object = ResourceRow>(query: () => StorePageQuery) {
  const store = useStore();
  const rows: Ref<T[]> = ref([]);
  const count = ref(0);
  const loading = ref(false);
  /** Why the last read failed, '' when it did not. */
  const error = ref('');
  // This widget's reads and listening, apart from every other's.
  const reader = useId();
  let wrapper: PaginationWrapper<T> | null = null;
  let wrapperFor = '';

  const asked = () => JSON.stringify(query());

  /** The wrapper for the store and type asked about, made again when either changes. */
  function wrapperOf(q: StorePageQuery): PaginationWrapper<T> {
    const key = `${ q.inStore }/${ q.type }`;

    if (!wrapper || wrapperFor !== key) {
      wrapper?.onDestroy();
      // The wrapper asks the shell whether the type pages there as it is made.
      pageLikeItsList(store, q.inStore, q.type);
      wrapper = new PaginationWrapper<T>({
        $store:         store,
        id:             `configurable-views-${ reader }-${ key }`,
        enabledFor:     { store: q.inStore, resource: { id: q.type, context: PAGINATION_CONTEXT } },
        onChange:       ({ revision }) => refresh(revision),
        formatResponse: { classify: true },
      });
      wrapperFor = key;
    }

    return wrapper;
  }

  function request(q: StorePageQuery, revision?: string) {
    return wrapperOf(q).request({
      pagination: new PaginationArgs({
        page: q.page, pageSize: q.pageSize, sort: q.sort || [], filters: q.filters || []
      }),
      revision,
    });
  }

  async function load(): Promise<void> {
    const q = query();
    const question = asked();

    error.value = '';

    if (!q.inStore || !q.type) {
      rows.value = [];
      count.value = 0;
      loading.value = false;

      return;
    }

    loading.value = true;

    try {
      const res = await request(q);

      // Asked again in the meantime: that answer is the one to keep.
      if (question === asked()) {
        rows.value = res.data as T[];
        count.value = res.pagination?.result?.count ?? res.data.length;
      }
    } catch (e) {
      if (question === asked()) {
        rows.value = [];
        count.value = 0;
        error.value = (e as Error)?.message || `${ e }`;
      }
    } finally {
      if (question === asked()) {
        loading.value = false;
      }
    }
  }

  /**
   * Read the same page again, because the type changed - at `revision`, the revision it changed at. In place:
   * nothing shows as loading, and a read that fails leaves the rows as they are.
   */
  async function refresh(revision?: string): Promise<void> {
    const q = query();
    const question = asked();

    if (!q.inStore || !q.type || loading.value) {
      return;
    }

    try {
      const res = await request(q, revision);

      if (question === asked()) {
        rows.value = res.data as T[];
        count.value = res.pagination?.result?.count ?? res.data.length;
      }
    } catch (e) {}
  }

  watch(asked, () => load(), { immediate: true });

  onBeforeUnmount(() => wrapper?.onDestroy());

  return {
    rows, count, loading, error
  };
}
