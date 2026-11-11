import { defineComponent, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useStorePage, type StorePageQuery } from '@pkg/configurable-views/composables/useStorePage';

interface FakeWrapper {
  args: { id: string; enabledFor: object; onChange: (params: { revision?: string }) => void };
  request: jest.Mock;
  onDestroy: jest.Mock;
}

const mockWrappers: FakeWrapper[] = [];
const mockAnswer = jest.fn();
const mockPageLikeItsList = jest.fn();

// The shell's wrapper, as far as the page is concerned: it answers each request, and is told to stop.
jest.mock('@shell/utils/pagination-wrapper', () => ({
  __esModule: true,
  default:    class {
    request = jest.fn((...args: unknown[]) => mockAnswer(...args));

    onDestroy = jest.fn();

    constructor(public args: object) {
      mockWrappers.push(this as unknown as FakeWrapper);
    }
  },
}));
jest.mock('@pkg/configurable-views/templating/table-paging', () => ({
  PAGINATION_CONTEXT: 'the package context',
  pageLikeItsList:    (...args: unknown[]) => mockPageLikeItsList(...args),
}));
jest.mock('vuex', () => ({ ...jest.requireActual('vuex'), useStore: () => ({ the: 'store' }) }));

const answer = (ids: string[], count = ids.length) => ({ data: ids.map((id) => ({ id })), pagination: { result: { count } } });

describe('a page of a type from one store', () => {
  function reading(start: Partial<StorePageQuery> = {}) {
    const query = ref<StorePageQuery>({
      inStore: 'cv-c-1', type: 'event', page: 1, pageSize: 10, ...start
    });
    let page: ReturnType<typeof useStorePage> | undefined;
    const wrapper = mount(defineComponent({
      setup() {
        page = useStorePage(() => query.value);

        return () => null;
      }
    }));

    return {
      page: page as ReturnType<typeof useStorePage>, query, wrapper
    };
  }

  beforeEach(() => {
    mockWrappers.length = 0;
    mockAnswer.mockReset().mockResolvedValue(answer(['a']));
    mockPageLikeItsList.mockReset();
  });

  it("reads the page asked for through the shell's wrapper on that store, under the package's context", async() => {
    mockAnswer.mockResolvedValue(answer(['a'], 30));

    const { page } = reading({ page: 2, sort: [{ field: 'metadata.fields.0', asc: false }] });

    await flushPromises();

    expect(mockPageLikeItsList).toHaveBeenCalledWith({ the: 'store' }, 'cv-c-1', 'event');
    expect(mockWrappers).toHaveLength(1);
    expect(mockWrappers[0].args.enabledFor).toStrictEqual({ store: 'cv-c-1', resource: { id: 'event', context: 'the package context' } });
    expect(mockWrappers[0].request).toHaveBeenCalledWith({
      pagination: expect.objectContaining({
        page: 2, pageSize: 10, sort: [{ field: 'metadata.fields.0', asc: false }], filters: []
      }),
      revision: undefined,
    });
    expect(page.rows.value).toStrictEqual([{ id: 'a' }]);
    expect(page.count.value).toBe(30);
    expect(page.loading.value).toBe(false);
  });

  it('reads the same page again in place when the type changes, at the revision it changed at', async() => {
    const { page } = reading();

    await flushPromises();
    mockAnswer.mockResolvedValue(answer(['a', 'b']));
    mockWrappers[0].args.onChange({ revision: '42' });

    expect(page.loading.value).toBe(false);
    await flushPromises();

    expect(mockWrappers[0].request.mock.calls[1][0].revision).toBe('42');
    expect(page.rows.value.map((r) => (r as { id: string }).id)).toStrictEqual(['a', 'b']);
  });

  it('leaves the rows as they are when a read after a change fails, and says why a first read failed', async() => {
    const { page } = reading();

    await flushPromises();
    mockAnswer.mockRejectedValue(new Error('503'));
    mockWrappers[0].args.onChange({ revision: '42' });
    await flushPromises();

    expect(page.rows.value).toStrictEqual([{ id: 'a' }]);
    expect(page.error.value).toBe('');

    const failed = reading({ type: 'secret' });

    await flushPromises();

    expect(failed.page.rows.value).toStrictEqual([]);
    expect(failed.page.error.value).toBe('503');
  });

  it('keeps the answer to the question asked last', async() => {
    let finish: (value: unknown) => void = () => undefined;

    mockAnswer.mockReturnValueOnce(new Promise((resolve) => {
      finish = resolve;
    }));

    const { page, query } = reading();

    await nextTick();
    mockAnswer.mockResolvedValue(answer(['page two']));
    query.value = { ...query.value, page: 2 };
    await flushPromises();
    finish(answer(['page one']));
    await flushPromises();

    expect(page.rows.value).toStrictEqual([{ id: 'page two' }]);
  });

  it('reads nothing with no store, and stops listening for one store or type when it moves to another, and when it goes', async() => {
    const { page, query, wrapper } = reading({ inStore: '' });

    await flushPromises();
    expect(mockWrappers).toHaveLength(0);
    expect(page.rows.value).toStrictEqual([]);

    query.value = { ...query.value, inStore: 'cv-c-1' };
    await flushPromises();
    query.value = { ...query.value, type: 'secret' };
    await flushPromises();

    expect(mockWrappers).toHaveLength(2);
    expect(mockWrappers[0].onDestroy).toHaveBeenCalledTimes(1);
    expect(mockWrappers[0].args.id).not.toBe(mockWrappers[1].args.id);

    wrapper.unmount();

    expect(mockWrappers[1].onDestroy).toHaveBeenCalledTimes(1);
  });
});
