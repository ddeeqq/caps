import {
  BotBrain,
  BotHub,
  cleanText,
  containsProfanity,
  createRng,
  GAMES,
  hashSeed,
  LIMITS,
  MAX_PLAYERS_PER_ROOM,
  PLAYER_COLORS,
  randomNickname,
  sanitizeClientTime,
  uniqueNickname,
  type ClientRole,
  type ErrorCode,
  type ReactionKind,
  type GameCtx,
  type GameId,
  type GameModule,
  type GamePlayer,
  type GameSummary,
  type HostCommand,
  type MetPerson,
  type PauseReason,
  type PlayerSummary,
  type ResolvedPack,
  type Rng,
  type RoomPhase,
  type RoomSettings,
  type RoomState,
  type SessionReport,
  type SurveyAnswer,
  type SurveyStats,
  type TeamInfo,
  type ViewEnvelope,
} from '@caps/shared';
import { newId, newPin, newToken, RateLimiter, serverNow } from '../util';
import type { RoomIdentity, RoomSnapshot } from './snapshot';

export interface PlayerRec {
  id: string;
  token: string;
  nickname: string;
  color: string;
  socketId: string | null;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
  survey: { lobby?: number; endComfort?: number; newPeople?: number; comment?: string };
  inputLimiter: RateLimiter;
  reactLimiter: RateLimiter;
  /** 서버 안에서 노는 가상 참가자 (소켓 없음) */
  bot: boolean;
  brain: BotBrain | null;
}

export interface ActiveGame {
  id: GameId;
  module: GameModule;
  state: unknown;
  rng: Rng;
  summary: GameSummary | null;
}

export interface RoomOptions {
  code: string;
  pack: ResolvedPack;
  flow: GameId[];
  settings: RoomSettings;
  /** 저장본에서 되살릴 때만 */
  identity?: RoomIdentity;
}

const average = (xs: number[]): number | null =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;

/** 리모컨 PIN을 틀린 횟수가 이만큼 쌓이면 잠시 잠근다 (소켓을 바꿔 가며 찍어 보는 공격 방지) */
const PIN_FAIL_LIMIT = 10;
const PIN_FAIL_WINDOW_MS = 5 * 60_000;
/** 나간 사람 기록까지 합쳐 방 하나가 들고 있을 최대 참가자 수 (메모리 보호) */
const MAX_PLAYER_RECORDS = MAX_PLAYERS_PER_ROOM * 2;
/** 방 하나에 넣을 수 있는 가상 참가자 수 */
export const MAX_BOTS_PER_ROOM = 40;
/** 가상 참가자가 생각하는 간격 (틱 2번 = 0.1초) */
const BOT_THINK_EVERY_TICKS = 2;

/**
 * 방 하나의 모든 상태. 판정과 진행은 전부 여기서 일어나고(서버 권위),
 * 클라이언트에는 roomState / viewFor 결과만 나간다.
 */
export class Room {
  readonly code: string;
  readonly hostToken: string;
  readonly hostPin: string;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly seed: number;
  pack: ResolvedPack;
  flow: GameId[];
  settings: RoomSettings;
  phase: RoomPhase = 'lobby';
  index = -1;
  phaseSince: number;
  players = new Map<string, PlayerRec>();
  kickedTokens = new Set<string>();
  hostSockets = new Set<string>();
  remoteSockets = new Set<string>();
  teams: TeamInfo[] | null = null;
  game: ActiveGame | null = null;
  summaries: GameSummary[] = [];
  pauseAccum = 0;
  pausedAt: number | null = null;
  pauseReason: PauseReason | null = null;
  dirty = true;
  peakPlayers = 0;
  reactions = 0;
  startedAt: number | null = null;
  endedAt: number | null = null;
  activeAtEnd = 0;
  lastActivity = Date.now();
  private readonly nickRng: Rng;
  private colorCursor = 0;
  private pinFailures: number[] = [];
  peakBots = 0;
  private readonly botHub = new BotHub();
  private botHubKey = '';
  private tickCount = 0;

