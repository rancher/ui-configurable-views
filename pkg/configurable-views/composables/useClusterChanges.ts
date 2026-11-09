import { onBeforeUnmount, watch } from 'vue';
import { useStore } from 'vuex';
import Socket, { EVENT_CONNECTED, EVENT_MESSAGE } from '@shell/utils/socket';
import paginationUtils from '@shell/utils/pagination-utils';
import backOff from '@shell/utils/back-off';
import { SteveRevision } from '@shell/plugins/steve/revision';
import { STEVE_RESPONSE_CODE } from '@shell/types/rancher/steve.api';
import { clusterUrl } from '../templating/widget-data';

// Hearing that a type has changed in a cluster that is not the open one.
//
// A table of another cluster reads a store of its own, which keeps it live (see useClusterStore). The
// widgets that draw another cluster's events, certificates and counts read them for themselves, so they
// listen here: one small socket per cluster, shared by its widgets, told only THAT a type changed, and
// at what revision. The widget then reads again (see readChange). Nothing goes into a store, so the
// app's current cluster stays put.

const MODE = 'resource.changes';

/** How long to wait before listening again when the server ends a watch, as it does now and then. */
const RESTART_MS = 5000;

/** Told that a type changed, with the revision it changed at when the server says. */
type Listener = (revision?: string) => void;

interface Feed {
  socket: Socket;
  /** At most how often the server tells of a type's changes: as often as it tells the shell's lists. */
  debounceMs?: number;
  listeners: Map<string, Set<Listener>>;
  /** Types the server said no to, which are not asked for again until the socket reconnects. */
  refused: Set<string>;
  /** Types that changed while the tab was hidden, told when it shows again, at the last revision. */
  missed: Map<string, string | undefined>;
}

const feeds = new Map<string, Feed>();

function start(feed: Feed, type: string): void {
  feed.socket.send(JSON.stringify({
    resourceType: type, mode: MODE, debounceMs: feed.debounceMs
  }));
}

function changed(feed: Feed, type: string, revision?: string): void {
  if (document.hidden) {
    feed.missed.set(type, revision);
  } else {
    feed.listeners.get(type)?.forEach((listener) => listener(revision));
  }
}

function onVisibility(): void {
  if (document.hidden) {
    return;
  }

  feeds.forEach((feed) => {
    const missed = [...feed.missed];

    feed.missed.clear();
    missed.forEach(([type, revision]) => changed(feed, type, revision));
  });
}

function onMessage(feed: Feed, data: string): void {
  let msg: { name?: string; resourceType?: string; revision?: string };

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
    changed(feed, type, msg.revision);
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

function feedFor(cluster: string, debounceMs?: number): Feed {
  const known = feeds.get(cluster);

  if (known) {
    return known;
  }

  const socket = new Socket(clusterUrl(cluster, 'subscribe'));
  const feed: Feed = {
    socket, debounceMs, listeners: new Map(), refused: new Set(), missed: new Map()
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

function listen(cluster: string, type: string, listener: Listener, debounceMs?: number): () => void {
  const feed = feedFor(cluster, debounceMs);
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
export function useClusterChanges(what: () => { cluster: string; type: string }, onChange: Listener): void {
  const store = useStore();
  const debounceMs = paginationUtils.resourceChangesDebounceMs({ rootGetters: store.getters });
  let stop: (() => void) | null = null;

  watch(() => JSON.stringify(what()), () => {
    const { cluster, type } = what();

    stop?.();
    stop = cluster && type ? listen(cluster, type, onChange, debounceMs) : null;
  }, { immediate: true });

  onBeforeUnmount(() => stop?.());
}

/**
 * Read again after a change, by the rules the shell reads a list again by (its steve store's
 * `fetchPageResources`). The read asks for the revision the type changed at, so a server that has not
 * caught up with the change yet says so, and is asked again, a little later each time, until one has. A
 * change older than what was last read, or is being read, is let go, and a newer one replaces a read
 * still trying for an older one.
 *
 * `id` keeps one widget's reads apart from every other's, and `last` is the revision it last read.
 * Resolves to what was read, or to nothing when the change was let go.
 */
export async function readChange<T>({
  id, revision, last, read
}: { id: string; revision?: string; last?: string; read: (revision?: string) => Promise<T> }): Promise<T | undefined> {
  const target = new SteveRevision(revision);
  const active = new SteveRevision(backOff.getBackOff(id)?.metadata?.revision);
  const current = new SteveRevision(active.revision || last);

  if (current.isNewerThan(target)) {
    return undefined;
  }

  if (target.isNewerThan(active)) {
    backOff.reset(id);
  }

  return backOff.recurse<{ revision?: string }, T>({
    id,
    metadata:        { revision },
    description:     `Reading ${ id } again after a change`,
    continueOnError: async(e) => e?.status === 400 && e?.code === STEVE_RESPONSE_CODE.UNKNOWN_REVISION,
    delayedFn:       () => read(revision),
  });
}
