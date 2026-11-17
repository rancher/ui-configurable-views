import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { StorePageQuery } from '@pkg/configurable-views/composables/useStorePage';
import { useTablePage } from '@pkg/configurable-views/composables/useTablePage';

let mockQuery: () => StorePageQuery;

// What the page asks its store for, kept to be read back.
jest.mock('@pkg/configurable-views/composables/useStorePage', () => {
  const { ref: mockRef } = jest.requireActual('vue');

  return {
    useStorePage: (query: () => StorePageQuery) => {
      mockQuery = query;

      return {
        rows: mockRef([]), count: mockRef(0), loading: mockRef(false), error: mockRef(''), args: mockRef(null)
      };
    },
  };
});

function tablePage() {
  const pageSize = ref(10);
  let page!: ReturnType<typeof useTablePage>;

  mount(defineComponent({
    setup() {
      page = useTablePage(() => ({
        inStore: 'cv-c-2', type: 'pod', pageSize: pageSize.value
      }));

      return () => null;
    },
  }));

  return { page, pageSize };
}

describe('a paged table\'s own page', () => {
  it('starts again at the first page when the number of rows changes', async() => {
    const { page, pageSize } = tablePage();

    page.load({ page: 3, sort: ['metadata.name'] });
    pageSize.value = 25;
    await nextTick();

    expect(mockQuery()).toMatchObject({
      page: 1, pageSize: 25, sort: [{ field: 'metadata.name', asc: true }]
    });
  });

  it('reads nothing after a reset until the table asks again', async() => {
    const { page } = tablePage();

    page.load({
      page: 2, sort: ['metadata.name'], descending: true
    });
    await nextTick();

    expect(page.asked.value).toBe(true);
    expect(mockQuery()).toMatchObject({ inStore: 'cv-c-2', page: 2 });

    page.reset();
    await nextTick();

    expect(page.asked.value).toBe(false);
    expect(mockQuery()).toStrictEqual({
      inStore: '', type: 'pod', page: 1, pageSize: 10, sort: [], filters: []
    });
  });
});
