import { decodeServerEvent, encodeEvent, type ClientEvent, type ServerEvent } from '@huddle/core';

type Listener = (event: ServerEvent) => void;

/**
 * `connecting` covers both the first attempt and every retry, because to a
 * reader they are the same thing: messages are not arriving right now.
 */
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

type StatusListener = (status: ConnectionStatus) => void;

const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000, 20_000];
const PING_INTERVAL_MS = 25_000;

/**
 * One socket for the whole app, multiplexed across channels.
 *
 * Reconnect is the only sync path there is: on every open the client resends
 * `subscribe` with the last sequence it holds per channel, and the server
 * replays the delta. A backgrounded phone, a dropped train connection and a
 * server restart are therefore the same case, handled once.
 */
export class Realtime {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<StatusListener>();
  private status: ConnectionStatus = 'connecting';
  private readonly cursors = new Map<string, number>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  connect(): void {
    if (this.stopped || this.socket) return;
    this.setStatus('connecting');

    const url = new URL('/api/realtime', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.setStatus('open');
      for (const [channelId, lastSeq] of this.cursors) {
        this.send({ type: 'subscribe', channelId, lastSeq });
      }
      this.pinger = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
    });

    socket.addEventListener('message', (message) => {
      const event = decodeServerEvent(String(message.data));
      if (!event) return;

      // The cursor is kept here rather than in a component, so a reconnect
      // resumes correctly even while the channel is not on screen.
      if (event.type === 'message') this.advance(event.channelId, event.message.seq);
      if (event.type === 'synced') this.advance(event.channelId, event.seq);

      for (const listener of this.listeners) listener(event);
    });

    socket.addEventListener('close', () => this.retry());
    socket.addEventListener('error', () => socket.close());
  }

  stop(): void {
    this.stopped = true;
    this.setStatus('closed');
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    // Called at once, so a subscriber does not have to wait for a change to
    // learn what is already true.
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(channelId: string, lastSeq: number): void {
    this.cursors.set(channelId, Math.max(lastSeq, this.cursors.get(channelId) ?? 0));
    this.send({ type: 'subscribe', channelId, lastSeq: this.cursors.get(channelId) ?? 0 });
  }

  unsubscribe(channelId: string): void {
    this.cursors.delete(channelId);
    this.send({ type: 'unsubscribe', channelId });
  }

  send(event: ClientEvent): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeEvent(event));
  }

  private advance(channelId: string, seq: number): void {
    if (seq > (this.cursors.get(channelId) ?? 0)) this.cursors.set(channelId, seq);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private retry(): void {
    this.clearTimers();
    this.socket = null;
    if (this.stopped) return;

    this.setStatus('connecting');

    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 20_000;
    this.attempt += 1;
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private clearTimers(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.pinger !== null) clearInterval(this.pinger);
    this.timer = null;
    this.pinger = null;
  }
}
