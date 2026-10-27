import type { Rng } from './rng';

/** 프로젝터에서도 잘 구분되는 팀 색 */
export const TEAM_COLORS = [
  '#FF5A5F',
  '#FFB400',
  '#00C2A8',
  '#3D7BFF',
  '#A259FF',
  '#FF7AC6',
  '#7ED957',
  '#FF8A3D',
  '#2EC5FF',
  '#FFE14D',
  '#C38BFF',
  '#45E0B4',
] as const;

/** 참가자 개인 색 (닉네임 점, 리액션 색) */
export const PLAYER_COLORS = [
  '#FF8FA3',
  '#FFC857',
  '#5EEAD4',
  '#7AA2FF',
  '#C4A1FF',
  '#FF9ECF',
  '#A3E635',
  '#FDBA74',
  '#67E8F9',
  '#FDE047',
] as const;

export interface TeamInfo {
  id: string;
  name: string;
  color: string;
  memberIds: string[];
  /** 소리 짝꿍에서 배정된 소리 (다른 게임에서 팀 아이콘으로도 씀) */
  soundId?: string;
}

/**
 * 인원을 3~4인 팀으로 고르게 나눈다.
 * 예: 14명 → 4, 4, 3, 3 / 5명 → 3, 2 / 3명 이하 → 한 팀
 */
export function splitIntoTeams<T>(items: readonly T[], rng: Rng, maxSize = 4): T[][] {
  const n = items.length;
  if (n === 0) return [];
  const k = n < 4 ? 1 : Math.max(2, Math.ceil(n / maxSize));
  const shuffled = rng.shuffle(items);
  const teams: T[][] = Array.from({ length: k }, () => []);
  shuffled.forEach((item, i) => {
    (teams[i % k] as T[]).push(item);
  });
  return teams;
}

/** 가장 인원이 적은 팀 (중간 입장자 배정용). 동률이면 앞 팀. */
export function smallestTeam<T extends { memberIds: string[] }>(teams: readonly T[]): T | null {
  let best: T | null = null;
  for (const t of teams) {
    if (!best || t.memberIds.length < best.memberIds.length) best = t;
  }
  return best;
}
