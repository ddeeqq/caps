import {
  BotBrain,
  BotHub,
  estimateOffset,
  type Ack,
  type CardsectionHostView,
  type ClientToServerEvents,
  type ClockSample,
  type HostCommand,
  type HostCreatePayload,
  type RoomState,
  type ServerToClientEvents,
  type ViewEnvelope,
} from '@caps/shared';
import { io, type Socket } from 'socket.io-client';

export { BotHub };
export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connectSocket(url: string): ClientSocket {
  return io(url, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: true });
}

function waitConnected(socket: ClientSocket, timeoutMs = 10_000): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('연결 시간 초과')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

/** 봇·호스트가 쓰는 시계 동기화 (웹 클라이언트와 같은 수학) */
export class ClockClient {
  samples: ClockSample[] = [];
  offset = 0;
  rtt = 0;
  constructor(private readonly socket: ClientSocket) {}

  ping(): Promise<ClockSample> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      this.socket.emit('clock:ping', t0, (ts) => {
        const sample = { t0, ts, t1: performance.now() };
        this.samples.push(sample);
        if (this.samples.length > 30) this.samples.shift();
        const est = estimateOffset(this.samples);
        if (est) {
          this.offset = est.offset;
          this.rtt = est.rtt;
        }
        resolve(sample);
      });
    });
  }

  async sync(count = 6, gapMs = 40): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.ping();
      await sleep(gapMs);
    }
  }

  serverNow(): number {
    return performance.now() + this.offset;
  }
}

export interface BotOptions {
  url: string;
  code: string;
  nickname?: string;
  hub?: BotHub;
  /** 반응 속도 배율 (작을수록 빠름) */
  speed?: number;
  /** 가끔 틀리게 행동 (오답 연결, 틀린 비밀번호) */
  mistakes?: boolean;
  /** 가끔 리액션을 보냄 */
  chatty?: boolean;
}

/** 가짜 참가자. 실제 폰과 같은 소켓 이벤트만 쓰고, 행동은 공용 BotBrain이 정한다. */
export class Bot {
  readonly socket: ClientSocket;
  readonly clock: ClockClient;
  playerId = '';
  token = '';
  nickname = '';
  room: RoomState | null = null;
  view: ViewEnvelope | null = null;
  received = 0;
  kicked = false;
  private timer: NodeJS.Timeout | null = null;
  private brain: BotBrain | null = null;

  constructor(private readonly opts: BotOptions) {
    this.socket = connectSocket(opts.url);
    this.clock = new ClockClient(this.socket);
    this.socket.on('room', (s) => {
      this.room = s;
      this.received += 1;
    });
    this.socket.on('view', (v) => {
      this.view = v;
      this.received += 1;
    });
    this.socket.on('kicked', () => {
      this.kicked = true;
      this.stop();
    });
    this.socket.io.on('reconnect', () => void this.rejoin());
  }

  async join(): Promise<number> {
    const started = performance.now();
    await waitConnected(this.socket);
    await this.clock.sync(5, 30);
    const res = await new Promise<Parameters<Parameters<ClientToServerEvents['player:join']>[1]>[0]>(
      (resolve) =>
        this.socket.emit('player:join', { code: this.opts.code, nickname: this.opts.nickname }, resolve),
    );
    if (!res.ok) throw new Error(res.message);
    this.playerId = res.playerId;
    this.token = res.token;
    this.nickname = res.nickname;
    this.brain = new BotBrain(res.playerId, {
      hub: this.opts.hub,
      speed: this.opts.speed,
      mistakes: this.opts.mistakes,
      chatty: this.opts.chatty,
    });
    this.timer = setInterval(() => this.think(), 100);
    return performance.now() - started;
  }

