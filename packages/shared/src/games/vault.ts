import { josa } from '../pack/josa';
import { DEFAULT_VAULT_SYMBOLS } from '../pack/presets';
import type { Rng } from '../util/rng';
import type { TeamInfo } from '../util/teams';
import { inputType, isConnected, nicknameOf, reconcileTeams, teamForNewcomer } from './common';
import type { GameCtx, GameModule, GameSummary } from './types';

/**
 * 게임 ③ 비대칭 금고 따기
 * 팀원마다 비밀번호의 조각만 보고, 말로 설명해 합쳐야만 금고가 열린다.
 *   순서 담당: 기호 순서 / 해독 담당: 기호 → 숫자 변환표(가짜 기호 포함) / 입력 담당: 다이얼
 *   4인 팀: 규칙 카드(금고 3) 또는 자릿수 합(검산) 담당
 * 퍼즐은 시드 기반으로 생성되고, 서버는 역할별 정보만 해당 폰에 보낸다.
 */

export type VaultRole = 'order' | 'decode' | 'input' | 'rule' | 'checksum';

export const ROLE_LABELS: Record<VaultRole, string> = {
  order: '순서 담당',
  decode: '해독 담당',
  input: '입력 담당',
  rule: '규칙 담당',
  checksum: '검산 담당',
};

export interface VaultLevel {
  seq: number;
  decoys: number;
  rule: boolean;
  seconds: number;
}

export const VAULT_LEVELS: readonly VaultLevel[] = [
  { seq: 3, decoys: 2, rule: false, seconds: 60 },
  { seq: 4, decoys: 4, rule: false, seconds: 60 },
  { seq: 4, decoys: 4, rule: true, seconds: 75 },
];

export type VaultRule =
  | { kind: 'plus'; pos: number; text: string }
  | { kind: 'nineMinus'; pos: number; text: string }
  | { kind: 'swap'; text: string }
  | { kind: 'reverse'; text: string };

export interface VaultPuzzle {
  level: number;
  seq: string[];
  table: Array<{ symbol: string; digit: number }>;
  rule: VaultRule | null;
  raw: number[];
  answer: string;
  checksum: number;
}

export function applyRule(raw: readonly number[], rule: VaultRule | null): number[] {
  const d = [...raw];
  if (!rule) return d;
  switch (rule.kind) {
    case 'plus':
      if (rule.pos < d.length) d[rule.pos] = ((d[rule.pos] as number) + 1) % 10;
      return d;
    case 'nineMinus':
      if (rule.pos < d.length) d[rule.pos] = 9 - (d[rule.pos] as number);
      return d;
    case 'swap':
      if (d.length >= 2) [d[0], d[1]] = [d[1] as number, d[0] as number];
      return d;
    case 'reverse':
      return d.reverse();
  }
}

function makeRule(rng: Rng, digits: number): VaultRule {
  const kind = rng.pick(['plus', 'nineMinus', 'swap', 'reverse'] as const);
  if (kind === 'plus') {
    const pos = rng.int(0, digits - 1);
    return { kind, pos, text: `${pos + 1}번째 자리는 원래 숫자에 1을 더해서 입력해요 (9는 0)` };
  }
  if (kind === 'nineMinus') {
    return { kind, pos: digits - 1, text: '마지막 자리는 9에서 원래 숫자를 뺀 값으로 입력해요' };
  }
  if (kind === 'swap') return { kind, text: '첫째 자리와 둘째 자리를 서로 바꿔서 입력해요' };
  return { kind, text: '전체 순서를 거꾸로 입력해요' };
}

