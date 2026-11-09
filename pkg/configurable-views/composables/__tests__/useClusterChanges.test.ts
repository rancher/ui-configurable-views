import { defineComponent, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { STEVE_RESPONSE_CODE } from '@shell/types/rancher/steve.api';
import { readChange, useClusterChanges } from '@pkg/configurable-views/composables/useClusterChanges';

interface FakeSocket {
  url: string;
  sent: object[];
  connected: boolean;
  disconnected: boolean;
  hasReconnected: boolean;
  fire(event: string, detail?: object): void;
}

const mockSockets: FakeSocket[] = [];

jest.mock('@shell/utils/socket', () => {
  class Socket {
    sent: object[] = [];
    connected = false;
    disconnected = false;
    hasReconnected = false;
    handlers: Record<string, (e: { detail?: object }) => void> = {};

    constructor(public url: string) {
      mockSockets.push(this as unknown as FakeSocket);
    }

    addEventListener(event: string, fn: (e: { detail?: object }) => void) {
      this.handlers[event] = fn;
    }

    connect() {
      this.connected = true;
    }

    send(data: string) {
      this.sent.push(JSON.parse(data));

      return true;
    }

    disconnect() {
      this.disconnected = true;

      return Promise.resolve();
    }

    fire(event: string, detail?: object) {
      this.handlers[event]({ detail });
    }
  }

  return {
    __esModule: true, default: Socket, EVENT_CONNECTED: 'connected', EVENT_MESSAGE: 'message'
  };
});

jest.mock('vuex', () => ({ ...jest.requireActual('vuex'), useStore: () => ({ getters: {} }) }));
// The UI performance setting's wait between change messages.
jest.mock('@shell/utils/pagination-utils', () => ({ __esModule: true, default: { resourceChangesDebounceMs: () => 4000 } }));

describe('useClusterChanges', () => {
  const wrappers: { unmount(): void }[] = [];

  function listening(cluster: string | Ref<string>, type: string, onChange = jest.fn()) {
    const from = typeof cluster === 'string' ? ref(cluster) : cluster;
    const wrapper = mount(defineComponent({
      setup() {
        useClusterChanges(() => ({ cluster: from.value, type }), onChange);

        return () => null;
      }
    }));

    wrappers.push(wrapper);

    return { wrapper, onChange };
  }

  const frame = (socket: FakeSocket, name: string, resourceType: string, revision?: string) => socket.fire('message', {
    data: JSON.stringify({
      name, resourceType, revision
    })
  });

  const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });

  beforeEach(() => {
    mockSockets.length = 0;
    setHidden(false);
  });

  afterEach(() => {
    wrappers.splice(0).forEach((w) => w.unmount());
    jest.useRealTimers();
  });

  it('asks for one type on that cluster\'s own socket, for changes only, as often as the shell\'s lists hear of them', () => {
    listening('c/1', 'pod');

    expect(mockSockets).toHaveLength(1);
    expect(mockSockets[0].url).toBe('/k8s/clusters/c%2F1/v1/subscribe');
    expect(mockSockets[0].connected).toBe(true);
    expect(mockSockets[0].sent).toStrictEqual([{
      resourceType: 'pod', mode: 'resource.changes', debounceMs: 4000
    }]);
  });

  it('tells the widgets the revision the type changed at', () => {
    const { onChange } = listening('c-1', 'pod');

    frame(mockSockets[0], 'resource.changes', 'pod', '42');

    expect(onChange).toHaveBeenCalledWith('42');
  });

  it('shares one socket and one subscription between the widgets of a cluster, and tells each', () => {
    const first = listening('c-1', 'pod');
    const second = listening('c-1', 'pod');
    const other = listening('c-1', 'event');

    expect(mockSockets).toHaveLength(1);
    expect(mockSockets[0].sent).toHaveLength(2);

    frame(mockSockets[0], 'resource.changes', 'pod');

    expect(first.onChange).toHaveBeenCalledTimes(1);
    expect(second.onChange).toHaveBeenCalledTimes(1);
    expect(other.onChange).not.toHaveBeenCalled();
  });

  it('keeps clusters apart', () => {
    listening('c-1', 'pod');
    listening('c-2', 'pod');

    expect(mockSockets.map((s) => s.url)).toStrictEqual(['/k8s/clusters/c-1/v1/subscribe', '/k8s/clusters/c-2/v1/subscribe']);
  });

  it('asks again a little after the server ends a watch', () => {
    jest.useFakeTimers();
    listening('c-1', 'pod');

    frame(mockSockets[0], 'resource.stop', 'pod');
    expect(mockSockets[0].sent).toHaveLength(1);

    jest.advanceTimersByTime(5000);
    expect(mockSockets[0].sent).toHaveLength(2);
  });

  it('does not ask again for a type the server refused', () => {
    jest.useFakeTimers();
    listening('c-1', 'pod');

    frame(mockSockets[0], 'resource.error', 'pod');
    frame(mockSockets[0], 'resource.stop', 'pod');
    jest.advanceTimersByTime(60000);

    expect(mockSockets[0].sent).toHaveLength(1);
  });

  it('asks again and tells the widgets after reconnecting, because changes went unheard', () => {
    const { onChange } = listening('c-1', 'pod');
    const [socket] = mockSockets;

    socket.fire('connected');
    expect(onChange).not.toHaveBeenCalled();

    socket.hasReconnected = true;
    socket.fire('connected');

    expect(socket.sent).toHaveLength(3);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('holds a change while the tab is hidden, and tells it once when it shows, at the last revision', () => {
    const { onChange } = listening('c-1', 'pod');

    setHidden(true);
    frame(mockSockets[0], 'resource.changes', 'pod', '1');
    frame(mockSockets[0], 'resource.changes', 'pod', '2');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onChange).not.toHaveBeenCalled();

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onChange.mock.calls).toStrictEqual([['2']]);
  });

  it('stops a type with its last listener, and closes the socket with its last type', () => {
    const first = listening('c-1', 'pod');
    const second = listening('c-1', 'pod');
    const events = listening('c-1', 'event');
    const [socket] = mockSockets;

    first.wrapper.unmount();
    expect(socket.sent).toHaveLength(2);

    second.wrapper.unmount();
    expect(socket.sent[2]).toStrictEqual({
      resourceType: 'pod', mode: 'resource.changes', stop: true
    });
    expect(socket.disconnected).toBe(false);

    events.wrapper.unmount();
    expect(socket.disconnected).toBe(true);
  });

  it('listens to nothing with no cluster, and moves with the cluster', async() => {
    const cluster = ref('');

    listening(cluster, 'pod');
    expect(mockSockets).toHaveLength(0);

    cluster.value = 'c-1';
    await nextTick();
    expect(mockSockets).toHaveLength(1);

    cluster.value = 'c-2';
    await nextTick();
    expect(mockSockets).toHaveLength(2);
    expect(mockSockets[0].disconnected).toBe(true);
  });
});

