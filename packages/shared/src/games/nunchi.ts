import { colorOf, connectedPlayers, inputType, isConnected, nicknameOf } from './common';
import type { GameCtx, GameModule, GameSummary } from './types';

/**
 * 게임 ① 디지털 눈치게임
 * 화면 전체가 버튼 하나. 1부터 아무나 누르면 다음 숫자를 가져간다.
 * 같은 숫자를 충돌 창(기본 0.3초) 안에 겹쳐 누른 사람들, 또는 끝까지 못 누른 마지막 한 명이 벌칙자.
 * 탈락은 없고 벌칙 횟수만 쌓인다.
 *
 * 판정은 도착 순서가 아니라 "보정된 탭 시각"으로 한다. 늦게 도착하는 느린 폰의 탭까지 모으려고
 * 첫 탭 이후 충돌 창 + 지연 여유(graceMs)만큼 기다렸다가 확정한다.
 */

export type NunchiStage = 'waiting' | 'countdown' | 'open' | 'roundEnd' | 'done';
export type NunchiOutcomeKind = 'collision' | 'last' | 'idle' | 'empty';

export interface NunchiTap {
  playerId: string;
  t: number;
}

export interface NunchiOutcome {
  kind: NunchiOutcomeKind;
  number: number;
  losers: string[];
  taps: NunchiTap[];
}

export interface NunchiState {
  stage: NunchiStage;
  round: number;
  totalRounds: number;
  windowMs: number;
  graceMs: number;
  idleMs: number;
  countdownMs: number;
  roundEndMs: number;
  openAt: number;
  participants: string[];
  pressed: Record<string, number>;
  nextNumber: number;
  buffer: NunchiTap[];
  lastClaimAt: number;
  roundEndAt: number;
  claims: Array<{ number: number; playerId: string; t: number }>;
  outcome: NunchiOutcome | null;
  penalties: Record<string, number>;
  penaltyText: Record<string, string>;
  history: Array<{ round: number; kind: NunchiOutcomeKind; number: number; losers: string[]; spreadMs: number | null }>;
  closestCall: { round: number; spreadMs: number; players: string[] } | null;
}

export interface NunchiHostView {
  stage: NunchiStage;
  round: number;
  totalRounds: number;
  openAt: number;
  nextNumber: number;
  participantCount: number;
  claimedCount: number;
  recentClaims: Array<{ number: number; nickname: string; color: string }>;
  outcome: null | {
    kind: NunchiOutcomeKind;
    number: number;
    windowMs: number;
    spreadMs: number | null;
    losers: Array<{ nickname: string; color: string; penalty: string }>;
    taps: Array<{ nickname: string; color: string; dt: number }>;
  };
  roundEndAt: number;
  scoreboard: Array<{ nickname: string; color: string; count: number }>;
}

export interface NunchiPlayerView {
  stage: NunchiStage;
  round: number;
  totalRounds: number;
  openAt: number;
  nextNumber: number;
  myNumber: number | null;
  pending: boolean;
  canTap: boolean;
  isParticipant: boolean;
  outcome: null | {
    kind: NunchiOutcomeKind;
    number: number;
    youLost: boolean;
    penalty: string | null;
    loserNames: string[];
    spreadMs: number | null;
  };
  roundEndAt: number;
  myPenalties: number;
}

const EARLY_TOLERANCE_MS = 100;

function connectedParticipants(s: NunchiState, ctx: GameCtx): string[] {
  return s.participants.filter((id) => isConnected(ctx, id));
}

function startRound(s: NunchiState, ctx: GameCtx): void {
  s.round += 1;
  s.participants = connectedPlayers(ctx).map((p) => p.id);
  s.pressed = {};
  s.nextNumber = 1;
  s.buffer = [];
  s.claims = [];
  s.outcome = null;
  s.penaltyText = {};
  if (s.participants.length < 2) {
    s.stage = 'done';
    return;
  }
  s.stage = 'countdown';
  s.openAt = ctx.now + s.countdownMs;
  s.lastClaimAt = s.openAt;
}