  private async rejoin(): Promise<void> {
    if (!this.token || this.kicked) return;
    await this.clock.sync(3, 30);
    this.socket.emit('player:join', { code: this.opts.code, token: this.token }, () => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket.disconnect();
  }

  gameNow(): number {
    const r = this.room;
    if (!r) return this.clock.serverNow();
    return r.paused && r.pausedAt !== null ? r.pausedAt : this.clock.serverNow() - r.timeBase;
  }

  send(input: unknown): void {
    this.socket.emit('player:input', { input, at: this.clock.serverNow() });
  }

  private think(): void {
    const r = this.room;
    if (!r || !this.brain) return;
    for (const action of this.brain.think({
      phase: r.phase,
      paused: r.paused,
      view: this.view,
      gameNow: this.gameNow(),
    })) {
      if (action.type === 'input') this.send(action.input);
      else if (action.type === 'survey') this.socket.emit('player:survey', action.answer);
      else this.socket.emit('player:react', action.kind);
    }
  }
}

export interface AutoHostOptions {
  url: string;
  create: HostCreatePayload;
  /** 이만큼 모이면 시작 */
  waitForPlayers: number;
  introMs?: number;
  resultMs?: number;
  seatMs?: number;
  onPhase?: (state: RoomState) => void;
}

/** 진행자를 대신해 다음 단계로 넘겨 주는 자동 호스트 (데모·통합 테스트용) */
export class AutoHost {
  readonly socket: ClientSocket;
  readonly clock: ClockClient;
  code = '';
  hostToken = '';
  hostPin = '';
  room: RoomState | null = null;
  view: ViewEnvelope | null = null;
  reactions = 0;
  private timer: NodeJS.Timeout | null = null;
  private phaseKey = '';
  private phaseAt = 0;
  private sent = new Set<string>();
  private finishResolvers: Array<(s: RoomState) => void> = [];

  constructor(private readonly opts: AutoHostOptions) {
    this.socket = connectSocket(opts.url);
    this.clock = new ClockClient(this.socket);
    this.socket.on('room', (s) => {
      this.room = s;
      const key = `${s.phase}:${s.index}`;
      if (key !== this.phaseKey) {
        this.phaseKey = key;
        this.phaseAt = Date.now();
        this.opts.onPhase?.(s);
      }
      if (s.phase === 'finished') for (const r of this.finishResolvers.splice(0)) r(s);
    });
    this.socket.on('view', (v) => {
      this.view = v;
    });
    this.socket.on('reaction', () => {
      this.reactions += 1;
    });
  }

  async create(): Promise<{ code: string; hostToken: string; hostPin: string }> {
    await waitConnected(this.socket);
    await this.clock.sync(5, 30);
    const res = await new Promise<Parameters<Parameters<ClientToServerEvents['host:create']>[1]>[0]>(
      (resolve) => this.socket.emit('host:create', this.opts.create, resolve),
    );
    if (!res.ok) throw new Error(res.message);
    this.code = res.code;
    this.hostToken = res.hostToken;
    this.hostPin = res.hostPin;
    return { code: res.code, hostToken: res.hostToken, hostPin: res.hostPin };
  }

  command(cmd: HostCommand): Promise<Ack> {
    return new Promise((resolve) => this.socket.emit('host:command', cmd, resolve));
  }

  private once(action: string, fn: () => void): void {
    const key = `${this.phaseKey}:${action}`;
    if (this.sent.has(key)) return;
    this.sent.add(key);
    fn();
  }

  run(): void {
    const introMs = this.opts.introMs ?? 2_000;
    const resultMs = this.opts.resultMs ?? 3_000;
    const seatMs = this.opts.seatMs ?? 6_000;
    this.timer = setInterval(() => {
      const r = this.room;
      if (!r) return;
      const since = Date.now() - this.phaseAt;
      if (r.phase === 'lobby' && r.playerCount >= this.opts.waitForPlayers) {
        this.once('start', () => void this.command({ type: 'start' }));
      } else if (r.phase === 'intro' && since >= introMs) {
        this.once('next', () => void this.command({ type: 'next' }));
      } else if (r.phase === 'playing' && r.gameId === 'cardsection') {
        const v = this.view?.view as CardsectionHostView | undefined;
        const everyone = v ? v.seatedCount >= v.playerCount : false;
        if (v?.stage === 'seat' && (since >= seatMs || (everyone && since >= 1_500))) {
          this.once('show', () => void this.command({ type: 'game', action: 'start-show' }));
        }
      } else if (r.phase === 'result' && since >= resultMs) {
        this.once('next', () => void this.command({ type: 'next' }));
      }
    }, 150);
  }

  untilFinished(timeoutMs: number): Promise<RoomState> {
    if (this.room?.phase === 'finished') return Promise.resolve(this.room);
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`시간 안에 끝나지 않음 (현재 ${this.phaseKey})`)),
        timeoutMs,
      );
      this.finishResolvers.push((s) => {
        clearTimeout(t);
        resolve(s);
      });
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.socket.disconnect();
  }
}

/** 통합 테스트·데모용 빠른 설정 */
export const FAST_SETTINGS = {
  nunchiRounds: 2,
  soundmateSeconds: 25,
  missionSeconds: 6,
  vaultSafes: 2,
  seatRows: 2,
  seatCols: 5,
  cardsectionMs: 4_000,
  minorityRounds: 2,
  minorityTalkSeconds: 3,
  minorityVoteSeconds: 3,
  tiltraceLength: 6,
} as const;
