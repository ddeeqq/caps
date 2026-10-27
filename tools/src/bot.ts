import {
  applyRule,
  estimateOffset,
  REACTION_KINDS,
  VAULT_LEVELS,
  type Ack,
  type CardsectionPlayerView,
  type ClientToServerEvents,
  type ClockSample,
  type HostCommand,
  type HostCreatePayload,
  type MinorityPlayerView,
  type NunchiPlayerView,
  type RoomState,
  type ServerToClientEvents,
  type SoundmatePlayerView,
  type TiltracePlayerView,
  type VaultPlayerView,
  type VaultRule,
  type ViewEnvelope,
  type CardsectionHostView,
} from '@caps/shared';
import { io, type Socket } from 'socket.io-client';

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

/** 같은 프로세스의 봇끼리 "말로 나누는 정보"를 흉내 내는 공유 메모 */
export class BotHub {
  private sounds = new Map<string, Map<string, string>>();
  private vault = new Map<
    string,
    { order?: string[]; table?: Array<{ symbol: string; digit: number }>; rule?: string }
  >();

  registerSound(key: string, playerId: string, code: string): void {
    if (!code) return;
    let m = this.sounds.get(key);
    if (!m) this.sounds.set(key, (m = new Map()));
    m.set(playerId, code);
  }

  sameSound(key: string, me: string): string[] {
    return [...(this.sounds.get(key) ?? new Map<string, string>()).entries()]
      .filter(([id]) => id !== me)
      .map(([, c]) => c);
  }

  otherSounds(key: string): string[] {
    return [...this.sounds.entries()].filter(([k]) => k !== key).flatMap(([, m]) => [...m.values()]);
  }

  vaultInfo(key: string) {
    let v = this.vault.get(key);
    if (!v) this.vault.set(key, (v = {}));
    return v;
  }
}

export function parseRule(text: string | null | undefined): VaultRule | null {
  if (!text) return null;
  const pos = /(\d+)번째/.exec(text);
  if (text.includes('1을 더해서') && pos) return { kind: 'plus', pos: Number(pos[1]) - 1, text };
  if (text.includes('9에서')) return { kind: 'nineMinus', pos: -1, text };
  if (text.includes('바꿔서')) return { kind: 'swap', text };
  if (text.includes('거꾸로')) return { kind: 'reverse', text };
  return null;
}