export function generatePuzzle(symbols: readonly string[], levelIndex: number, rng: Rng): VaultPuzzle {
  const level = VAULT_LEVELS[Math.min(levelIndex, VAULT_LEVELS.length - 1)] as VaultLevel;
  const need = level.seq + level.decoys;
  const pool = [...new Set(symbols.map((x) => x.trim()).filter(Boolean))];
  for (const fallback of DEFAULT_VAULT_SYMBOLS) {
    if (pool.length >= need) break;
    if (!pool.includes(fallback)) pool.push(fallback);
  }
  const chosen = rng.sample(pool, need);
  const seq = chosen.slice(0, level.seq);
  const table = rng.shuffle(chosen.map((symbol) => ({ symbol, digit: rng.int(0, 9) })));
  const raw = seq.map((sym) => (table.find((e) => e.symbol === sym) as { digit: number }).digit);
  const rule = level.rule ? makeRule(rng, seq.length) : null;
  const answerDigits = applyRule(raw, rule);
  return {
    level: levelIndex + 1,
    seq,
    table,
    rule,
    raw,
    answer: answerDigits.join(''),
    checksum: answerDigits.reduce((a, b) => a + b, 0),
  };
}

/** 인원에 따라 역할을 나눈다. rotation으로 금고마다 역할을 돌린다. */
export function assignRoles(
  memberIds: readonly string[],
  hasRule: boolean,
  rotation: number,
): Record<string, VaultRole[]> {
  const n = memberIds.length;
  const roles: Record<string, VaultRole[]> = {};
  if (n === 0) return roles;
  const r = memberIds.map((_, i) => memberIds[(i + rotation) % n] as string);
  const ruleRole: VaultRole[] = hasRule ? ['rule'] : [];
  if (n === 1) {
    roles[r[0] as string] = ['order', 'decode', 'input', ...ruleRole];
    return roles;
  }
  if (n === 2) {
    roles[r[0] as string] = ['order', 'decode'];
    roles[r[1] as string] = ['input', ...ruleRole];
    return roles;
  }
  roles[r[0] as string] = ['order'];
  roles[r[1] as string] = ['decode'];
  roles[r[2] as string] = n === 3 ? ['input', ...ruleRole] : ['input'];
  if (n >= 4) roles[r[3] as string] = [hasRule ? 'rule' : 'checksum'];
  for (let i = 4; i < n; i++) roles[r[i] as string] = ['checksum'];
  return roles;
}

export interface VaultTeamState {
  teamId: string;
  safeIndex: number;
  puzzle: VaultPuzzle;
  roles: Record<string, VaultRole[]>;
  startedAt: number;
  deadline: number;
  lockedUntil: number;
  attempts: number;
  lastWrong: string | null;
  status: 'active' | 'solved' | 'failed' | 'finished';
  nextAt: number | null;
  results: Array<{ safe: number; solved: boolean; ms: number; attempts: number }>;
}

export interface VaultState {
  stage: 'intro' | 'play' | 'done';
  teams: TeamInfo[];
  perTeam: Record<string, VaultTeamState>;
  safes: number;
  symbols: string[];
  events: Array<{ text: string; at: number }>;
}

export interface VaultHostView {
  stage: VaultState['stage'];
  safes: number;
  teams: Array<{
    id: string;
    name: string;
    color: string;
    members: number;
    safeIndex: number;
    status: VaultTeamState['status'];
    deadline: number;
    lockedUntil: number;
    attempts: number;
    solved: number;
    totalMs: number;
    results: VaultTeamState['results'];
  }>;
  events: Array<{ text: string; at: number }>;
}

export interface VaultPlayerView {
  stage: VaultState['stage'];
  safes: number;
  safeIndex: number;
  level: number;
  status: VaultTeamState['status'] | 'none';
  deadline: number;
  lockedUntil: number;
  teamName: string;
  teamColor: string;
  roles: VaultRole[];
  digits: number;
  order: string[] | null;
  table: Array<{ symbol: string; digit: number }> | null;
  rule: string | null;
  checksum: number | null;
  lastWrong: string | null;
  attempts: number;
  reveal: string | null;
  roster: Array<{ nickname: string; roles: VaultRole[]; me: boolean }>;
  solved: number;
}

const SOLVED_PAUSE_MS = 3_000;
const FAILED_PAUSE_MS = 4_500;
const WRONG_LOCK_MS = 3_000;

