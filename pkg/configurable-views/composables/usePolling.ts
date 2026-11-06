import { onBeforeUnmount, onMounted } from 'vue';

/** Call `poll` every so often, for as long as the widget is there, and not while the tab is hidden. */
export function usePolling(poll: () => void, ms: number): void {
  let timer: ReturnType<typeof setInterval> | undefined;

  onMounted(() => {
    timer = setInterval(() => {
      if (!document.hidden) {
        poll();
      }
    }, ms);
  });

  onBeforeUnmount(() => clearInterval(timer));
}
