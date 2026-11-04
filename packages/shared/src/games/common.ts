import type { Rng } from '../util/rng';
import { smallestTeam, splitIntoTeams, TEAM_COLORS, type TeamInfo } from '../util/teams';
import type { GameCtx, GamePlayer } from './types';

/**
 * 팀을 나누되 사람과 봇(가상 참가자)은 섞지 않는다.
 * 봇은 사람에게 말을 걸 수 없으니, 섞이면 소리 짝꿍·금고에서 사람이 할 수 있는 게 없어진다.
 */
export function splitHumansAndBots(players: readonly GamePlayer[], rng: Rng): string[][] {
  const humans = players.filter((p) => !p.bot).map((p) => p.id);
  const bots = players.filter((p) => p.bot).map((p) => p.id);
  return [...splitIntoTeams(humans, rng), ...splitIntoTeams(bots, rng)];
}

/** 도중에 들어온 사람이 갈 팀: 같은 종류(사람끼리·봇끼리)로 이뤄진 팀 중 가장 작은 팀 */
export function teamForNewcomer<T extends { memberIds: string[] }>(
  teams: readonly T[],
  ctx: GameCtx,
  playerId: string,
): T | null {
  const isBot = (id: string) => ctx.players.find((p) => p.id === id)?.bot === true;
  const mine = isBot(playerId);
  const sameKind = teams.filter(
    (t) => t.memberIds.length > 0 && t.memberIds.every((id) => isBot(id) === mine),
  );
  return smallestTeam(sameKind.length > 0 ? sameKind : teams);
}

export function connectedPlayers(ctx: GameCtx): GamePlayer[] {
  return ctx.players.filter((p) => p.connected);
}

export function isConnected(ctx: GameCtx, playerId: string): boolean {
  return ctx.players.some((p) => p.id === playerId && p.connected);
}

export function nicknameOf(ctx: GameCtx, playerId: string): string {
  return ctx.players.find((p) => p.id === playerId)?.nickname ?? '떠난 참가자';
}

export function colorOf(ctx: GameCtx, playerId: string): string {
  return ctx.players.find((p) => p.id === playerId)?.color ?? '#999999';
}

export function teamDisplayName(ctx: GameCtx, index: number): string {
  return ctx.pack.content.teamNames[index] ?? `${index + 1}팀`;
}

/**
 * 팀 게임이 쓸 팀을 정리한다.
 * - 앞 게임에서 만든 팀이 있으면 이어 쓰고, 떠난 사람은 빼고, 새로 온 사람은 가장 작은 팀에 넣는다.
 * - 팀이 없으면 접속 중인 사람으로 새로 나눈다.
 */
export function reconcileTeams(ctx: GameCtx): TeamInfo[] {
  const present = new Set(ctx.players.map((p) => p.id));
  const connectedList = connectedPlayers(ctx);
  const connected = connectedList.map((p) => p.id);
  let teams: TeamInfo[] =
    ctx.teams?.map((t) => ({ ...t, memberIds: t.memberIds.filter((id) => present.has(id)) })) ?? [];
  teams = teams.filter((t) => t.memberIds.length > 0);

  if (teams.length === 0) {
    const groups = splitHumansAndBots(connectedList, ctx.rng);
    return groups.map((memberIds, i) => ({
      id: `t${i + 1}`,
      name: teamDisplayName(ctx, i),
      color: TEAM_COLORS[i % TEAM_COLORS.length] as string,
      memberIds,
    }));
  }

  const assigned = new Set(teams.flatMap((t) => t.memberIds));
  for (const id of connected) {
    if (assigned.has(id)) continue;
    const target = teamForNewcomer(teams, ctx, id);
    if (target) target.memberIds.push(id);
  }
  return teams;
}

/**
 * 테이블에 둘러앉아 하는 게임(라이어, 파장)용 팀: 앞 게임 팀을 이어 쓰되
 * minSize보다 작은 팀은 다른 팀에 합친다 (같은 종류 — 사람끼리·봇끼리 — 를 먼저 찾는다).
 */
export function tableTeams(ctx: GameCtx, minSize: number): TeamInfo[] {
  const teams = reconcileTeams(ctx).map((t) => ({ ...t, memberIds: [...t.memberIds] }));
  const isBot = (id: string) => ctx.players.find((p) => p.id === id)?.bot === true;
  const kind = (t: TeamInfo) => (t.memberIds.every(isBot) ? 'bot' : 'human');
  for (;;) {
    const small = [...teams].sort((a, b) => a.memberIds.length - b.memberIds.length)[0];
    if (!small || small.memberIds.length >= minSize || teams.length < 2) break;
    const others = teams.filter((t) => t !== small);
    const same = others.filter((t) => kind(t) === kind(small));
    const target = smallestTeam(same.length > 0 ? same : others);
    if (!target) break;
    target.memberIds.push(...small.memberIds);
    teams.splice(teams.indexOf(small), 1);
  }
  return teams;
}

export function teamOfPlayer(teams: readonly TeamInfo[], playerId: string): TeamInfo | null {
  return teams.find((t) => t.memberIds.includes(playerId)) ?? null;
}

/** 남은 시간 계산 등에 쓰는 ms → 초 (올림) */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** unknown 입력에서 type 필드를 안전하게 꺼낸다 */
export function inputType(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const t = (input as { type?: unknown }).type;
  return typeof t === 'string' ? t : null;
}