function endRound(
  s: NunchiState,
  ctx: GameCtx,
  kind: NunchiOutcomeKind,
  losers: string[],
  number: number,
  taps: NunchiTap[],
): void {
  s.stage = 'roundEnd';
  s.roundEndAt = ctx.now + s.roundEndMs;
  const penalties = ctx.pack.content.penalties;
  for (const id of losers) {
    s.penalties[id] = (s.penalties[id] ?? 0) + 1;
    s.penaltyText[id] = penalties.length > 0 ? ctx.rng.pick(penalties) : '벌칙 당첨';
  }
  const sorted = [...taps].sort((a, b) => a.t - b.t);
  const spreadMs =
    sorted.length >= 2 ? (sorted[sorted.length - 1] as NunchiTap).t - (sorted[0] as NunchiTap).t : null;
  s.outcome = { kind, number, losers, taps: sorted };
  s.history.push({ round: s.round, kind, number, losers, spreadMs });
  if (kind === 'collision' && spreadMs !== null && (!s.closestCall || spreadMs < s.closestCall.spreadMs)) {
    s.closestCall = { round: s.round, spreadMs, players: losers };
  }
}

function resolve(s: NunchiState, ctx: GameCtx): void {
  while (s.buffer.length > 0) {
    const first = s.buffer[0] as NunchiTap;
    const windowEnd = first.t + s.windowMs;
    if (ctx.now < windowEnd + s.graceMs) return; // 느린 폰의 탭을 더 기다린다
    const group = s.buffer.filter((tap) => tap.t <= windowEnd);
    s.buffer = s.buffer.filter((tap) => tap.t > windowEnd);
    if (group.length >= 2) {
      endRound(
        s,
        ctx,
        'collision',
        group.map((g) => g.playerId),
        s.nextNumber,
        group,
      );
      return;
    }
    s.pressed[first.playerId] = s.nextNumber;
    s.claims.push({ number: s.nextNumber, playerId: first.playerId, t: first.t });
    s.nextNumber += 1;
    s.lastClaimAt = first.t;
  }

  const active = connectedParticipants(s, ctx);
  if (active.length < 2 && s.claims.length === 0) {
    endRound(s, ctx, 'empty', [], s.nextNumber, []);
    return;
  }
  const remaining = active.filter((id) => s.pressed[id] === undefined);
  if (remaining.length === 1) {
    endRound(s, ctx, 'last', remaining, s.nextNumber, []);
  } else if (remaining.length === 0) {
    // 모두 겹치지 않고 불렀다면 마지막으로 부른 사람이 벌칙
    const last = s.claims[s.claims.length - 1];
    endRound(s, ctx, 'last', last ? [last.playerId] : [], Math.max(1, s.nextNumber - 1), []);
  } else if (ctx.now - s.lastClaimAt >= s.idleMs) {
    endRound(s, ctx, 'idle', remaining, s.nextNumber, []);
  }
}

