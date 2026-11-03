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
/** 진행 중인 방을 저장하는 간격 (서버가 갑자기 꺼져도 이만큼만 잃는다) */
const SNAPSHOT_EVERY_MS = 3_000;
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
  private pruneTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private snapshotRun: Promise<void> | null = null;
  /** 마지막으로 쓴 저장본 (저장 시각 제외). 같으면 다시 쓰지 않는다 */
  private lastSnapshotKey = '';
  private reactionSeq = 0;
  stats = { ticks: 0, emits: 0, lastTickMs: 0 };

  constructor(
    private readonly io: Server<ClientToServerEvents, ServerToClientEvents>,
    private readonly storage: Storage,
    private readonly log: Logger,
  ) {}

  /**
   * opts.retentionDays: 세션 리포트를 며칠 보관할지 (0이면 지우지 않음).
   * 리포트에는 닉네임과 익명 설문만 있지만, 보관 기한을 두는 것이 개인정보 원칙에 맞다.
   */
  start(tickMs = 50, opts: { snapshots?: boolean; retentionDays?: number } = {}): void {
    const days = opts.retentionDays ?? 0;
    if (days > 0) {
      const prune = () => void this.pruneSessions(days);
      prune();
      this.pruneTimer = setInterval(prune, 6 * 60 * 60 * 1000);
    }
    this.tickTimer = setInterval(() => this.tickAll(), tickMs);
    this.cleanupTimer = setInterval(() => void this.cleanup(), 60_000);
    if (opts.snapshots !== false) {
      this.snapshotTimer = setInterval(() => void this.saveSnapshots(), SNAPSHOT_EVERY_MS);
    }
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    const snapshots = this.snapshotTimer !== null;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
    await Promise.all(
      [...this.rooms.values()].filter((r) => r.summaries.length > 0).map((r) => this.saveReport(r)),
    );
    if (snapshots) await this.saveSnapshots(true);
  }

  /**
   * 방을 모두 저장한다. 앞선 저장이 아직 끝나지 않았으면 건너뛴다(force면 기다렸다가 쓴다).
   * 게임 시계가 흐르는 방이 없고 내용도 그대로면 쓰지 않는다 — 한가한 서버는 디스크를 건드리지 않는다.
   * 방이 모두 없어진 뒤에도 빈 목록을 한 번 써서 지난 저장본을 지운다.
   */
  async saveSnapshots(force = false): Promise<void> {
    if (this.snapshotRun) {
      if (!force) return;
      await this.snapshotRun;
    }
    const run = this.writeSnapshots(force);
    this.snapshotRun = run;
    try {
      await run;
    } finally {
      if (this.snapshotRun === run) this.snapshotRun = null;
    }
  }

  private async writeSnapshots(force: boolean): Promise<void> {
    try {
      const snaps = [...this.rooms.values()].map((r) => r.toSnapshot());
      const ticking = snaps.some(
        (s) => s.pausedAt === null && (s.phase === 'intro' || s.phase === 'playing'),
      );
      const key = JSON.stringify(snaps, (k, v: unknown) => (k === 'savedAt' ? 0 : v));
      if (!force && !ticking && key === this.lastSnapshotKey) return;
      await this.storage.saveRoomSnapshots(snaps);
      this.lastSnapshotKey = key;
    } catch (err) {
      this.log.error('방 저장 실패', err);
    }
  }

  /**
   * 서버를 다시 켰을 때 저장본으로 방을 되살린다. 오래 쉬던 방은 버린다.
   * 사람들은 폰이 자동으로 다시 연결되면서 같은 사람으로 돌아온다.
   */
  async restore(): Promise<number> {
    const snaps = await this.storage.loadRoomSnapshots();
    const now = Date.now();
    let restored = 0;
    for (const snap of snaps) {
      if (this.rooms.has(snap.code)) continue;
      const idle = now - snap.lastActivity;
      if (idle > IDLE_ROOM_MS || (snap.phase === 'finished' && idle > IDLE_FINISHED_MS)) continue;
      try {
        this.rooms.set(snap.code, Room.fromSnapshot(snap));
        restored += 1;
      } catch (err) {
        this.log.error(`방 복구 실패 ${snap.code}`, err);
      }
    }
    if (restored) this.log.info(`방 ${restored}개 복구 (일시정지 상태로 이어서 진행)`);
    return restored;
  }

  async pruneSessions(days: number): Promise<number> {
    try {
      const removed = await this.storage.pruneSessions(Date.now() - days * 24 * 60 * 60 * 1000);
      if (removed) this.log.info(`${days}일 지난 세션 리포트 ${removed}개 삭제`);
      return removed;
    } catch (err) {
      this.log.error('오래된 리포트 정리 실패', err);
      return 0;
    }
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
        room.tickBots((rec, kind) => {
          room.reactions += 1;
          this.emitReaction(room, { kind, color: rec.color, nickname: rec.nickname });
        });
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
      // 봇은 사람이 아니다: 봇만 남은 방도 정리한다
      const anyone =
        room.hostSockets.size > 0 || room.remoteSockets.size > 0 || room.connectedHumans().length > 0;
      if (anyone) continue;
      const idle = now - room.lastActivity;
      if (idle > IDLE_ROOM_MS || (room.phase === 'finished' && idle > IDLE_FINISHED_MS)) {
        if (room.summaries.length > 0) await this.saveReport(room);
        this.rooms.delete(code);
        this.reportDue.delete(code);
        this.log.info(`방 정리 ${code}`);
      }
    }
  }
}
