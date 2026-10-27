import { josa } from '../pack/josa';
import { smallestTeam, type TeamInfo } from '../util/teams';
import { clamp, inputType, isConnected, reconcileTeams } from './common';
import type { GameModule, GameSummary } from './types';

/**
 * 추가 게임: 군중 조종 레이스
 * 팀원 전원의 폰 기울기 평균으로 큰 화면 속 배 한 척을 조종해 바위를 피한다.
 * 한두 명만 반대로 기울여도 배가 흔들리니 "왼쪽!! 왼쪽!!" 소리가 저절로 터진다.
 * 센서 입력 집계(최근 1.5초 안의 값만 평균)가 기술 포인트.
 */

export interface TiltRock {
  y: number;
  x: number;
  r: number;
}

export interface TiltBoat {
  teamId: string;
  x: number;
  progress: number;
  stunnedUntil: number;
  finishedAt: number | null;
  hits: number;
  hitRocks: number[];
  avg: number;
}

export interface TiltraceState {
  stage: 'intro' | 'countdown' | 'race' | 'done';
  teams: TeamInfo[];
  boats: Record<string, TiltBoat>;
  tilts: Record<string, { v: number; at: number }>;
  rocks: TiltRock[];
  length: number;
  startAt: number;
  lastTick: number;
  timeLimitAt: number;
  finishOrder: string[];
}

export interface TiltraceHostView {
  stage: TiltraceState['stage'];
  startAt: number;
  timeLimitAt: number;
  length: number;
  rocks: TiltRock[];
  boats: Array<{
    teamId: string;
    name: string;
    color: string;
    members: number;
    x: number;
    progress: number;
    stunned: boolean;
    finishedAt: number | null;
    rank: number | null;
    hits: number;
    avg: number;
  }>;
}

export interface TiltracePlayerView {
  stage: TiltraceState['stage'];
  startAt: number;
  teamName: string;
  teamColor: string;
  progressPct: number;
  place: number;
  teams: number;
  stunned: boolean;
  finished: boolean;
  avg: number;
  x: number;
}

export const BOAT_HALF_WIDTH = 0.12;
const STEER_SPEED = 1.8;
const SPEED = 1;
const STUN_SPEED = 0.35;
const STUN_MS = 1_200;
const TILT_TTL = 1_500;
const COUNTDOWN_MS = 3_500;

function makeRocks(length: number, rng: { next(): number; pick<T>(a: readonly T[]): T }): TiltRock[] {
  const rocks: TiltRock[] = [];
  const lanes = [-0.62, 0, 0.62] as const;
  let y = 4;
  while (y < length - 2) {
    const lane = rng.pick(lanes);
    rocks.push({ y, x: lane + (rng.next() - 0.5) * 0.16, r: 0.22 });
    if (rng.next() < 0.3) {
      const other = rng.pick(lanes.filter((l) => l !== lane));
      rocks.push({ y: y + 0.2, x: other + (rng.next() - 0.5) * 0.12, r: 0.2 });
    }
    y += 2.6 + rng.next() * 1.2;
  }
  return rocks;
}

function place(s: TiltraceState, teamId: string): number {
  const order = Object.values(s.boats).sort((a, b) => {
    if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
    if (a.finishedAt !== null) return -1;
    if (b.finishedAt !== null) return 1;
    return b.progress - a.progress;
  });
  return order.findIndex((b) => b.teamId === teamId) + 1;
}

