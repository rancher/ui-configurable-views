import { computed, ref, watch } from 'vue';
import type { PaginationParamFilter, PaginationSort } from '@shell/types/store/pagination.types';
import { useStorePage } from './useStorePage';
import type { ResourceRow } from '../templating/types';

/** What a paged table asks for with `pagination-changed`: its page, the fields of the column it sorts by, and its query. */
export interface TablePageAsk {
  page: number;
  sort?: string[];
  descending?: boolean;
  /** The table views query, already as the server's filters. */
  viewFilters?: PaginationParamFilter[];
}

export interface TablePageOf {
  /** The store to read, '' while there is none to read. */
  inStore: string;
  type: string;
  pageSize: number;
}

/**
 * A paged table's own page of a type, read as the table asks for it: what the shell's paged lists do for their
 * tables, for a table drawn on its own. The page is this table's alone (see useStorePage), so two tables of one type
 * page apart. Nothing is read until the table has asked, as it does once it is drawn.
 */
export function useTablePage<T extends object = ResourceRow>(of: () => TablePageOf) {
  const page = ref(1);
  // The order the table asks for, null until it has.
  const sort = ref<PaginationSort[] | null>(null);
  const filters = ref<PaginationParamFilter[]>([]);

  const read = useStorePage<T>(() => {
    const { inStore, type, pageSize } = of();

    return {
      inStore: sort.value ? inStore : '',
      type,
      page:    page.value,
      pageSize,
      sort:    sort.value || [],
      filters: filters.value,
    };
  });

  /** Whether the table has asked for a page. */
  const asked = computed(() => !!sort.value);

  // A result for each read, as the shell's lists give their tables one, to go with the args it was read with.
  const result = computed(() => (read.args.value ? { count: read.count.value } : null));

  // A different number of rows starts again at the first page.
  watch(() => of().pageSize, () => {
    page.value = 1;
  });

  /** Read the page, order and query the table asks for. */
  function load({
    page: wanted, sort: fields = [], descending, viewFilters = []
  }: TablePageAsk): void {
    page.value = wanted;
    sort.value = fields.map((field) => ({ field, asc: !descending }));
    filters.value = viewFilters;
  }

  /** Read nothing until the table asks again: for a table built anew, which asks for its first page. */
  function reset(): void {
    page.value = 1;
    sort.value = null;
    filters.value = [];
  }

  return {
    ...read, asked, result, load, reset
  };
}
