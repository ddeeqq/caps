import type { TeamInfo } from '../util/teams';
import { clamp, colorOf, inputType, isConnected, nicknameOf, tableTeams } from './common';
import type { GameCtx, GameModule, GameSummary } from './types';
import { SPECTRUM_PRESET, SPECTRUMS, type Spectrum } from './words';

/**
 * 추가 게임: 파장 맞추기 (보드게임 Wavelength에서 가져온 구조)
 * "차가운 ↔ 뜨거운" 같은 양 끝이 있는 눈금 위에 비밀 목표 지점이 있다.
 * 팀의 출제자만 그 지점을 보고, 그 위치를 가리킬 "무언가"를 한마디로 말한다 (예: 74쯤이면 "찜질방").
 * 나머지는 폰의 바늘을 움직이고, 팀원 바늘의 평균이 팀의 답이 된다.
 *
 * 말문에 맞춘 점: 정답이 없는 감각을 맞추는 게임이라 "왜 그게 80이야?" 같은 말이 저절로 나온다.
 * 바늘을 평균으로 합치므로 혼자 우겨서는 안 되고, 팀이 말로 모아야 한다.
 */

export interface WaveTable {
  teamId: string;
  name: string;
  color: string;
  memberIds: string[];
  psychicId: string;
  target: number;
  guesses: Record<string, number>;
  locked: Record<string, boolean>;
  result: { needle: number; distance: number; points: number } | null;
  total: number;
}

export interface WaveState {
  stage: 'intro' | 'guess' | 'reveal' | 'done';
  round: number;
  rounds: number;
  deadline: number;
  spectrum: Spectrum;
  spectrumOrder: number[];
  teams: TeamInfo[];
  tables: WaveTable[];
  guessMs: number;
  revealMs: number;
  history: Array<{ round: number; spectrum: Spectrum; bullseyes: number; avgDistance: number }>;
}

export interface WaveHostTable {
  name: string;
  color: string;
  psychicName: string;
  locked: number;
  guessers: number;
  needle: number | null;
  target: number | null;
  points: number | null;
  total: number;
}

export interface WaveHostView {
  stage: WaveState['stage'];
  round: number;
  rounds: number;
  deadline: number;
  spectrum: Spectrum;
  tables: WaveHostTable[];
}

export interface WaveMate {
  nickname: string;
  color: string;
  v: number | null;
  locked: boolean;
}

export interface WavePlayerView {
  stage: WaveState['stage'];
  round: number;
  rounds: number;
  deadline: number;
  spectrum: Spectrum;
  seated: boolean;
  tableName: string;
  tableColor: string;
  isPsychic: boolean;
  psychicName: string;
  /** 출제자에게만, 그리고 공개 때는 모두에게 */
  target: number | null;
  myGuess: number | null;
  locked: boolean;
  mates: WaveMate[];
  /** 팀원 바늘의 평균 (지금 팀의 답) */
  needle: number | null;
  lockedCount: number;
  guessers: number;
  result: WaveTable['result'];
  total: number;
  rank: number;
}

const MIN_TABLE = 2;

/** 거리별 점수: 정중앙 4점, 가까우면 3점, 근처면 2점 */
export function wavePoints(distance: number): number {
  if (distance <= 4) return 4;
  if (distance <= 10) return 3;
  if (distance <= 17) return 2;
  return 0;
}

function spectrumPool(ctx: GameCtx): Spectrum[] {
  return [...SPECTRUM_PRESET[ctx.pack.preset], ...SPECTRUMS];
}

function tableOf(s: WaveState, playerId: string): WaveTable | null {
  return s.tables.find((t) => t.memberIds.includes(playerId)) ?? null;
}

function guessersOf(ctx: GameCtx, t: WaveTable): string[] {
  return t.memberIds.filter((id) => id !== t.psychicId && isConnected(ctx, id));
}