function teamStateFor(s: VaultState, playerId: string): VaultTeamState | null {
  const team = s.teams.find((t) => t.memberIds.includes(playerId));
  return team ? (s.perTeam[team.id] ?? null) : null;
}

function startSafe(s: VaultState, ctx: GameCtx, team: TeamInfo, index: number): void {
  const puzzle = generatePuzzle(s.symbols, index, ctx.rng);
  const members = team.memberIds.filter((id) => isConnected(ctx, id));
  const level = VAULT_LEVELS[Math.min(index, VAULT_LEVELS.length - 1)] as VaultLevel;
  s.perTeam[team.id] = {
    teamId: team.id,
    safeIndex: index,
    puzzle,
    roles: assignRoles(members, puzzle.rule !== null, index),
    startedAt: ctx.now,
    deadline: ctx.now + level.seconds * 1000,
    lockedUntil: 0,
    attempts: 0,
    lastWrong: null,
    status: members.length === 0 ? 'finished' : 'active',
    nextAt: null,
    results: s.perTeam[team.id]?.results ?? [],
  };
}

/** 금고 도중 다시 들어온(역할이 없는) 팀원에게 검산을 맡긴다. 화면에 할 일이 없는 사람이 없게 */
function giveIdleMembersChecksum(ts: VaultTeamState, team: TeamInfo, ctx: GameCtx): void {
  for (const id of team.memberIds) {
    if (!isConnected(ctx, id)) continue;
    if ((ts.roles[id] ?? []).length === 0) ts.roles[id] = ['checksum'];
  }
}

/** 접속이 끊긴 사람의 역할을 남은 팀원 중 역할이 가장 적은 사람에게 넘긴다 */
function reassignOrphanRoles(ts: VaultTeamState, ctx: GameCtx): void {
  const holders = Object.keys(ts.roles);
  const online = holders.filter((id) => isConnected(ctx, id));
  if (online.length === 0) return;
  for (const id of holders) {
    if (isConnected(ctx, id)) continue;
    const orphan = ts.roles[id] ?? [];
    delete ts.roles[id];
    for (const role of orphan) {
      if (role === 'checksum') continue; // 검산은 없어도 진행 가능
      const target = online
        .map((pid) => ({ pid, count: ts.roles[pid]?.length ?? 0 }))
        .sort((a, b) => a.count - b.count)[0];
      if (target) (ts.roles[target.pid] ??= []).push(role);
    }
  }
}

function pushEvent(s: VaultState, text: string, at: number): void {
  s.events.push({ text, at });
  if (s.events.length > 20) s.events.shift();
}

function ranking(s: VaultState): string[] {
  return [...s.teams]
    .map((t) => {
      const results = s.perTeam[t.id]?.results ?? [];
      return {
        id: t.id,
        solved: results.filter((r) => r.solved).length,
        ms: results.filter((r) => r.solved).reduce((a, r) => a + r.ms, 0),
      };
    })
    .sort((a, b) => b.solved - a.solved || a.ms - b.ms)
    .map((x) => x.id);
}