  constructor(opts: RoomOptions) {
    this.code = opts.code;
    this.hostToken = opts.identity?.hostToken ?? newToken();
    this.hostPin = opts.identity?.hostPin ?? newPin();
    this.sessionId = opts.identity?.sessionId ?? `${newId()}${newId()}`;
    this.createdAt = opts.identity?.createdAt ?? Date.now();
    this.pack = opts.pack;
    this.flow = [...opts.flow];
    this.settings = opts.settings;
    this.seed = hashSeed(this.code, this.createdAt);
    this.nickRng = createRng(this.seed ^ 0x5bd1e995);
    this.phaseSince = this.gameNow();
  }

  // ── 시간 ─────────────────────────────────────────────
  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** 게임 시계 = 서버 시각 − 일시정지 누적 시간 (일시정지 중에는 멈춘다) */
  gameNow(): number {
    return (this.pausedAt ?? serverNow()) - this.pauseAccum;
  }

  touch(): void {
    this.lastActivity = Date.now();
    this.dirty = true;
  }

  // ── 리모컨 PIN 잠금 ───────────────────────────────────
  pinLocked(now = Date.now()): boolean {
    this.pinFailures = this.pinFailures.filter((t) => now - t < PIN_FAIL_WINDOW_MS);
    return this.pinFailures.length >= PIN_FAIL_LIMIT;
  }

  recordPinFailure(now = Date.now()): void {
    this.pinFailures.push(now);
  }