export const tiltrace: GameModule<TiltraceState, TiltraceHostView, TiltracePlayerView> = {
  meta: {
    id: 'tiltrace',
    title: '군중 조종 레이스',
    tagline: '팀원 전원의 기울기 평균으로 배 한 척을 조종하라',
    rules: [
      '폰을 좌우로 기울이면 팀 배가 움직여요',
      '팀원 모두의 기울기 평균으로 움직이니 말로 맞춰야 해요',
      '바위에 부딪히면 잠깐 느려져요',
      '센서가 안 되면 화면의 왼쪽·오른쪽 버튼을 꾹 누르세요',
    ],
    minPlayers: 2,
    permissions: ['motion'],
    usesPack: ['teamNames'],
    teamMode: 'uses',
    minutes: 2,
    extra: true,
  },

  init(ctx) {
    const teams = reconcileTeams(ctx);
    const length = ctx.settings.tiltraceLength;
    return {
      stage: 'intro',
      teams,
      boats: Object.fromEntries(
        teams.map((t) => [
          t.id,
          {
            teamId: t.id,
            x: 0,
            progress: 0,
            stunnedUntil: 0,
            finishedAt: null,
            hits: 0,
            hitRocks: [],
            avg: 0,
          },
        ]),
      ),
      tilts: {},
      rocks: makeRocks(length, ctx.rng),
      length,
      startAt: 0,
      lastTick: ctx.now,
      timeLimitAt: 0,
      finishOrder: [],
    };
  },

  start(s, ctx) {
    s.stage = 'countdown';
    s.startAt = ctx.now + COUNTDOWN_MS;
    s.lastTick = ctx.now;
    s.timeLimitAt = s.startAt + (s.length / SPEED) * 1.8 * 1000;
  },

  input(s, ctx, playerId, input) {
    if (inputType(input) !== 'tilt') return;
    const v = Number((input as { v?: unknown }).v);
    if (!Number.isFinite(v)) return;
    s.tilts[playerId] = { v: clamp(v, -1, 1), at: ctx.now };
  },

  tick(s, ctx) {
    if (s.stage === 'intro' || s.stage === 'done') return;
    if (s.stage === 'countdown' && ctx.now >= s.startAt) {
      s.stage = 'race';
      s.lastTick = s.startAt;
    }
    if (s.stage !== 'race') return;
    const dt = clamp((ctx.now - s.lastTick) / 1000, 0, 0.25);
    s.lastTick = ctx.now;
    for (const team of s.teams) {
      const boat = s.boats[team.id];
      if (!boat || boat.finishedAt !== null) continue;
      const fresh = team.memberIds
        .filter((id) => isConnected(ctx, id))
        .map((id) => s.tilts[id])
        .filter((t): t is { v: number; at: number } => !!t && ctx.now - t.at <= TILT_TTL)
        .map((t) => t.v);
      boat.avg = fresh.length ? fresh.reduce((a, b) => a + b, 0) / fresh.length : 0;
      boat.x = clamp(boat.x + boat.avg * STEER_SPEED * dt, -1 + BOAT_HALF_WIDTH, 1 - BOAT_HALF_WIDTH);
      const stunned = ctx.now < boat.stunnedUntil;
      boat.progress += (stunned ? STUN_SPEED : SPEED) * dt;
      s.rocks.forEach((rock, i) => {
        if (boat.hitRocks.includes(i)) return;
        if (Math.abs(rock.y - boat.progress) < 0.3 && Math.abs(rock.x - boat.x) < rock.r + BOAT_HALF_WIDTH) {
          boat.hitRocks.push(i);
          boat.hits += 1;
          boat.stunnedUntil = ctx.now + STUN_MS;
        }
      });
      if (boat.progress >= s.length) {
        boat.progress = s.length;
        boat.finishedAt = ctx.now;
        s.finishOrder.push(team.id);
      }
    }
    const allDone = s.teams.every((t) => s.boats[t.id]?.finishedAt !== null);
    if (allDone || ctx.now >= s.timeLimitAt) s.stage = 'done';
  },

  finished(s) {
    return s.stage === 'done';
  },

  playerJoined(s, ctx, playerId) {
    if (s.teams.some((t) => t.memberIds.includes(playerId))) return;
    const team = smallestTeam(s.teams);
    if (team) team.memberIds.push(playerId);
    void ctx;
  },

  hostView(s) {
    return {
      stage: s.stage,
      startAt: s.startAt,
      timeLimitAt: s.timeLimitAt,
      length: s.length,
      rocks: s.rocks,
      boats: s.teams.map((t) => {
        const b = s.boats[t.id] as TiltBoat;
        const rankIndex = s.finishOrder.indexOf(t.id);
        return {
          teamId: t.id,
          name: t.name,
          color: t.color,
          members: t.memberIds.length,
          x: Math.round(b.x * 1000) / 1000,
          progress: Math.round(b.progress * 100) / 100,
          stunned: s.lastTick < b.stunnedUntil,
          finishedAt: b.finishedAt,
          rank: rankIndex >= 0 ? rankIndex + 1 : null,
          hits: b.hits,
          avg: Math.round(b.avg * 100) / 100,
        };
      }),
    };
  },

  playerView(s, ctx, playerId) {
    const team = s.teams.find((t) => t.memberIds.includes(playerId));
    const boat = team ? s.boats[team.id] : undefined;
    return {
      stage: s.stage,
      startAt: s.startAt,
      teamName: team?.name ?? '',
      teamColor: team?.color ?? '#888888',
      progressPct: boat ? Math.floor((boat.progress / s.length) * 100) : 0,
      place: team ? place(s, team.id) : 0,
      teams: s.teams.length,
      stunned: boat ? ctx.now < boat.stunnedUntil : false,
      finished: boat ? boat.finishedAt !== null : false,
      avg: boat ? Math.round(boat.avg * 10) / 10 : 0,
      x: boat ? Math.round(boat.x * 20) / 20 : 0,
    };
  },

  summary(s): GameSummary {
    const order = [...s.teams]
      .map((t) => ({ t, b: s.boats[t.id] as TiltBoat }))
      .sort((a, b) => {
        if (a.b.finishedAt !== null && b.b.finishedAt !== null) return a.b.finishedAt - b.b.finishedAt;
        if (a.b.finishedAt !== null) return -1;
        if (b.b.finishedAt !== null) return 1;
        return b.b.progress - a.b.progress;
      });
    const winner = order[0]?.t;
    const cleanest = [...order].sort((a, b) => a.b.hits - b.b.hits)[0];
    const totalHits = order.reduce((sum, x) => sum + x.b.hits, 0);
    return {
      gameId: 'tiltrace',
      title: '군중 조종 레이스',
      headline: winner ? `${josa(winner.name, '이/가')} 한마음으로 1등!` : '레이스 끝',
      highlights: [
        cleanest ? `가장 매끄러운 조종: ${cleanest.t.name} (충돌 ${cleanest.b.hits}번)` : '',
        `전체 충돌 ${totalHits}번`,
      ].filter(Boolean),
      metrics: { hits: totalHits, finished: s.finishOrder.length },
      teams: s.teams.map((t) => ({ ...t, memberIds: [...t.memberIds] })),
      ranking: order.map((x) => x.t.id),
    };
  },
};