export const nunchi: GameModule<NunchiState, NunchiHostView, NunchiPlayerView> = {
  meta: {
    id: 'nunchi',
    title: '디지털 눈치게임',
    tagline: '설명 없이 바로 웃음이 터지는 오프닝',
    rules: [
      '화면 전체가 버튼이에요. 누르면 다음 숫자를 외친 것!',
      '같은 숫자를 0.3초 안에 겹쳐 누르면 겹친 사람 모두 벌칙',
      '끝까지 못 누른 마지막 한 명도 벌칙',
      '탈락은 없어요. 매 라운드 다시 도전!',
    ],
    minPlayers: 3,
    permissions: [],
    usesPack: ['penalties'],
    teamMode: 'none',
    minutes: 3,
  },

  init(ctx) {
    return {
      stage: 'waiting',
      round: 0,
      totalRounds: ctx.settings.nunchiRounds,
      windowMs: ctx.settings.nunchiWindowMs,
      graceMs: 150,
      idleMs: 15_000,
      countdownMs: 3_000,
      roundEndMs: 4_500,
      openAt: 0,
      participants: [],
      pressed: {},
      nextNumber: 1,
      buffer: [],
      lastClaimAt: 0,
      roundEndAt: 0,
      claims: [],
      outcome: null,
      penalties: {},
      penaltyText: {},
      history: [],
      closestCall: null,
    };
  },

  start(s, ctx) {
    startRound(s, ctx);
  },

  input(s, ctx, playerId, input, at) {
    if (inputType(input) !== 'tap') return;
    if (s.stage !== 'countdown' && s.stage !== 'open') return;
    if (!s.participants.includes(playerId)) return;
    if (s.pressed[playerId] !== undefined) return;
    if (s.buffer.some((tap) => tap.playerId === playerId)) return;
    if (at < s.openAt - EARLY_TOLERANCE_MS) return; // 부정 출발은 무시
    const t = Math.max(at, s.openAt);
    s.buffer.push({ playerId, t });
    s.buffer.sort((a, b) => a.t - b.t);
    void ctx;
  },

  tick(s, ctx) {
    if (s.stage === 'countdown' && ctx.now >= s.openAt) s.stage = 'open';
    if (s.stage === 'open') resolve(s, ctx);
    if (s.stage === 'roundEnd' && ctx.now >= s.roundEndAt) {
      if (s.round >= s.totalRounds) s.stage = 'done';
      else startRound(s, ctx);
    }
  },

  finished(s) {
    return s.stage === 'done';
  },

  hostView(s, ctx) {
    const outcome = s.outcome;
    const firstAt = outcome?.taps[0]?.t ?? 0;
    return {
      stage: s.stage,
      round: s.round,
      totalRounds: s.totalRounds,
      openAt: s.openAt,
      nextNumber: s.nextNumber,
      participantCount: s.participants.length,
      claimedCount: s.claims.length,
      recentClaims: s.claims.slice(-6).map((c) => ({
        number: c.number,
        nickname: nicknameOf(ctx, c.playerId),
        color: colorOf(ctx, c.playerId),
      })),
      outcome: outcome
        ? {
            kind: outcome.kind,
            number: outcome.number,
            windowMs: s.windowMs,
            spreadMs:
              outcome.taps.length >= 2
                ? (outcome.taps[outcome.taps.length - 1] as NunchiTap).t - firstAt
                : null,
            losers: outcome.losers.map((id) => ({
              nickname: nicknameOf(ctx, id),
              color: colorOf(ctx, id),
              penalty: s.penaltyText[id] ?? '',
            })),
            taps: outcome.taps.map((tap) => ({
              nickname: nicknameOf(ctx, tap.playerId),
              color: colorOf(ctx, tap.playerId),
              dt: Math.round(tap.t - firstAt),
            })),
          }
        : null,
      roundEndAt: s.roundEndAt,
      scoreboard: Object.entries(s.penalties)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => ({ nickname: nicknameOf(ctx, id), color: colorOf(ctx, id), count })),
    };
  },

  playerView(s, ctx, playerId) {
    const isParticipant = s.participants.includes(playerId);
    const pending = s.buffer.some((tap) => tap.playerId === playerId);
    const myNumber = s.pressed[playerId] ?? null;
    const outcome = s.outcome;
    return {
      stage: s.stage,
      round: s.round,
      totalRounds: s.totalRounds,
      openAt: s.openAt,
      nextNumber: s.nextNumber,
      myNumber,
      pending,
      canTap: (s.stage === 'countdown' || s.stage === 'open') && isParticipant && myNumber === null && !pending,
      isParticipant,
      outcome: outcome
        ? {
            kind: outcome.kind,
            number: outcome.number,
            youLost: outcome.losers.includes(playerId),
            penalty: s.penaltyText[playerId] ?? null,
            loserNames: outcome.losers.map((id) => nicknameOf(ctx, id)),
            spreadMs:
              outcome.taps.length >= 2
                ? Math.round(
                    (outcome.taps[outcome.taps.length - 1] as NunchiTap).t - (outcome.taps[0] as NunchiTap).t,
                  )
                : null,
          }
        : null,
      roundEndAt: s.roundEndAt,
      myPenalties: s.penalties[playerId] ?? 0,
    };
  },

  summary(s, ctx): GameSummary {
    const ranked = Object.entries(s.penalties).sort((a, b) => b[1] - a[1]);
    const collisions = s.history.filter((h) => h.kind === 'collision').length;
    const highlights: string[] = [];
    if (s.closestCall) {
      highlights.push(
        `가장 아슬아슬한 충돌: ${s.closestCall.players.map((id) => nicknameOf(ctx, id)).join(', ')} (${Math.round(
          s.closestCall.spreadMs,
        )}ms 차이)`,
      );
    }
    const top = ranked[0];
    if (top) highlights.push(`벌칙 최다: ${nicknameOf(ctx, top[0])} (${top[1]}회)`);
    const safe = s.participants.filter((id) => !s.penalties[id]);
    if (safe.length > 0 && safe.length <= 3) {
      highlights.push(`한 번도 안 걸린 눈치왕: ${safe.map((id) => nicknameOf(ctx, id)).join(', ')}`);
    }
    return {
      gameId: 'nunchi',
      title: '디지털 눈치게임',
      headline: s.closestCall
        ? `${Math.round(s.closestCall.spreadMs)}ms 차이로 겹친 순간이 최고의 장면`
        : `${s.round}라운드 동안 충돌 ${collisions}번`,
      highlights,
      metrics: {
        rounds: s.round,
        collisions,
        closestSpreadMs: s.closestCall ? Math.round(s.closestCall.spreadMs) : -1,
      },
    };
  },
};