export const vault: GameModule<VaultState, VaultHostView, VaultPlayerView> = {
  meta: {
    id: 'vault',
    title: '비대칭 금고 따기',
    tagline: '각자 조각만 보고, 말로 합쳐야 열린다',
    rules: [
      '팀원마다 화면에 보이는 정보가 달라요 (순서 / 변환표 / 다이얼)',
      '화면은 꾹 누르고 있을 때만 보여요. 말로 설명해서 풀어요',
      '틀리면 3초 잠김. 금고 3개, 뒤로 갈수록 어려워져요',
      '금고마다 역할이 바뀌어요. 모두 한 번씩 설명하는 쪽이 됩니다',
    ],
    minPlayers: 2,
    permissions: [],
    usesPack: ['names', 'keywords'],
    teamMode: 'uses',
    minutes: 8,
  },

  init(ctx) {
    return {
      stage: 'intro',
      teams: reconcileTeams(ctx),
      perTeam: {},
      safes: ctx.settings.vaultSafes,
      symbols: ctx.pack.vaultSymbols,
      events: [],
    };
  },

  start(s, ctx) {
    s.stage = 'play';
    for (const team of s.teams) startSafe(s, ctx, team, 0);
  },

  input(s, ctx, playerId, input) {
    if (s.stage !== 'play' || inputType(input) !== 'submit') return;
    const ts = teamStateFor(s, playerId);
    if (!ts || ts.status !== 'active') return;
    if (!(ts.roles[playerId] ?? []).includes('input')) return;
    if (ctx.now < ts.lockedUntil) return;
    const code = String((input as { code?: unknown }).code ?? '').replace(/\D/g, '');
    if (code === ts.puzzle.answer) {
      ts.results.push({
        safe: ts.safeIndex,
        solved: true,
        ms: ctx.now - ts.startedAt,
        attempts: ts.attempts + 1,
      });
      ts.status = 'solved';
      ts.nextAt = ctx.now + SOLVED_PAUSE_MS;
      const team = s.teams.find((t) => t.id === ts.teamId);
      if (team) {
        pushEvent(
          s,
          `${josa(team.name, '이/가')} 금고 ${ts.safeIndex + 1}을 열었어요 (${Math.round((ctx.now - ts.startedAt) / 1000)}초)`,
          ctx.now,
        );
      }
    } else {
      ts.attempts += 1;
      ts.lastWrong = code;
      ts.lockedUntil = ctx.now + WRONG_LOCK_MS;
    }
  },

  tick(s, ctx) {
    if (s.stage !== 'play') return;
    for (const team of s.teams) {
      const ts = s.perTeam[team.id];
      if (!ts) continue;
      if (ts.status === 'active') {
        reassignOrphanRoles(ts, ctx);
        giveIdleMembersChecksum(ts, team, ctx);
        if (ctx.now >= ts.deadline) {
          ts.results.push({
            safe: ts.safeIndex,
            solved: false,
            ms: ctx.now - ts.startedAt,
            attempts: ts.attempts,
          });
          ts.status = 'failed';
          ts.nextAt = ctx.now + FAILED_PAUSE_MS;
        }
      } else if (
        (ts.status === 'solved' || ts.status === 'failed') &&
        ts.nextAt !== null &&
        ctx.now >= ts.nextAt
      ) {
        if (ts.safeIndex + 1 < s.safes) startSafe(s, ctx, team, ts.safeIndex + 1);
        else ts.status = 'finished';
      }
    }
    if (s.teams.length === 0 || s.teams.every((t) => s.perTeam[t.id]?.status === 'finished'))
      s.stage = 'done';
  },

  finished(s) {
    return s.stage === 'done';
  },

  hostAction(s, ctx, action) {
    if (action === 'finish-now' && s.stage === 'play') {
      for (const team of s.teams) {
        const ts = s.perTeam[team.id];
        if (ts && ts.status !== 'finished') {
          if (ts.status === 'active') {
            ts.results.push({
              safe: ts.safeIndex,
              solved: false,
              ms: ctx.now - ts.startedAt,
              attempts: ts.attempts,
            });
          }
          ts.status = 'finished';
        }
      }
      s.stage = 'done';
    }
  },

  playerJoined(s, ctx, playerId) {
    if (s.teams.some((t) => t.memberIds.includes(playerId))) return;
    const team = teamForNewcomer(s.teams, ctx, playerId);
    if (!team) return;
    team.memberIds.push(playerId);
    const ts = s.perTeam[team.id];
    if (ts && ts.status === 'active') ts.roles[playerId] = ['checksum'];
    void ctx;
  },

  hostView(s) {
    return {
      stage: s.stage,
      safes: s.safes,
      teams: s.teams.map((t) => {
        const ts = s.perTeam[t.id];
        const results = ts?.results ?? [];
        return {
          id: t.id,
          name: t.name,
          color: t.color,
          members: t.memberIds.length,
          safeIndex: ts?.safeIndex ?? 0,
          status: ts?.status ?? 'active',
          deadline: ts?.deadline ?? 0,
          lockedUntil: ts?.lockedUntil ?? 0,
          attempts: ts?.attempts ?? 0,
          solved: results.filter((r) => r.solved).length,
          totalMs: results.filter((r) => r.solved).reduce((a, r) => a + r.ms, 0),
          results,
        };
      }),
      events: s.events.slice(-6),
    };
  },

  playerView(s, ctx, playerId) {
    const team = s.teams.find((t) => t.memberIds.includes(playerId));
    const ts = team ? s.perTeam[team.id] : undefined;
    const roles = ts?.roles[playerId] ?? [];
    const has = (r: VaultRole) => roles.includes(r);
    const between = ts?.status === 'solved' || ts?.status === 'failed';
    return {
      stage: s.stage,
      safes: s.safes,
      safeIndex: ts?.safeIndex ?? 0,
      level: ts?.puzzle.level ?? 1,
      status: ts?.status ?? 'none',
      deadline: ts?.deadline ?? 0,
      lockedUntil: ts?.lockedUntil ?? 0,
      teamName: team?.name ?? '',
      teamColor: team?.color ?? '#888888',
      roles,
      digits: ts?.puzzle.answer.length ?? 0,
      order: ts && has('order') ? ts.puzzle.seq : null,
      table: ts && has('decode') ? ts.puzzle.table : null,
      rule: ts && has('rule') ? (ts.puzzle.rule?.text ?? null) : null,
      checksum: ts && has('checksum') ? ts.puzzle.checksum : null,
      lastWrong: ts?.lastWrong ?? null,
      attempts: ts?.attempts ?? 0,
      reveal: ts && between ? ts.puzzle.answer : null,
      roster: team
        ? team.memberIds.map((id) => ({
            nickname: nicknameOf(ctx, id),
            roles: ts?.roles[id] ?? [],
            me: id === playerId,
          }))
        : [],
      solved: ts?.results.filter((r) => r.solved).length ?? 0,
    };
  },

  summary(s): GameSummary {
    const all = s.teams.flatMap((t) => s.perTeam[t.id]?.results ?? []);
    const solved = all.filter((r) => r.solved);
    const firstTwo = all.filter((r) => r.safe <= 1);
    const order = ranking(s);
    const best = s.teams.find((t) => t.id === order[0]);
    const bestSolved = best ? (s.perTeam[best.id]?.results.filter((r) => r.solved).length ?? 0) : 0;
    const fastest = s.teams
      .flatMap((t) => (s.perTeam[t.id]?.results ?? []).filter((r) => r.solved).map((r) => ({ team: t, r })))
      .sort((a, b) => a.r.ms - b.r.ms)[0];
    const highlights: string[] = [];
    if (fastest) {
      highlights.push(
        `가장 빠른 해제: ${fastest.team.name}, 금고 ${fastest.r.safe + 1} (${Math.round(fastest.r.ms / 1000)}초)`,
      );
    }
    highlights.push(`말로 정보를 합쳐 연 금고 ${solved.length} / ${all.length}`);
    return {
      gameId: 'vault',
      title: '비대칭 금고 따기',
      headline: best ? `${josa(best.name, '이/가')} 금고 ${bestSolved}개로 1등` : '금고 따기 끝',
      highlights,
      metrics: {
        safes: all.length,
        solved: solved.length,
        successRate: all.length ? Math.round((solved.length / all.length) * 100) : 0,
        firstTwoSuccessRate: firstTwo.length
          ? Math.round((firstTwo.filter((r) => r.solved).length / firstTwo.length) * 100)
          : 0,
        avgSolveSec: solved.length
          ? Math.round(solved.reduce((a, r) => a + r.ms, 0) / solved.length / 1000)
          : -1,
      },
      teams: s.teams.map((t) => ({ ...t, memberIds: [...t.memberIds] })),
      ranking: order,
    };
  },
};
