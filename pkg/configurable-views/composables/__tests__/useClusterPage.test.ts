import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useClusterPage } from '@pkg/configurable-views/composables/useClusterPage';

const mockFindPage = jest.fn();

jest.mock('vuex', () => ({
  ...jest.requireActual('vuex'),
  useStore: () => ({
    dispatch: (...args: unknown[]) => mockFindPage(...args),
    getters:  { 'i18n/t': (key: string) => key },
  }),
}));

const answer = (ids: string[], revision?: string) => ({ data: ids.map((id) => ({ id })), pagination: { result: { count: ids.length, revision } } });
const settled = () => new Promise((resolve) => setTimeout(resolve));
// Long enough for a read after a change to be made: the shell's back-off waits a moment before the first.
const readStarted = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('useClusterPage refresh', () => {
  function reading(cluster = 'c-1') {
    const from = ref(cluster);
    let page: ReturnType<typeof useClusterPage> | undefined;

    mount(defineComponent({
      setup() {
        page = useClusterPage(() => ({
          resource: 'pod', cluster: from.value, perPage: 10
        }));

        return () => null;
      }
    }));

    return { page: page as ReturnType<typeof useClusterPage>, from };
  }

  beforeEach(() => mockFindPage.mockReset());

  it('reads the same question again, and shows nothing as loading', async() => {
    mockFindPage.mockResolvedValue(answer(['a']));

    const { page } = reading();

    await settled();
    expect(page.rows.value.map((r) => r.id)).toStrictEqual(['a']);

    mockFindPage.mockResolvedValue(answer(['a', 'b']));

    const refreshed = page.refresh();

    expect(page.loading.value).toBe(false);
    await refreshed;

    expect(page.rows.value.map((r) => r.id)).toStrictEqual(['a', 'b']);
    expect(mockFindPage).toHaveBeenCalledTimes(2);
    expect(mockFindPage.mock.calls[1]).toStrictEqual(mockFindPage.mock.calls[0]);
  });

  it('leaves the rows as they are when a read fails', async() => {
    mockFindPage.mockResolvedValue(answer(['a']));

    const { page } = reading();

    await settled();
    mockFindPage.mockRejectedValue(new Error('503'));
    await page.refresh();

    expect(page.rows.value.map((r) => r.id)).toStrictEqual(['a']);
    expect(page.error.value).toBe('');
  });

  it('drops an answer to a question no longer being asked', async() => {
    mockFindPage.mockResolvedValue(answer(['a']));

    const { page, from } = reading();

    await settled();

    let finish: (value: unknown) => void = () => undefined;

    mockFindPage.mockReturnValueOnce(new Promise((resolve) => {
      finish = resolve;
    }));

    const refreshed = page.refresh();

    await readStarted();
    mockFindPage.mockResolvedValue(answer(['c']));
    from.value = 'c-2';
    await nextTick();
    await settled();

    finish(answer(['old']));
    await refreshed;

    expect(page.rows.value.map((r) => r.id)).toStrictEqual(['c']);
  });

  it('asks for the revision the type changed at, and lets a change older than its rows go', async() => {
    mockFindPage.mockResolvedValue(answer(['a'], '5'));

    const { page } = reading();

    await settled();
    mockFindPage.mockResolvedValue(answer(['a', 'b'], '7'));
    await page.refresh('7');

    expect(mockFindPage.mock.calls[1][1].opt.revision).toBe('7');
    expect(page.rows.value.map((r) => r.id)).toStrictEqual(['a', 'b']);

    await page.refresh('6');

    expect(mockFindPage).toHaveBeenCalledTimes(2);
  });

  it('reads nothing with no cluster', async() => {
    const { page } = reading('');

    await page.refresh();

    expect(mockFindPage).not.toHaveBeenCalled();
  });
});