describe('reading again after a change', () => {
  // A server that has not caught up with the revision asked for yet.
  const BEHIND = { status: 400, code: STEVE_RESPONSE_CODE.UNKNOWN_REVISION };

  it('asks for the revision the type changed at', async() => {
    const read = jest.fn().mockResolvedValue('rows');

    await expect(readChange({
      id: 'asks', revision: '10', last: '5', read
    })).resolves.toBe('rows');
    expect(read).toHaveBeenCalledWith('10');
  });

  it('lets a change go that is older than what was last read', async() => {
    const read = jest.fn();

    await expect(readChange({
      id: 'older', revision: '4', last: '5', read
    })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('asks again while the server has not caught up with the change, and not after any other error', async() => {
    const read = jest.fn().mockRejectedValueOnce(BEHIND).mockResolvedValue('rows');

    await expect(readChange({
      id: 'behind', revision: '10', read
    })).resolves.toBe('rows');
    expect(read).toHaveBeenCalledTimes(2);

    const failing = jest.fn().mockRejectedValue({ status: 500 });

    await expect(readChange({
      id: 'failing', revision: '10', read: failing
    })).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('lets a newer change replace a read still trying for an older one, and an older change go while a newer is read', async() => {
    const stuck = jest.fn().mockRejectedValue(BEHIND);
    const first = readChange({
      id: 'newer', revision: '10', read: stuck
    });
    const newer = jest.fn().mockResolvedValue('newer rows');

    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(readChange({
      id: 'newer', revision: '11', read: newer
    })).resolves.toBe('newer rows');
    await expect(first).rejects.toThrow();
    expect(stuck).toHaveBeenCalledTimes(1);

    let finish: (value: string) => void = () => undefined;
    const pending = readChange({
      id:       'while',
      revision: '11',
      read:     () => new Promise<string>((resolve) => {
        finish = resolve;
      })
    });
    const older = jest.fn();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(readChange({
      id: 'while', revision: '10', read: older
    })).resolves.toBeUndefined();
    finish('rows');
    await expect(pending).resolves.toBe('rows');
    expect(older).not.toHaveBeenCalled();
  });
});
