import {
  onBeforeUnmount, onMounted, ref, watch, type WatchSource
} from 'vue';

/**
 * What a read is told: whether it is still the latest one, and whether it starts from nothing.
 */
export interface PolledRead {
  /** False once a newer read has started - its answer must not land then. */
  current: () => boolean;
  /** A first read, or one after `source` changed: what the widget showed belongs to something else. */
  fresh: boolean;
}

/**
 * Read now, again whenever `source` changes, and every `ms` after that - not while the tab is hidden,
 * and at once when it is back in view.
 *
 * `loading` is on only for a fresh read, when there is nothing to show yet; the refreshes run without
 * it, so a widget does not flash its spinner every few seconds. It goes off when the latest read ends,
 * whichever kind that is.
 *
 * A read that resolves to `false` says there is nothing more to refresh - the cluster it is about is
 * gone - and the refreshing stops until `source` changes. A read reports its own failures (it sets
 * the widget's error); one that throws is ignored, and the next refresh tries again.
 */
export function usePolledLoad(load: (read: PolledRead) => Promise<boolean | void>, { ms, source }: { ms: number; source?: WatchSource }) {
  const loading = ref(false);
  let asked = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let finished = false;
  let mounted = false;

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start(): void {
    stop();
    if (mounted && !finished && !document.hidden) {
      timer = setInterval(() => run(false), ms);
    }
  }

  async function run(fresh: boolean): Promise<void> {
    const mine = ++asked;
    const current = () => mine === asked;

    if (fresh) {
      loading.value = true;
    }

    try {
      const more = await load({ current, fresh });

      if (current()) {
        finished = more === false;
        if (finished) {
          stop();
        }
      }
    } catch {
      // A read shows its own failure; one that throws anyway must not escape a timer, and the next
      // refresh tries again.
    } finally {
      if (current()) {
        loading.value = false;
      }
    }
  }

  async function reload(): Promise<void> {
    stop();
    finished = false;
    await run(true);
    start();
  }

  function onVisibility(): void {
    if (document.hidden) {
      stop();
    } else if (!finished) {
      run(false);
      start();
    }
  }

  if (source) {
    watch(source, reload);
  }

  onMounted(() => {
    mounted = true;
    document.addEventListener('visibilitychange', onVisibility);
    reload();
  });

  onBeforeUnmount(() => {
    mounted = false;
    asked++;
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  });

  return { loading, reload };
}
