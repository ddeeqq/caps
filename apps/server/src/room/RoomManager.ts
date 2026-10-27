import type { ClientRole, ClientToServerEvents, ServerToClientEvents } from '@caps/shared';
import type { Server } from 'socket.io';
import type { Storage } from '../storage';
import { newRoomCode, type Logger } from '../util';
import { Room, type RoomOptions } from './Room';

export interface SocketBinding {
  code: string;
  role: ClientRole;
  playerId?: string;
}

const IDLE_ROOM_MS = 2 * 60 * 60 * 1000;
const IDLE_FINISHED_MS = 30 * 60 * 1000;
const REPORT_DEBOUNCE_MS = 2_000;

/**
 * 모든 방을 들고 50ms마다 진행시키고, 바뀐 상태만 소켓별로 보낸다.
 * 같은 내용을 두 번 보내지 않도록 소켓마다 마지막으로 보낸 JSON을 기억한다.
 */
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly bindings = new Map<string, SocketBinding>();
  private readonly lastSent = new Map<string, { room?: string; view?: string }>();
  private readonly reportDue = new Map<string, number>();
  private tickTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private reactionSeq = 0;
  stats = { ticks: 0, emits: 0, lastTickMs: 0 };

  constructor(
    private readonly io: Server<ClientToServerEvents, ServerToClientEvents>,
    private readonly storage: Storage,
    private readonly log: Logger,
  ) {}

  start(tickMs = 50): void {
    this.tickTimer = setInterval(() => this.tickAll(), tickMs);
    this.cleanupTimer = setInterval(() => void this.cleanup(), 60_000);
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.all(
      [...this.rooms.values()].filter((r) => r.summaries.length > 0).map((r) => this.saveReport(r)),
    );
  }

  createRoom(opts: Omit<RoomOptions, 'code'>): Room {
    let code = newRoomCode();
    for (let i = 0; i < 50 && this.rooms.has(code); i++) code = newRoomCode();
    const room = new Room({ ...opts, code });
    this.rooms.set(code, room);
    this.log.info(`방 생성 ${code} (${room.pack.name}, ${room.flow.join(' → ')})`);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  bind(socketId: string, binding: SocketBinding): void {
    this.bindings.set(socketId, binding);
    this.lastSent.delete(socketId);
  }

  binding(socketId: string): SocketBinding | undefined {
    return this.bindings.get(socketId);
  }

  unbind(socketId: string): SocketBinding | undefined {
    const b = this.bindings.get(socketId);
    this.bindings.delete(socketId);
    this.lastSent.delete(socketId);
    return b;
  }

  playerCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.connectedPlayers().length;
    return n;
  }

  emitReaction(
    room: Room,
    payload: {
      kind: Parameters<ServerToClientEvents['reaction']>[0]['kind'];
      color: string;
      nickname: string;
    },
  ): void {
    const event = { id: ++this.reactionSeq, ...payload };
    for (const sid of room.hostSockets) this.io.to(sid).emit('reaction', event);
  }

  kick(room: Room, playerId: string): boolean {
    const rec = room.kick(playerId);
    if (!rec) return false;
    if (rec.socketId) {
      this.io.to(rec.socketId).emit('kicked');
      const sock = this.io.sockets.sockets.get(rec.socketId);
      this.unbind(rec.socketId);
      sock?.disconnect(true);
    }
    return true;
  }

  /** 세션 기록 저장 예약 (설문이 연달아 들어와도 한 번만 쓰도록 2초 모아서) */
  scheduleReport(room: Room): void {
    if (!this.reportDue.has(room.code)) this.reportDue.set(room.code, Date.now() + REPORT_DEBOUNCE_MS);
  }

  private async saveReport(room: Room): Promise<void> {
    try {
      await this.storage.saveSession(room.report());
    } catch (err) {
      this.log.error(`세션 기록 저장 실패 ${room.code}`, err);
    }
  }

  tickAll(): void {
    const started = performance.now();
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const wasFinished = room.phase === 'finished';
      try {
        room.tick();
      } catch (err) {
        this.log.error(`게임 진행 오류 ${room.code}`, err);
      }
      if (!wasFinished && room.phase === 'finished') this.scheduleReport(room);
      if (room.dirty) {
        room.dirty = false;
        try {
          this.flush(room);
        } catch (err) {
          this.log.error(`상태 전송 오류 ${room.code}`, err);
        }
      }
      const due = this.reportDue.get(room.code);
      if (due !== undefined && now >= due) {
        this.reportDue.delete(room.code);
        void this.saveReport(room);
      }
    }
    this.stats.ticks += 1;
    this.stats.lastTickMs = performance.now() - started;
  }

  private emitDiff(socketId: string, kind: 'room' | 'view', payload: unknown): void {
    const json = JSON.stringify(payload);
    const last = this.lastSent.get(socketId) ?? {};
    if (last[kind] === json) return;
    last[kind] = json;
    this.lastSent.set(socketId, last);
    // payload를 그대로 보내면 socket.io가 다시 직렬화한다 — 같은 내용이므로 문제없다
    this.io.to(socketId).emit(kind as 'room', payload as never);
    this.stats.emits += 1;
  }

  flush(room: Room): void {
    const ctx = room.ctx();
    if (room.hostSockets.size > 0) {
      const state = room.roomState('screen');
      const view = room.viewFor(ctx, 'screen');
      for (const sid of room.hostSockets) {
        this.emitDiff(sid, 'room', state);
        this.emitDiff(sid, 'view', view);
      }
    }
    if (room.remoteSockets.size > 0) {
      const state = room.roomState('remote');
      const view = room.viewFor(ctx, 'remote');
      for (const sid of room.remoteSockets) {
        this.emitDiff(sid, 'room', state);
        this.emitDiff(sid, 'view', view);
      }
    }
    for (const p of room.players.values()) {
      if (!p.connected || !p.socketId) continue;
      this.emitDiff(p.socketId, 'room', room.roomState('player', p.id));
      this.emitDiff(p.socketId, 'view', room.viewFor(ctx, 'player', p.id));
    }
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const anyone =
        room.hostSockets.size > 0 || room.remoteSockets.size > 0 || room.connectedPlayers().length > 0;
      if (anyone) continue;
      const idle = now - room.lastActivity;
      if (idle > IDLE_ROOM_MS || (room.phase === 'finished' && idle > IDLE_FINISHED_MS)) {
        if (room.summaries.length > 0) await this.saveReport(room);
        this.rooms.delete(code);
        this.log.info(`방 정리 ${code}`);
      }
    }
  }
}