  // ── 참가자 ───────────────────────────────────────────
  connectedPlayers(): PlayerRec[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  /** 지금 접속한 "사람" (가상 참가자 제외). 지표와 빈 방 정리에 쓴다 */
  connectedHumans(): PlayerRec[] {
    return [...this.players.values()].filter((p) => p.connected && !p.bot);
  }

  botCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.bot) n += 1;
    return n;
  }

  /**
   * 새 참가자를 받을 수 있는지. 지금 접속한 사람 수로 판단한다
   * (잠깐 나간 사람의 기록이 자리를 차지하지 않게). 기록 총량도 따로 제한한다.
   */
  hasCapacity(): boolean {
    return this.connectedPlayers().length < MAX_PLAYERS_PER_ROOM && this.players.size < MAX_PLAYER_RECORDS;
  }

  playerByToken(token: string): PlayerRec | undefined {
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  /** 닉네임 검사: 비었으면 자동 생성, 금칙어면 오류 */
  normalizeNickname(raw: string | undefined, exceptId?: string): string | ErrorCode {
    const cleaned = cleanText(raw ?? '', LIMITS.nickname);
    if (cleaned && containsProfanity(cleaned)) return 'NICKNAME_BLOCKED';
    const taken = new Set([...this.players.values()].filter((p) => p.id !== exceptId).map((p) => p.nickname));
    return uniqueNickname(cleaned || randomNickname(this.nickRng), taken);
  }

  addPlayer(nickname: string, opts: { bot?: boolean } = {}): PlayerRec {
    const rec: PlayerRec = {
      id: newId(),
      token: newToken(),
      nickname,
      color: PLAYER_COLORS[this.colorCursor++ % PLAYER_COLORS.length] as string,
      socketId: null,
      connected: false,
      joinedAt: Date.now(),
      disconnectedAt: null,
      survey: {},
      inputLimiter: new RateLimiter(40, 1000),
      reactLimiter: new RateLimiter(4, 2000),
      bot: opts.bot ?? false,
      brain: null,
    };
    this.players.set(rec.id, rec);
    this.touch();
    return rec;
  }

  attachPlayer(rec: PlayerRec, socketId: string | null): void {
    const isNewcomer = rec.socketId === null && rec.disconnectedAt === null;
    rec.socketId = socketId;
    rec.connected = true;
    rec.disconnectedAt = null;
    this.peakPlayers = Math.max(this.peakPlayers, this.connectedHumans().length);
    this.peakBots = Math.max(this.peakBots, this.botCount());
    if (isNewcomer && this.game && (this.phase === 'intro' || this.phase === 'playing')) {
      this.game.module.playerJoined?.(this.game.state, this.ctx(), rec.id);
    }
    this.touch();
  }

  // ── 가상 참가자 (봇) ─────────────────────────────────
  /** 봇을 count명 넣는다. 실제로 넣은 수를 돌려준다 */
  addBots(count: number): number {
    let added = 0;
    for (let i = 0; i < count; i++) {
      if (this.botCount() >= MAX_BOTS_PER_ROOM || !this.hasCapacity()) break;
      const taken = new Set([...this.players.values()].map((p) => p.nickname));
      const rec = this.addPlayer(uniqueNickname(`🤖 ${randomNickname(this.nickRng)}`, taken), { bot: true });
      rec.brain = new BotBrain(rec.id, { hub: this.botHub, surveys: false, chatty: true });
      this.attachPlayer(rec, null);
      added += 1;
    }
    return added;
  }

  clearBots(): number {
    let removed = 0;
    for (const [id, p] of this.players) {
      if (!p.bot) continue;
      this.players.delete(id);
      removed += 1;
    }
    if (removed) this.touch();
    return removed;
  }

  /**
   * 봇들이 지금 화면을 보고 행동한다. 틱마다 불리지만 0.1초에 한 번만 생각한다.
   * onReact: 봇의 리액션을 큰 화면에 띄우는 콜백
   */
  tickBots(onReact: (rec: PlayerRec, kind: ReactionKind) => void): void {
    this.tickCount += 1;
    if (this.tickCount % BOT_THINK_EVERY_TICKS !== 0) return;
    const bots = [...this.players.values()].filter((p) => p.bot && p.brain);
    if (bots.length === 0) return;
    const hubKey = `${this.index}:${this.game?.id ?? ''}`;
    if (hubKey !== this.botHubKey) {
      this.botHubKey = hubKey;
      this.botHub.reset();
    }
    const ctx = this.ctx();
    const gameNow = this.gameNow();
    for (const rec of bots) {
      const view = this.viewFor(ctx, 'player', rec.id);
      const actions = (rec.brain as BotBrain).think({
        phase: this.phase,
        paused: this.paused,
        view,
        gameNow,
      });
      for (const action of actions) {
        if (action.type === 'input') this.input(rec.id, action.input, serverNow());
        else if (action.type === 'react' && (this.phase === 'lobby' || this.phase === 'result')) {
          if (rec.reactLimiter.allow()) onReact(rec, action.kind);
        }
      }
    }
  }

  /** 소켓이 끊겼을 때. 어떤 역할이었는지 돌려준다 */
  detachSocket(socketId: string): ClientRole | null {
    if (this.hostSockets.delete(socketId)) {
      this.touch();
      return 'screen';
    }
    if (this.remoteSockets.delete(socketId)) {
      this.touch();
      return 'remote';
    }
    for (const p of this.players.values()) {
      if (p.socketId === socketId) {
        p.socketId = null;
        p.connected = false;
        p.disconnectedAt = Date.now();
        this.touch();
        return 'player';
      }
    }
    return null;
  }

  rename(rec: PlayerRec, nickname: string): string | ErrorCode {
    const next = this.normalizeNickname(nickname, rec.id);
    if (next === 'NICKNAME_BLOCKED') return next;
    rec.nickname = next;
    this.touch();
    return next;
  }

  kick(playerId: string): PlayerRec | null {
    const rec = this.players.get(playerId);
    if (!rec) return null;
    this.players.delete(playerId);
    this.kickedTokens.add(rec.token);
    this.touch();
    return rec;
  }

  survey(rec: PlayerRec, answer: SurveyAnswer): void {
    if (answer.phase === 'lobby' && answer.comfort) rec.survey.lobby = answer.comfort;
    if (answer.phase === 'end') {
      if (answer.comfort) rec.survey.endComfort = answer.comfort;
      if (answer.newPeople !== undefined) rec.survey.newPeople = answer.newPeople;
      if (answer.comment !== undefined) {
        const c = cleanText(answer.comment, LIMITS.comment);
        if (!c) delete rec.survey.comment;
        else if (!containsProfanity(c)) rec.survey.comment = c;
      }
    }
    this.touch();
  }

  // ── 게임 컨텍스트 ─────────────────────────────────────
  teamIdOf(playerId: string): string | null {
    return this.teams?.find((t) => t.memberIds.includes(playerId))?.id ?? null;
  }

  gamePlayers(): GamePlayer[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      connected: p.connected,
      teamId: this.teamIdOf(p.id),
      bot: p.bot,
    }));
  }

  ctx(): GameCtx {
    return {
      now: this.gameNow(),
      players: this.gamePlayers(),
      teams: this.teams,
      pack: this.pack,
      rng: this.game?.rng ?? createRng(this.seed),
      settings: this.settings,
      history: this.summaries,
    };
  }

  // ── 진행 ─────────────────────────────────────────────
  command(cmd: HostCommand): ErrorCode | null {
    this.touch();
    switch (cmd.type) {
      case 'start':
        if (this.phase !== 'lobby') return 'INVALID_STATE';
        this.resume();
        this.startedAt = Date.now();
        this.enterIntro(0);
        return null;
      case 'next':
        return this.next();
      case 'skip':
        if (this.phase === 'lobby' || this.phase === 'finished') return 'INVALID_STATE';
        this.resume();
        this.advanceFlow();
        return null;
      case 'pause':
        if (!this.paused && this.phase !== 'lobby' && this.phase !== 'finished') {
          this.pausedAt = serverNow();
          this.pauseReason = 'host';
        }
        return null;
      case 'resume':
        this.resume();
        return null;
      case 'end':
        this.finishSession();
        return null;
      case 'kick':
        return null; // 소켓 처리가 필요해 RoomManager에서 다룬다
      case 'game': {
        if (!this.game || this.paused || this.phase !== 'playing') return 'INVALID_STATE';
        this.game.module.hostAction?.(this.game.state, this.ctx(), cmd.action, cmd.data);
        return null;
      }
      case 'setFlow':
        if (this.phase !== 'lobby') return 'INVALID_STATE';
        this.flow = [...cmd.flow];
        return null;
      case 'addBots':
        if (this.phase === 'finished') return 'INVALID_STATE';
        return this.addBots(cmd.count) > 0 ? null : 'ROOM_FULL';
      case 'clearBots':
        this.clearBots();
        return null;
    }
  }

  private resume(): void {
    if (this.pausedAt !== null) {
      this.pauseAccum += serverNow() - this.pausedAt;
      this.pausedAt = null;
    }
    this.pauseReason = null;
  }

  private next(): ErrorCode | null {
    this.resume();
    switch (this.phase) {
      case 'lobby':
        this.startedAt = Date.now();
        this.enterIntro(0);
        return null;
      case 'intro':
        this.startGame();
        return null;
      case 'playing':
        this.finishGame();
        return null;
      case 'result':
        this.advanceFlow();
        return null;
      case 'finished':
        return 'INVALID_STATE';
    }
  }

  private setPhase(phase: RoomPhase): void {
    this.phase = phase;
    this.phaseSince = this.gameNow();
    this.dirty = true;
  }

  private enterIntro(index: number): void {
    const id = this.flow[index];
    if (!id) {
      this.finishSession();
      return;
    }
    this.index = index;
    const module = GAMES[id];
    const rng = createRng(hashSeed(this.code, this.createdAt, index, id));
    this.game = { id, module, state: null, rng, summary: null };
    this.game.state = module.init(this.ctx());
    this.setPhase('intro');
  }

  private startGame(): void {
    if (!this.game || this.phase !== 'intro') return;
    this.game.module.start(this.game.state, this.ctx());
    this.setPhase('playing');
  }

  private finishGame(): void {
    if (!this.game || this.phase !== 'playing') return;
    const summary = this.game.module.summary(this.game.state, this.ctx());
    this.game.summary = summary;
    this.summaries.push(summary);
    if (summary.teams && summary.teams.length > 0) this.teams = summary.teams;
    this.setPhase('result');
  }

  private advanceFlow(): void {
    if (this.index + 1 < this.flow.length) this.enterIntro(this.index + 1);
    else this.finishSession();
  }

  finishSession(): void {
    if (this.phase === 'finished') return;
    this.resume();
    if (this.phase === 'playing') this.finishGame();
    this.game = null;
    this.endedAt = Date.now();
    this.activeAtEnd = this.connectedHumans().length;
    this.setPhase('finished');
  }

  input(playerId: string, input: unknown, clientAt: unknown): void {
    if (!this.game || this.paused || this.phase !== 'playing') return;
    const rec = this.players.get(playerId);
    if (!rec || !rec.inputLimiter.allow()) return;
    const atServer = sanitizeClientTime(clientAt, serverNow());
    this.game.module.input(this.game.state, this.ctx(), playerId, input, atServer - this.pauseAccum);
    this.lastActivity = Date.now();
    this.dirty = true;
  }

  /** 50ms마다 호출된다. 게임 타이머·판정을 진행하고, 끝났으면 결과 단계로 넘긴다 */
  tick(): void {
    if (!this.game || this.paused) return;
    if (this.phase !== 'intro' && this.phase !== 'playing') return;
    const ctx = this.ctx();
    this.game.module.tick(this.game.state, ctx);
    if (this.phase === 'playing' && this.game.module.finished(this.game.state, ctx)) this.finishGame();
    this.dirty = true;
  }

  // ── 클라이언트로 나가는 상태 ─────────────────────────────
  surveyStats(): SurveyStats {
    const ps = [...this.players.values()];
    const lobby = ps.map((p) => p.survey.lobby).filter((v): v is number => typeof v === 'number');
    const end = ps.map((p) => p.survey.endComfort).filter((v): v is number => typeof v === 'number');
    const newPeople: [number, number, number, number] = [0, 0, 0, 0];
    for (const p of ps) {
      const b = p.survey.newPeople;
      if (typeof b === 'number' && b >= 0 && b <= 3) newPeople[b] += 1;
    }
    return {
      lobby: { count: lobby.length, avg: average(lobby) },
      end: { count: end.length, avg: average(end), newPeople },
    };
  }

  /** 한 줄 소감: 사람만, 누가 썼는지 알 수 없게 시드로 섞는다 */
  quotes(): string[] {
    const list = [...this.players.values()]
      .filter((p) => !p.bot && p.survey.comment)
      .map((p) => p.survey.comment as string);
    return createRng(this.seed ^ 0x2545f491).shuffle(list);
  }

  report(): SessionReport {
    const soundmate = this.summaries.find((s) => s.gameId === 'soundmate');
    const vault = this.summaries.find((s) => s.gameId === 'vault');
    const active = this.phase === 'finished' ? this.activeAtEnd : this.connectedHumans().length;
    return {
      id: this.sessionId,
      roomCode: this.code,
      packName: this.pack.name,
      packCode: this.pack.code,
      preset: this.pack.preset,
      startedAt: new Date(this.startedAt ?? this.createdAt).toISOString(),
      endedAt: this.endedAt ? new Date(this.endedAt).toISOString() : null,
      peakPlayers: this.peakPlayers,
      bots: this.peakBots,
      activeAtEnd: active,
      retention: this.peakPlayers ? Math.round((active / this.peakPlayers) * 100) : 0,
      flow: this.flow,
      games: this.summaries,
      survey: this.surveyStats(),
      quotes: this.quotes(),
      metrics: {
        faceToFace: soundmate?.metrics.faceToFace ?? 0,
        links: soundmate?.metrics.links ?? 0,
        wrongLinks: soundmate?.metrics.wrongLinks ?? 0,
        reactions: this.reactions,
        vaultSuccessRate: vault?.metrics.successRate ?? -1,
      },
    };
  }

  /**
   * 오늘 같은 팀이었던 사람들. 아이스브레이킹이 끝나면 이름을 잊기 쉬워서,
   * 끝난 화면에 남겨 두고 나가면서 한마디 더 걸 수 있게 한다. 봇과 나간 사람은 뺀다.
   */
  metFor(playerId: string): MetPerson[] {
    const together = new Map<string, number>();
    for (const s of this.summaries) {
      const team = s.teams?.find((t) => t.memberIds.includes(playerId));
      if (!team) continue;
      for (const id of new Set(team.memberIds)) {
        if (id !== playerId) together.set(id, (together.get(id) ?? 0) + 1);
      }
    }
    const out: MetPerson[] = [];
    for (const [id, games] of together) {
      const p = this.players.get(id);
      if (p && !p.bot) out.push({ nickname: p.nickname, color: p.color, games });
    }
    return out.sort((a, b) => b.games - a.games || a.nickname.localeCompare(b.nickname, 'ko'));
  }

  roomState(role: ClientRole, playerId?: string): RoomState {
    const isHost = role !== 'player';
    const me = playerId ? this.players.get(playerId) : undefined;
    const players: PlayerSummary[] | null = isHost
      ? [...this.players.values()].map((p) => ({
          id: p.id,
          nickname: p.nickname,
          color: p.color,
          connected: p.connected,
          teamId: this.teamIdOf(p.id),
          bot: p.bot,
        }))
      : null;
    return {
      code: this.code,
      role,
      phase: this.phase,
      flow: this.flow,
      index: this.index,
      gameId: this.game?.id ?? null,
      packName: this.pack.name,
      preset: this.pack.preset,
      playerCount: this.connectedPlayers().length,
      botCount: this.botCount(),
      players,
      teams: isHost ? this.teams : null,
      timeBase: this.pauseAccum,
      paused: this.paused,
      pausedAt: this.paused ? this.gameNow() : null,
      pauseReason: this.paused ? (this.pauseReason ?? 'host') : null,
      phaseSince: this.phaseSince,
      hostConnected: this.hostSockets.size > 0,
      history: isHost ? this.summaries : null,
      you: me
        ? {
            id: me.id,
            nickname: me.nickname,
            color: me.color,
            teamId: this.teamIdOf(me.id),
            ...(this.phase === 'finished' ? { met: this.metFor(me.id) } : {}),
          }
        : null,
      survey: isHost && (this.phase === 'lobby' || this.phase === 'finished') ? this.surveyStats() : null,
      report: isHost && this.phase === 'finished' ? this.report() : null,
      settings: this.settings,
      joinPath: `/play/${this.code}`,
    };
  }

  viewFor(ctx: GameCtx, role: ClientRole, playerId?: string): ViewEnvelope | null {
    const game = this.game;
    if (!game || (this.phase !== 'intro' && this.phase !== 'playing' && this.phase !== 'result')) return null;
    const view =
      role === 'player'
        ? playerId && this.players.has(playerId)
          ? game.module.playerView(game.state, ctx, playerId)
          : null
        : game.module.hostView(game.state, ctx);
    return {
      gameId: game.id,
      index: this.index,
      phase: this.phase,
      view,
      summary: this.phase === 'result' ? game.summary : null,
    };
  }

  // ── 저장과 복구 (서버 재시작 대비) ────────────────────────
  toSnapshot(): RoomSnapshot {
    return {
      v: 1,
      savedAt: serverNow(),
      code: this.code,
      identity: {
        hostToken: this.hostToken,
        hostPin: this.hostPin,
        sessionId: this.sessionId,
        createdAt: this.createdAt,
      },
      pack: this.pack,
      flow: this.flow,
      settings: this.settings,
      phase: this.phase,
      index: this.index,
      phaseSince: this.phaseSince,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        token: p.token,
        nickname: p.nickname,
        color: p.color,
        joinedAt: p.joinedAt,
        survey: p.survey,
        bot: p.bot,
      })),
      kickedTokens: [...this.kickedTokens],
      teams: this.teams,
      game: this.game ? { id: this.game.id, state: this.game.state, summary: this.game.summary } : null,
      summaries: this.summaries,
      pauseAccum: this.pauseAccum,
      pausedAt: this.pausedAt,
      pauseReason: this.pauseReason,
      peakPlayers: this.peakPlayers,
      peakBots: this.peakBots,
      reactions: this.reactions,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      activeAtEnd: this.activeAtEnd,
      lastActivity: this.lastActivity,
      colorCursor: this.colorCursor,
    };
  }

  /**
   * 저장본에서 방을 되살린다. 사람들은 "잠깐 나간" 상태로 시작해 토큰으로 다시 붙고,
   * 게임 중이었다면 저장 순간에서 일시정지해 둔다(꺼져 있던 시간만큼 타이머가 흐르지 않게).
   * 진행자가 "다시 진행"을 누르면 이어서 한다.
   */
  static fromSnapshot(snap: RoomSnapshot): Room {
    const room = new Room({
      code: snap.code,
      pack: snap.pack,
      flow: snap.flow,
      settings: snap.settings,
      identity: snap.identity,
    });
    room.phase = snap.phase;
    room.index = snap.index;
    room.phaseSince = snap.phaseSince;
    room.kickedTokens = new Set(snap.kickedTokens);
    room.teams = snap.teams;
    room.summaries = snap.summaries;
    room.pauseAccum = snap.pauseAccum;
    room.pausedAt = snap.pausedAt;
    room.pauseReason = snap.pausedAt === null ? null : (snap.pauseReason ?? 'host');
    room.peakPlayers = snap.peakPlayers;
    room.peakBots = snap.peakBots;
    room.reactions = snap.reactions;
    room.startedAt = snap.startedAt;
    room.endedAt = snap.endedAt;
    room.activeAtEnd = snap.activeAtEnd;
    room.lastActivity = snap.lastActivity;
    room.colorCursor = snap.colorCursor;
    const now = Date.now();
    for (const p of snap.players) {
      const rec: PlayerRec = {
        ...p,
        socketId: null,
        connected: p.bot, // 봇은 서버 안에 있으니 바로 이어서 논다
        disconnectedAt: p.bot ? null : now, // 사람은 "잠깐 나감" → 토큰으로 다시 붙으면 새로 온 사람으로 치지 않는다
        inputLimiter: new RateLimiter(40, 1000),
        reactLimiter: new RateLimiter(4, 2000),
        brain: null,
      };
      if (rec.bot) rec.brain = new BotBrain(rec.id, { hub: room.botHub, surveys: false, chatty: true });
      room.players.set(rec.id, rec);
    }
    if (snap.game) {
      const module = GAMES[snap.game.id];
      room.game = {
        id: snap.game.id,
        module,
        state: snap.game.state,
        rng: createRng(hashSeed(snap.code, snap.identity.createdAt, snap.index, snap.game.id, snap.savedAt)),
        summary: snap.game.summary,
      };
    }
    const running = room.phase === 'intro' || room.phase === 'playing' || room.phase === 'result';
    if (running && room.pausedAt === null) {
      room.pausedAt = snap.savedAt;
      room.pauseReason = 'restart';
    }
    room.dirty = true;
    return room;
  }
}
