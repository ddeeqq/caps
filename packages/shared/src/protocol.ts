import type { GameId, GameSummary, RoomSettings } from './games/types';
import type { PresetId } from './pack/types';
import type { HostCommand, HostCreatePayload, PlayerJoinPayload, SurveyAnswer } from './schemas';
import type { TeamInfo } from './util/teams';

/** 방 전체 진행 단계. 게임마다 intro → playing → result 를 반복한다 */
export type RoomPhase = 'lobby' | 'intro' | 'playing' | 'result' | 'finished';
export type ClientRole = 'screen' | 'remote' | 'player';

export type ReactionKind = 'clap' | 'laugh' | 'wow' | 'heart' | 'fire';
export const REACTIONS: Record<ReactionKind, string> = {
  clap: '👏',
  laugh: '😂',
  wow: '😮',
  heart: '❤️',
  fire: '🔥',
};
export const REACTION_KINDS = Object.keys(REACTIONS) as ReactionKind[];

export interface PlayerSummary {
  id: string;
  nickname: string;
  color: string;
  connected: boolean;
  teamId: string | null;
  bot: boolean;
}

export interface SurveyStats {
  lobby: { count: number; avg: number | null };
  end: { count: number; avg: number | null; newPeople: [number, number, number, number] };
}

/** 세션이 끝나면 저장되는 기록. 발표 자료의 지표가 여기서 나온다 */
export interface SessionReport {
  id: string;
  roomCode: string;
  packName: string;
  packCode: string | null;
  preset: PresetId;
  startedAt: string;
  endedAt: string | null;
  /** 동시에 접속한 사람 수의 최댓값 (봇 제외) */
  peakPlayers: number;
  /** 함께 놀았던 가상 참가자(봇) 수의 최댓값. 0이 아니면 지표에 봇의 행동이 섞여 있다 */
  bots: number;
  activeAtEnd: number;
  /** 참여 유지율 (%) */
  retention: number;
  flow: GameId[];
  games: GameSummary[];
  survey: SurveyStats;
  /** 익명 한 줄 소감 (순서는 섞여 있다). 예전 기록에는 없다 */
  quotes?: string[];
  metrics: {
    faceToFace: number;
    links: number;
    wrongLinks: number;
    reactions: number;
    vaultSuccessRate: number;
  };
}

export interface RoomState {
  code: string;
  role: ClientRole;
  phase: RoomPhase;
  flow: GameId[];
  index: number;
  gameId: GameId | null;
  packName: string;
  preset: PresetId;
  playerCount: number;
  /** playerCount 중 가상 참가자(봇) 수 */
  botCount: number;
  /** 큰 화면·리모컨에만 */
  players: PlayerSummary[] | null;
  teams: TeamInfo[] | null;
  /** 일시정지로 쌓인 시간. 게임 시계 = 서버 시각 − timeBase */
  timeBase: number;
  paused: boolean;
  /** 일시정지된 순간의 게임 시계 */
  pausedAt: number | null;
  /** 누가 멈췄는지: 진행자 / 서버 재시작 복구 (화면 문구가 다르다) */
  pauseReason: PauseReason | null;
  phaseSince: number;
  hostConnected: boolean;
  /** 지금까지 끝난 게임 요약 (큰 화면·리모컨에만) */
  history: GameSummary[] | null;
  you: {
    id: string;
    nickname: string;
    color: string;
    teamId: string | null;
    /** 세션이 끝난 뒤에만: 오늘 같은 팀이었던 사람들 (봇 제외) */
    met?: MetPerson[];
  } | null;
  survey: SurveyStats | null;
  report: SessionReport | null;
  settings: RoomSettings;
  joinPath: string;
  /** 진행자가 "한 판 더"로 연 새 방 코드 (끝난 방에서만) */
  rematch?: string | null;
}

export type PauseReason = 'host' | 'restart';

/** 끝난 뒤 참가자 폰에 보여 주는 "오늘 같은 팀이었던 사람" */
export interface MetPerson {
  nickname: string;
  color: string;
  /** 같은 팀으로 함께한 게임 수 */
  games: number;
}

export interface ViewEnvelope {
  gameId: GameId;
  index: number;
  phase: 'intro' | 'playing' | 'result';
  view: unknown;
  summary: GameSummary | null;
}

export type Ack<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: ErrorCode; message: string };

export const ERROR_MESSAGES = {
  BAD_REQUEST: '요청 형식이 올바르지 않아요',
  ROOM_NOT_FOUND: '방을 찾을 수 없어요. 코드를 다시 확인해 주세요',
  ROOM_CLOSED: '이미 끝난 방이에요',
  NOT_HOST: '진행자 권한이 없어요',
  BAD_PIN: 'PIN이 맞지 않아요',
  TOO_MANY_TRIES: '시도가 너무 많아요. 잠시 후 다시 해 주세요',
  PACK_NOT_FOUND: '그 팩 코드를 찾을 수 없어요',
  NICKNAME_BLOCKED: '사용할 수 없는 닉네임이에요',
  KICKED: '진행자가 내보낸 참가자예요',
  ROOM_FULL: '방이 가득 찼어요',
  INVALID_STATE: '지금은 할 수 없는 동작이에요',
  SERVER_BUSY: '지금은 방을 더 만들 수 없어요. 잠시 후 다시 해 주세요',
} as const;
export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const MAX_PLAYERS_PER_ROOM = 150;

/** 종료 설문의 '오늘 처음 말해본 사람' 응답 구간 */
export const NEW_PEOPLE_BUCKETS = ['0명', '1~2명', '3~5명', '6명 이상'] as const;

export interface ClientToServerEvents {
  'clock:ping': (t0: number, ack: (serverTime: number) => void) => void;
  'host:create': (
    payload: HostCreatePayload,
    ack: (res: Ack<{ code: string; hostToken: string; hostPin: string }>) => void,
  ) => void;
  'host:attach': (
    payload: { code: string; hostToken: string; role: 'screen' | 'remote' },
    ack: (res: Ack<{ hostPin: string }>) => void,
  ) => void;
  'host:remote-login': (
    payload: { code: string; pin: string },
    ack: (res: Ack<{ hostToken: string }>) => void,
  ) => void;
  'host:command': (cmd: HostCommand, ack?: (res: Ack) => void) => void;
  'player:join': (
    payload: PlayerJoinPayload,
    ack: (res: Ack<{ playerId: string; token: string; nickname: string }>) => void,
  ) => void;
  'player:rename': (nickname: string, ack: (res: Ack<{ nickname: string }>) => void) => void;
  'player:input': (payload: { input: unknown; at: number }) => void;
  'player:react': (kind: ReactionKind) => void;
  'player:survey': (answer: SurveyAnswer) => void;
}

export interface ServerToClientEvents {
  room: (state: RoomState) => void;
  view: (envelope: ViewEnvelope | null) => void;
  reaction: (r: { id: number; kind: ReactionKind; color: string; nickname: string }) => void;
  kicked: () => void;
  closed: (reason: string) => void;
}

export function errorAck(error: ErrorCode): { ok: false; error: ErrorCode; message: string } {
  return { ok: false, error, message: ERROR_MESSAGES[error] };
}
