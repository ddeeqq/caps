import {
  cleanText,
  containsProfanity,
  createRng,
  GAMES,
  hashSeed,
  LIMITS,
  PLAYER_COLORS,
  randomNickname,
  sanitizeClientTime,
  uniqueNickname,
  type ClientRole,
  type ErrorCode,
  type GameCtx,
  type GameId,
  type GameModule,
  type GamePlayer,
  type GameSummary,
  type HostCommand,
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

export interface PlayerRec {
  id: string;
  token: string;
  nickname: string;
  color: string;
  socketId: string | null;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
  survey: { lobby?: number; endComfort?: number; newPeople?: number };
  inputLimiter: RateLimiter;
  reactLimiter: RateLimiter;
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
}

const average = (xs: number[]): number | null =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;

/**
 * 방 하나의 모든 상태. 판정과 진행은 전부 여기서 일어나고(서버 권위),
 * 클라이언트에는 roomState / viewFor 결과만 나간다.
 */
export class Room {
  readonly code: string;
  readonly hostToken = newToken();
  readonly hostPin = newPin();
  readonly sessionId = `${newId()}${newId()}`;
  readonly createdAt = Date.now();
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
  dirty = true;
  peakPlayers = 0;
  reactions = 0;
  startedAt: number | null = null;
  endedAt: number | null = null;
  activeAtEnd = 0;
  lastActivity = Date.now();
  private readonly nickRng: Rng;
  private colorCursor = 0;

  constructor(opts: RoomOptions) {
    this.code = opts.code;
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

  // ── 참가자 ───────────────────────────────────────────
  connectedPlayers(): PlayerRec[] {
    return [...this.players.values()].filter((p) => p.connected);
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

  addPlayer(nickname: string): PlayerRec {
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
    };
    this.players.set(rec.id, rec);
    this.touch();
    return rec;
  }

  attachPlayer(rec: PlayerRec, socketId: string): void {
    const isNewcomer = rec.socketId === null && rec.disconnectedAt === null;
    rec.socketId = socketId;
    rec.connected = true;
    rec.disconnectedAt = null;
    this.peakPlayers = Math.max(this.peakPlayers, this.connectedPlayers().length);
    if (isNewcomer && this.game && (this.phase === 'intro' || this.phase === 'playing')) {
      this.game.module.playerJoined?.(this.game.state, this.ctx(), rec.id);
    }
    this.touch();
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
        if (!this.paused && this.phase !== 'lobby' && this.phase !== 'finished') this.pausedAt = serverNow();
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
    }
  }

  private resume(): void {
    if (this.pausedAt !== null) {
      this.pauseAccum += serverNow() - this.pausedAt;
      this.pausedAt = null;
    }
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
    this.activeAtEnd = this.connectedPlayers().length;
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

  report(): SessionReport {
    const soundmate = this.summaries.find((s) => s.gameId === 'soundmate');
    const vault = this.summaries.find((s) => s.gameId === 'vault');
    const active = this.phase === 'finished' ? this.activeAtEnd : this.connectedPlayers().length;
    return {
      id: this.sessionId,
      roomCode: this.code,
      packName: this.pack.name,
      packCode: this.pack.code,
      preset: this.pack.preset,
      startedAt: new Date(this.startedAt ?? this.createdAt).toISOString(),
      endedAt: this.endedAt ? new Date(this.endedAt).toISOString() : null,
      peakPlayers: this.peakPlayers,
      activeAtEnd: active,
      retention: this.peakPlayers ? Math.round((active / this.peakPlayers) * 100) : 0,
      flow: this.flow,
      games: this.summaries,
      survey: this.surveyStats(),
      metrics: {
        faceToFace: soundmate?.metrics.faceToFace ?? 0,
        links: soundmate?.metrics.links ?? 0,
        wrongLinks: soundmate?.metrics.wrongLinks ?? 0,
        reactions: this.reactions,
        vaultSuccessRate: vault?.metrics.successRate ?? -1,
      },
    };
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
      players,
      teams: isHost ? this.teams : null,
      timeBase: this.pauseAccum,
      paused: this.paused,
      pausedAt: this.paused ? this.gameNow() : null,
      phaseSince: this.phaseSince,
      hostConnected: this.hostSockets.size > 0,
      history: isHost ? this.summaries : null,
      you: me ? { id: me.id, nickname: me.nickname, color: me.color, teamId: this.teamIdOf(me.id) } : null,
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
}
