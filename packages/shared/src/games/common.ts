import { smallestTeam, splitIntoTeams, TEAM_COLORS, type TeamInfo } from '../util/teams';
import type { GameCtx, GamePlayer } from './types';

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
  const connected = connectedPlayers(ctx).map((p) => p.id);
  let teams: TeamInfo[] =
    ctx.teams?.map((t) => ({ ...t, memberIds: t.memberIds.filter((id) => present.has(id)) })) ?? [];
  teams = teams.filter((t) => t.memberIds.length > 0);

  if (teams.length === 0) {
    const groups = splitIntoTeams(connected, ctx.rng);
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
    const target = smallestTeam(teams);
    if (target) target.memberIds.push(id);
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
