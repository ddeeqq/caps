import type {
  Ack,
  ClientToServerEvents,
  HostCommand,
  ReactionKind,
  RoomState,
  ServerToClientEvents,
  ViewEnvelope,
} from '@caps/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ClockSync } from './clock';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface ClientSnapshot {
  room: RoomState | null;
  view: ViewEnvelope | null;
  connected: boolean;
  kicked: boolean;
  closed: string | null;
}

export interface ReactionEvent {
  id: number;
  kind: ReactionKind;
  color: string;
  nickname: string;
}

type AckOf<E extends keyof ClientToServerEvents> = Parameters<
  Extract<Parameters<ClientToServerEvents[E]>[1], (...args: never[]) => unknown>
>[0];

/**
 * 소켓 하나 + 시계 동기화 + 마지막으로 받은 방/게임 상태.
 * React에서는 useClientSnapshot으로 구독한다.
 */
export class RoomClient {
  readonly socket: AppSocket;
  readonly clock: ClockSync;
  private snap: ClientSnapshot = { room: null, view: null, connected: false, kicked: false, closed: null };
  private listeners = new Set<() => void>();
  private reactionListeners = new Set<(r: ReactionEvent) => void>();
  private auth: (() => void) | null = null;

  constructor() {
    this.socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], autoConnect: false });
    this.clock = new ClockSync(this.socket);
    this.socket.on('connect', () => {
      this.patch({ connected: true });
      void this.clock.burst();
      this.auth?.();
    });
    this.socket.on('disconnect', () => this.patch({ connected: false }));
    this.socket.on('room', (room) => this.patch({ room }));
    this.socket.on('view', (view) => this.patch({ view }));
    this.socket.on('reaction', (r) => {
      for (const fn of this.reactionListeners) fn(r);
    });
    this.socket.on('kicked', () => this.patch({ kicked: true }));
    this.socket.on('closed', (reason) => this.patch({ closed: reason }));
  }

  private patch(p: Partial<ClientSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const fn of this.listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): ClientSnapshot => this.snap;

  onReaction(fn: (r: ReactionEvent) => void): () => void {
    this.reactionListeners.add(fn);
    return () => this.reactionListeners.delete(fn);
  }

  /** 연결(재연결)될 때마다 실행할 인증 — 참가자 재입장, 진행자 재연결 */
  setAuth(fn: (() => void) | null): void {
    this.auth = fn;
    if (fn && this.socket.connected) fn();
  }

  open(): void {
    if (!this.socket.connected) this.socket.connect();
  }

  close(): void {
    this.socket.disconnect();
  }

  serverNow(): number {
    return this.clock.now();
  }

  /** 게임 시계 = 서버 시각 − 일시정지 누적 (일시정지 중에는 멈춤) */
  gameNow(): number {
    const r = this.snap.room;
    if (!r) return this.clock.now();
    if (r.paused && r.pausedAt !== null) return r.pausedAt;
    return this.clock.now() - r.timeBase;
  }

  input(input: unknown): void {
    this.socket.emit('player:input', { input, at: this.clock.now() });
  }

  call<E extends keyof ClientToServerEvents>(
    event: E,
    payload: Parameters<ClientToServerEvents[E]>[0],
    timeoutMs = 8_000,
  ): Promise<AckOf<E>> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(
        () =>
          resolve({
            ok: false,
            error: 'BAD_REQUEST',
            message: '서버 응답이 없어요. 연결을 확인해 주세요',
          } as AckOf<E>),
        timeoutMs,
      );
      (this.socket.emit as (...args: unknown[]) => void)(event, payload, (res: AckOf<E>) => {
        window.clearTimeout(timer);
        resolve(res);
      });
    });
  }

  command(cmd: HostCommand): Promise<Ack> {
    return this.call('host:command', cmd) as Promise<Ack>;
  }
}

/** 컴포넌트 수명 동안 쓰는 RoomClient (StrictMode의 이중 마운트에도 안전) */
export function useRoomClient(): RoomClient {
  const [client] = useState(() => new RoomClient());
  useEffect(() => {
    client.open();
    return () => client.close();
  }, [client]);
  return client;
}

export function useClientSnapshot(client: RoomClient): ClientSnapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}
