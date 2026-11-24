import {
  defineComponent, h, nextTick, ref, type Ref
} from 'vue';
import { mount } from '@vue/test-utils';
import { usePolledLoad, type PolledRead } from '@pkg/configurable-views/composables/usePolledLoad';

// Real promises, fake intervals: the reads are settled by hand, the refreshes by the clock.
const settle = async() => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
  await nextTick();
};

/** A read that waits until the test ends it - to see what happens while it is in flight. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  return {
    promise, resolve, reject
  };
}

function host(load: (read: PolledRead) => Promise<boolean | void>, source?: Ref<string>) {
  let loading!: Ref<boolean>;

  const wrapper = mount(defineComponent({
    setup() {
      ({ loading } = usePolledLoad(load, { ms: 1000, source }));

      return () => h('div');
    },
  }));

  return { wrapper, loading: () => loading.value };
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('usePolledLoad', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    setHidden(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads at once with the spinner on, then refreshes quietly every interval', async() => {
    const first = deferred();
    const load = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { loading } = host(load);

    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0].fresh).toBe(true);
    expect(loading()).toBe(true);

    first.resolve();
    await settle();
    expect(loading()).toBe(false);

    jest.advanceTimersByTime(1000);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0].fresh).toBe(false);
    expect(loading()).toBe(false);
  });

  it('lets only the latest read land, and keeps the spinner on until that one ends', async() => {
    const source = ref('a');
    const reads = [deferred(), deferred()];
    const seen: PolledRead[] = [];
    const load = jest.fn((read: PolledRead) => {
      seen.push(read);

      return reads[seen.length - 1].promise;
    });
    const { loading } = host(load, source);

    await settle();
    source.value = 'b';
    await settle();
    expect(load).toHaveBeenCalledTimes(2);

    // The older read ends first: it is not current, and must not turn the spinner off
    reads[0].resolve();
    await settle();
    expect(seen[0].current()).toBe(false);
    expect(loading()).toBe(true);

    reads[1].resolve();
    await settle();
    expect(seen[1].current()).toBe(true);
    expect(loading()).toBe(false);
  });

  it('does not refresh while the tab is hidden, and reads at once when it is back', async() => {
    const load = jest.fn().mockResolvedValue(undefined);

    host(load);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    setHidden(true);
    jest.advanceTimersByTime(5000);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    setHidden(false);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1000);
    await settle();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('stops refreshing once a read says there is nothing more to read, until the source changes', async() => {
    const source = ref('gone');
    const load = jest.fn(async() => (source.value === 'gone' ? false : undefined));

    host(load, source);
    await settle();
    jest.advanceTimersByTime(5000);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    // Back in view changes nothing either: there is still nothing to read
    setHidden(true);
    setHidden(false);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    source.value = 'there';
    await settle();
    expect(load).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1000);
    await settle();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('keeps refreshing after a read that throws, and the spinner goes off', async() => {
    const load = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const { loading } = host(load);

    await settle();
    expect(loading()).toBe(false);

    jest.advanceTimersByTime(1000);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('stops for good when the widget goes', async() => {
    const load = jest.fn().mockResolvedValue(undefined);
    const { wrapper } = host(load);

    await settle();
    wrapper.unmount();
    jest.advanceTimersByTime(5000);
    setHidden(false);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
