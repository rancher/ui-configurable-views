import { onBeforeUnmount, watch } from 'vue';
import Socket, { EVENT_CONNECTED, EVENT_MESSAGE } from '@shell/utils/socket';

// Hearing that a type has changed in a cluster that is not the open one.
//
// The stores only hold sockets to Rancher and to the open cluster. So a widget naming another cluster
// listens here: one small socket per cluster, shared by its widgets, told only THAT a type changed.
// The widget then reads for itself. Nothing goes into a store, so the app's current cluster stays put.

const MODE = 'resource.changes';

/** A table can read 500 rows on each change, so changes come less often than the 4 seconds the shell asks for. */
const DEBOUNCE_MS = 10000;

/** How long to wait before listening again when the server ends a watch, as it does now and then. */
const RESTART_MS = 5000;

interface Feed {
  socket: Socket;
  listeners: Map<string, Set<() => void>>;
  /** Types the server said no to, which are not asked for again until the socket reconnects. */
  refused: Set<string>;
  /** Types that changed while the tab was hidden, told when it shows again. */
  missed: Set<string>;
}

const feeds = new Map<string, Feed>();

function start(feed: Feed, type: string): void {
  feed.socket.send(JSON.stringify({
    resourceType: type, mode: MODE, debounceMs: DEBOUNCE_MS
  }));
}

function changed(feed: Feed, type: string): void {
  if (document.hidden) {
    feed.missed.add(type);
  } else {
    feed.listeners.get(type)?.forEach((listener) => listener());
  }
}

function onVisibility(): void {
  if (document.hidden) {
    return;
  }

  feeds.forEach((feed) => {
    const missed = [...feed.missed];

    feed.missed.clear();
    missed.forEach((type) => changed(feed, type));
  });
}

function onMessage(feed: Feed, data: string): void {
  let msg: { name?: string; resourceType?: string };

  try {
    msg = JSON.parse(data);
  } catch (e) {
    return;
  }

  const type = msg.resourceType;

  if (!type || !feed.listeners.has(type)) {
    return;
  }

  if (msg.name === MODE) {
    changed(feed, type);
  } else if (msg.name === 'resource.error') {
    feed.refused.add(type);
  } else if (msg.name === 'resource.stop' && !feed.refused.has(type)) {
    setTimeout(() => {
      if (feed.listeners.has(type)) {
        start(feed, type);
      }
    }, RESTART_MS);
  }
}

function feedFor(cluster: string): Feed {
  const known = feeds.get(cluster);

  if (known) {
    return known;
  }

  const socket = new Socket(`/k8s/clusters/${ encodeURIComponent(cluster) }/v1/subscribe`);
  const feed: Feed = {
    socket, listeners: new Map(), refused: new Set(), missed: new Set()
  };

  socket.addEventListener(EVENT_CONNECTED, () => {
    feed.refused.clear();
    [...feed.listeners.keys()].forEach((type) => {
      start(feed, type);

      // Whatever changed while it was away went unheard.
      if (socket.hasReconnected) {
        changed(feed, type);
      }
    });
  });
  socket.addEventListener(EVENT_MESSAGE, (e) => onMessage(feed, (e as unknown as CustomEvent<{ data: string }>).detail.data));
  socket.connect();

  if (!feeds.size) {
    document.addEventListener('visibilitychange', onVisibility);
  }

  feeds.set(cluster, feed);

  return feed;
}

function listen(cluster: string, type: string, listener: () => void): () => void {
  const feed = feedFor(cluster);
  const listeners = feed.listeners.get(type) || new Set();

  if (!listeners.size) {
    feed.listeners.set(type, listeners);
    start(feed, type);
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    if (listeners.size) {
      return;
    }

    feed.listeners.delete(type);
    feed.missed.delete(type);
    feed.socket.send(JSON.stringify({
      resourceType: type, mode: MODE, stop: true
    }));

    if (!feed.listeners.size) {
      feed.socket.disconnect().catch(() => undefined);
      feeds.delete(cluster);

      if (!feeds.size) {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    }
  };
}

/**
 * Call `onChange` whenever `type` changes in `cluster`, for as long as the widget is there. An empty
 * cluster listens to nothing, which is how a widget says the open cluster's store is keeping it live.
 */
export function useClusterChanges(what: () => { cluster: string; type: string }, onChange: () => void): void {
  let stop: (() => void) | null = null;

  watch(() => JSON.stringify(what()), () => {
    const { cluster, type } = what();

    stop?.();
    stop = cluster && type ? listen(cluster, type, onChange) : null;
  }, { immediate: true });

  onBeforeUnmount(() => stop?.());
}