function needleOf(ctx: GameCtx, t: WaveTable): number | null {
  const vals = guessersOf(ctx, t)
    .map((id) => t.guesses[id])
    .filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function deal(s: WaveState, ctx: GameCtx): void {
  const pool = spectrumPool(ctx);
  s.spectrum = pool[s.spectrumOrder[(s.round - 1) % s.spectrumOrder.length]! % pool.length]!;
  for (const t of s.tables) {
    // 출제자는 돌아가며 맡는다 (지금 접속한 사람 중에서)
    const live = t.memberIds.filter((id) => isConnected(ctx, id));
    const ring = live.length > 0 ? live : t.memberIds;
    t.psychicId = ring[(s.round - 1) % ring.length] ?? '';
    t.target = ctx.rng.int(8, 92);
    t.guesses = {};
    t.locked = {};
    t.result = null;
  }
  s.stage = 'guess';
  s.deadline = ctx.now + s.guessMs;
}

function reveal(s: WaveState, ctx: GameCtx): void {
  let bullseyes = 0;
  let distSum = 0;
  for (const t of s.tables) {
    const needle = needleOf(ctx, t) ?? 50;
    const distance = Math.abs(needle - t.target);
    const points = wavePoints(distance);
    if (points === 4) bullseyes += 1;
    distSum += distance;
    t.result = { needle, distance, points };
    t.total += points;
  }
  s.history.push({
    round: s.round,
    spectrum: s.spectrum,
    bullseyes,
    avgDistance: s.tables.length ? Math.round(distSum / s.tables.length) : 0,
  });
  s.stage = 'reveal';
  s.deadline = ctx.now + s.revealMs;
}

function ranking(s: WaveState): WaveTable[] {
  return [...s.tables].sort((a, b) => b.total - a.total);
}

export const wavelength: GameModule<WaveState, WaveHostView, WavePlayerView> = {
  meta: {
    id: 'wavelength',
    title: '파장 맞추기',
    tagline: '한 명이 한마디 하면, 팀이 바늘로 마음을 맞춰요',
    rules: [
      '팀마다 출제자 한 명만 눈금 위 비밀 지점을 봐요',
      '출제자는 그 지점을 가리킬 무언가를 한마디로 말해요',
      '나머지는 바늘을 움직여요. 팀원 바늘의 평균이 팀의 답!',
      '정중앙 4점, 가까우면 3점, 근처면 2점. 출제자는 매번 바뀌어요',
    ],
    minPlayers: 2,
    permissions: [],
    usesPack: ['teamNames'],
    teamMode: 'uses',
    minutes: 5,
    extra: true,
  },

  init(ctx) {
    const pool = spectrumPool(ctx);
    const presetCount = SPECTRUM_PRESET[ctx.pack.preset].length;
    // 첫 판은 모임 종류에 맞는 눈금 중 하나, 그다음은 섞어서
    const first = ctx.rng.int(0, Math.max(0, presetCount - 1));
    const rest = ctx.rng.shuffle(pool.map((_, i) => i).filter((i) => i !== first));
    return {
      stage: 'intro',
      round: 0,
      rounds: ctx.settings.waveRounds,
      deadline: 0,
      spectrum: pool[first]!,
      spectrumOrder: [first, ...rest],
      teams: [],
      tables: [],
      guessMs: ctx.settings.waveSeconds * 1000,
      revealMs: 8_000,
      history: [],
    };
  },

  start(s, ctx) {
    s.teams = tableTeams(ctx, MIN_TABLE);
    s.tables = s.teams.map((t) => ({
      teamId: t.id,
      name: t.name,
      color: t.color,
      memberIds: [...t.memberIds],
      psychicId: '',
      target: 50,
      guesses: {},
      locked: {},
      result: null,
      total: 0,
    }));
    s.round = 1;
    deal(s, ctx);
  },

  input(s, ctx, playerId, input) {
    if (s.stage !== 'guess') return;
    const t = tableOf(s, playerId);
    if (!t || t.psychicId === playerId) return;
    const type = inputType(input);
    if (type === 'dial') {
      const v = (input as { v?: unknown }).v;
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      t.guesses[playerId] = Math.round(clamp(v, 0, 100));
      t.locked[playerId] = false;
      return;
    }
    if (type === 'lock') {
      if (t.guesses[playerId] === undefined) return;
      t.locked[playerId] = true;
      const allLocked = s.tables.every((tb) => guessersOf(ctx, tb).every((id) => tb.locked[id]));
      if (allLocked) reveal(s, ctx);
    }
  },

  tick(s, ctx) {
    if (s.stage === 'guess' && ctx.now >= s.deadline) return reveal(s, ctx);
    if (s.stage === 'reveal' && ctx.now >= s.deadline) {
      if (s.round >= s.rounds) {
        s.stage = 'done';
        return;
      }
      s.round += 1;
      deal(s, ctx);
    }
  },

  hostAction(s, ctx, action) {
    if (action === 'end-guess' && s.stage === 'guess') reveal(s, ctx);
  },

  finished(s) {
    return s.stage === 'done';
  },

  playerJoined(s, ctx, playerId) {
    if (tableOf(s, playerId) || s.tables.length === 0) return;
    const t = [...s.tables].sort((a, b) => a.memberIds.length - b.memberIds.length)[0]!;
    t.memberIds.push(playerId);
    const team = s.teams.find((tm) => tm.id === t.teamId);
    if (team && !team.memberIds.includes(playerId)) team.memberIds.push(playerId);
    void ctx;
  },

  hostView(s, ctx) {
    const shown = s.stage === 'reveal' || s.stage === 'done';
    return {
      stage: s.stage,
      round: s.round,
      rounds: s.rounds,
      deadline: s.deadline,
      spectrum: s.spectrum,
      tables: s.tables.map((t) => {
        const g = guessersOf(ctx, t);
        return {
          name: t.name,
          color: t.color,
          psychicName: nicknameOf(ctx, t.psychicId),
          locked: g.filter((id) => t.locked[id]).length,
          guessers: g.length,
          needle: shown ? (t.result?.needle ?? null) : null,
          target: shown ? t.target : null,
          points: shown ? (t.result?.points ?? null) : null,
          total: t.total,
        };
      }),
    };
  },

  playerView(s, ctx, playerId) {
    const t = tableOf(s, playerId);
    const shown = s.stage === 'reveal' || s.stage === 'done';
    const isPsychic = !!t && t.psychicId === playerId;
    const g = t ? guessersOf(ctx, t) : [];
    const rank = t ? ranking(s).findIndex((x) => x === t) + 1 : 0;
    return {
      stage: s.stage,
      round: s.round,
      rounds: s.rounds,
      deadline: s.deadline,
      spectrum: s.spectrum,
      seated: !!t,
      tableName: t?.name ?? '',
      tableColor: t?.color ?? '#999999',
      isPsychic,
      psychicName: t ? nicknameOf(ctx, t.psychicId) : '',
      target: t && (isPsychic || shown) ? t.target : null,
      myGuess: t?.guesses[playerId] ?? null,
      locked: t?.locked[playerId] ?? false,
      mates: t
        ? g
            .filter((id) => id !== playerId)
            .map((id) => ({
              nickname: nicknameOf(ctx, id),
              color: colorOf(ctx, id),
              v: t.guesses[id] ?? null,
              locked: t.locked[id] ?? false,
            }))
        : [],
      needle: t ? (shown ? (t.result?.needle ?? null) : needleOf(ctx, t)) : null,
      lockedCount: t ? g.filter((id) => t.locked[id]).length : 0,
      guessers: g.length,
      result: t?.result ?? null,
      total: t?.total ?? 0,
      rank,
    };
  },

  summary(s): GameSummary {
    const ranked = ranking(s);
    const top = ranked[0];
    const bullseyes = s.history.reduce((n, h) => n + h.bullseyes, 0);
    const avg = s.history.length
      ? Math.round(s.history.reduce((n, h) => n + h.avgDistance, 0) / s.history.length)
      : 0;
    const highlights = [`정중앙 명중 ${bullseyes}번, 평균 ${avg}칸 차이`];
    if (ranked.length > 1) highlights.push(ranked.map((t) => `${t.name} ${t.total}점`).join(' · '));
    return {
      gameId: 'wavelength',
      title: '파장 맞추기',
      headline: top ? `${top.name} 팀이 가장 잘 통했어요 (${top.total}점)` : '마음을 맞춰 봤어요',
      highlights,
      metrics: { rounds: s.history.length, bullseyes, avgDistance: avg },
      teams: s.teams.map((t) => ({ ...t, memberIds: [...t.memberIds] })),
      ranking: ranked.map((t) => t.teamId),
    };
  },
};
