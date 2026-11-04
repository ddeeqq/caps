import type { ResolvedPack } from '../pack/resolve';
import type { PackContent } from '../pack/types';
import type { Rng } from '../util/rng';
import type { TeamInfo } from '../util/teams';

export type GameId =
  'nunchi' | 'soundmate' | 'vault' | 'cardsection' | 'minority' | 'tiltrace' | 'liar' | 'wavelength';
export const GAME_IDS: readonly GameId[] = [
  'nunchi',
  'soundmate',
  'vault',
  'cardsection',
  'minority',
  'tiltrace',
  'liar',
  'wavelength',
];

/** 설계서의 기본 진행 순서: 웃음 → 섞임 → 협동 → 일체감 */
export const DEFAULT_FLOW: GameId[] = ['nunchi', 'soundmate', 'vault', 'cardsection'];

export type Permission = 'audio' | 'camera' | 'motion' | 'wakelock';

export interface RoomSettings {
  nunchiRounds: number;
  /** 눈치게임 충돌 창 (ms) */
  nunchiWindowMs: number;
  soundmateSeconds: number;
  /** 소리 짝꿍 팀 미션 제한 시간 (초) */
  missionSeconds: number;
  vaultSafes: number;
  seatRows: number;
  seatCols: number;
  /** 카드섹션 연출 길이 (ms). 기본 40초 */
  cardsectionMs: number;
  minorityRounds: number;
  /** 소수결 작전 타임 (초) */
  minorityTalkSeconds: number;
  /** 소수결 투표 시간 (초) */
  minorityVoteSeconds: number;
  /** 군중 조종 레이스 코스 길이 (최고 속도로 몇 초 거리인지) */
  tiltraceLength: number;
  /** 라이어 게임 라운드 (라운드마다 라이어와 제시어가 바뀐다) */
  liarRounds: number;
  /** 라이어 게임 설명·토론 시간 (초) */
  liarTalkSeconds: number;
  /** 파장 맞추기 라운드 (라운드마다 출제자가 바뀐다) */
  waveRounds: number;
  /** 파장 맞추기 한 라운드 시간 (초) */
  waveSeconds: number;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  nunchiRounds: 5,
  nunchiWindowMs: 300,
  soundmateSeconds: 180,
  missionSeconds: 30,
  vaultSafes: 3,
  seatRows: 6,
  seatCols: 8,
  cardsectionMs: 40_000,
  minorityRounds: 5,
  minorityTalkSeconds: 20,
  minorityVoteSeconds: 10,
  tiltraceLength: 45,
  liarRounds: 2,
  liarTalkSeconds: 90,
  waveRounds: 3,
  waveSeconds: 60,
};

export interface GamePlayer {
  id: string;
  nickname: string;
  color: string;
  connected: boolean;
  teamId: string | null;
  /** 서버의 가상 참가자(봇). 팀을 나눌 때 사람과 섞지 않는다 */
  bot?: boolean;
}

/** 게임이 끝나고 남는 기록: 결과 화면, 다음 게임 연결, 지표에 쓰인다 */
export interface GameSummary {
  gameId: GameId;
  title: string;
  headline: string;
  highlights: string[];
  metrics: Record<string, number>;
  /** 이 게임이 만들거나 갱신한 팀 (다음 팀 게임이 이어 받는다) */
  teams?: TeamInfo[];
  /** 팀 순위 (팀 id 배열, 1등부터). 카드섹션 팀 색 물결 순서로 쓰인다 */
  ranking?: string[];
}

export interface GameCtx {
  /** 게임 시계 (ms). 서버 시각에서 일시정지 시간을 뺀 값 */
  now: number;
  players: GamePlayer[];
  teams: TeamInfo[] | null;
  pack: ResolvedPack;
  rng: Rng;
  settings: RoomSettings;
  history: GameSummary[];
}

export interface GameMeta {
  id: GameId;
  title: string;
  tagline: string;
  rules: string[];
  minPlayers: number;
  permissions: Permission[];
  usesPack: Array<keyof PackContent>;
  teamMode: 'none' | 'creates' | 'uses';
  minutes: number;
  /** 설계서 MVP 이후 추가된 게임 */
  extra?: boolean;
}

/**
 * 모든 게임이 구현하는 인터페이스. 판정은 전부 여기서(서버에서만) 일어나고,
 * 폰과 큰 화면은 hostView / playerView 결과를 그리기만 한다.
 * 상태(S)는 JSON으로 직렬화 가능한 순수 데이터이며 메서드가 제자리에서 갱신한다.
 */
export interface GameModule<S = any, HV = unknown, PV = unknown> {
  meta: GameMeta;
  init(ctx: GameCtx): S;
  /** 소개 화면에서 실제 플레이로 넘어갈 때 */
  start(state: S, ctx: GameCtx): void;
  /** at = 검증·보정된 입력 시각 (게임 시계) */
  input(state: S, ctx: GameCtx, playerId: string, input: unknown, at: number): void;
  hostAction?(state: S, ctx: GameCtx, action: string, data?: unknown): void;
  tick(state: S, ctx: GameCtx): void;
  finished(state: S, ctx: GameCtx): boolean;
  hostView(state: S, ctx: GameCtx): HV;
  playerView(state: S, ctx: GameCtx, playerId: string): PV;
  summary(state: S, ctx: GameCtx): GameSummary;
  /** 게임 도중 새로 들어온 참가자 처리 (팀 배정 등) */
  playerJoined?(state: S, ctx: GameCtx, playerId: string): void;
}