function solveVault(
  order: string[],
  table: Array<{ symbol: string; digit: number }>,
  ruleText?: string,
): string {
  const raw = order.map((sym) => table.find((e) => e.symbol === sym)?.digit ?? 0);
  const rule = parseRule(ruleText);
  if (rule?.kind === 'nineMinus') rule.pos = raw.length - 1;
  return applyRule(raw, rule).join('');
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

/** 가짜 참가자. 실제 폰과 같은 소켓 이벤트만 쓴다. */
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
  private memo = new Map<string, number>();
  private counters = { link: 0, tilt: 0 };
  private tilt = 0;
  private readonly speed: number;

  constructor(private readonly opts: BotOptions) {
    this.speed = opts.speed ?? 1;
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

  /** key마다 한 번 무작위 지연을 정하고, 그 시각이 지나면 true */
  private ready(key: string, minMs: number, maxMs: number): boolean {
    const now = Date.now();
    let at = this.memo.get(key);
    if (at === undefined) {
      at = now + (minMs + Math.random() * (maxMs - minMs)) * this.speed;
      this.memo.set(key, at);
    }
    return now >= at;
  }

  private done(key: string, retryAfterMs = Infinity): void {
    this.memo.set(key, retryAfterMs === Infinity ? Infinity : Date.now() + retryAfterMs);
  }

  private think(): void {
    const r = this.room;
    if (!r) return;
    if (r.phase === 'lobby' && !this.memo.has('survey-lobby')) {
      this.memo.set('survey-lobby', 1);
      if (Math.random() < 0.8)
        this.socket.emit('player:survey', { phase: 'lobby', comfort: 2 + Math.floor(Math.random() * 3) });
    }
    if (r.phase === 'finished' && !this.memo.has('survey-end')) {
      this.memo.set('survey-end', 1);
      this.socket.emit('player:survey', {
        phase: 'end',
        comfort: 3 + Math.floor(Math.random() * 3),
        newPeople: 1 + Math.floor(Math.random() * 3),
      });
    }
    if (this.opts.chatty && Math.random() < 0.01) {
      this.socket.emit('player:react', REACTION_KINDS[Math.floor(Math.random() * REACTION_KINDS.length)]!);
    }
    const env = this.view;
    if (!env || env.phase !== 'playing' || r.paused || !env.view) return;
    switch (env.gameId) {
      case 'nunchi':
        return this.nunchi(env.view as NunchiPlayerView);
      case 'soundmate':
        return this.soundmate(env.view as SoundmatePlayerView);
      case 'vault':
        return this.vault(env.view as VaultPlayerView);
      case 'cardsection':
        return this.cardsection(env.view as CardsectionPlayerView);
      case 'minority':
        return this.minority(env.view as MinorityPlayerView);
      case 'tiltrace':
        return this.tiltrace(env.view as TiltracePlayerView);
    }
  }

  private nunchi(v: NunchiPlayerView): void {
    if (!v.canTap || (v.stage !== 'open' && v.stage !== 'countdown')) return;
    const key = `nunchi:${v.round}`;
    let plan = this.memo.get(key);
    if (plan === undefined) {
      plan = v.openAt + (250 + Math.random() * 5000) * this.speed;
      this.memo.set(key, plan);
    }
    if (this.gameNow() >= plan) {
      this.memo.set(key, Infinity);
      this.send({ type: 'tap' });
    }
  }

  private soundmate(v: SoundmatePlayerView): void {
    const hub = this.opts.hub;
    if (!hub) return;
    const soundKey = `${v.soundId}:${v.variant}`;
    hub.registerSound(soundKey, this.playerId, v.myCode);
    if (v.stage === 'search' && !v.teamComplete) {
      const key = `sm-link:${this.counters.link}`;
      if (this.ready(key, 700, 2600)) {
        this.counters.link += 1;
        const wrong = this.opts.mistakes !== false && Math.random() < 0.15;
        const pool = wrong ? hub.otherSounds(soundKey) : hub.sameSound(soundKey, this.playerId);
        const code = pool[Math.floor(Math.random() * pool.length)];
        if (code) this.send({ type: 'link', code });
      }
    }
    const m = v.mission;
    if (m && m.decided === null) {
      if (m.myVote === null && this.ready(`sm-vote:${v.teamName}`, 400, 2000)) {
        this.send({ type: 'vote', choice: Math.random() < 0.75 ? 'a' : 'b' });
      } else if (m.myVote) {
        const other = m.myVote === 'a' ? 'b' : 'a';
        const mine = m.myVote === 'a' ? m.votesA : m.votesB;
        const theirs = other === 'a' ? m.votesA : m.votesB;
        const key = `sm-switch:${v.teamName}:${m.votesA}:${m.votesB}`;
        if (theirs > mine && this.ready(key, 800, 2000)) {
          this.done(key);
          this.send({ type: 'vote', choice: other });
        }
      }
    }
  }

  private vault(v: VaultPlayerView): void {
    const hub = this.opts.hub;
    if (!hub || v.status !== 'active') return;
    const key = `${v.teamName}#${v.safeIndex}`;
    const info = hub.vaultInfo(key);
    if (v.order) info.order = v.order;
    if (v.table) info.table = v.table;
    if (v.rule) info.rule = v.rule;
    if (!v.roles.includes('input')) return;
    const level = VAULT_LEVELS[Math.min(v.level - 1, VAULT_LEVELS.length - 1)];
    if (!info.order || !info.table || (level?.rule && !info.rule)) return;
    if (this.gameNow() < v.lockedUntil) return;
    const attemptKey = `vault:${key}:${v.attempts}`;
    if (!this.ready(attemptKey, 1200, 3500)) return;
    this.done(attemptKey, 4_000);
    const answer = solveVault(info.order, info.table, info.rule);
    const wrongFirst = this.opts.mistakes !== false && v.attempts === 0 && Math.random() < 0.25;
    const code = wrongFirst ? `${(Number(answer[0]) + 1) % 10}${answer.slice(1)}` : answer;
    this.send({ type: 'submit', code });
  }

  private cardsection(v: CardsectionPlayerView): void {
    if (v.stage !== 'seat' || v.mySeat) return;
    if (!this.ready('seat', 300, 2500)) return;
    this.done('seat', 2_000);
    const taken = new Set(v.taken.map(([r, c]) => `${r}:${c}`));
    const free: Array<[number, number]> = [];
    for (let r = 0; r < v.rows; r++)
      for (let c = 0; c < v.cols; c++) if (!taken.has(`${r}:${c}`)) free.push([r, c]);
    const pick = free[Math.floor(Math.random() * free.length)] ?? [0, 0];
    this.send({ type: 'seat', row: pick[0], col: pick[1] });
  }

  private minority(v: MinorityPlayerView): void {
    if (v.stage !== 'talk' && v.stage !== 'vote') return;
    const choice = Math.random() < 0.5 ? 'a' : 'b';
    if (v.alive && !v.myVote && this.ready(`mv:${v.round}`, 200, 1800)) this.send({ type: 'vote', choice });
    if (!v.alive && !v.myPrediction && this.ready(`mp:${v.round}`, 200, 1800))
      this.send({ type: 'predict', choice });
  }

  private tiltrace(v: TiltracePlayerView): void {
    if (v.stage !== 'race' && v.stage !== 'countdown') return;
    const key = `tilt:${this.counters.tilt}`;
    if (!this.ready(key, 120, 220)) return;
    this.counters.tilt += 1;
    this.tilt = Math.max(-1, Math.min(1, this.tilt * 0.8 + (Math.random() - 0.5) * 0.8 - v.x * 0.3));
    this.send({ type: 'tilt', v: Math.round(this.tilt * 100) / 100 });
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
