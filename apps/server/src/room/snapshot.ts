import type {
  GameId,
  GameSummary,
  PauseReason,
  ResolvedPack,
  RoomPhase,
  RoomSettings,
  TeamInfo,
} from '@caps/shared';

/** 방을 처음 만들 때 정해지고 재시작해도 바뀌면 안 되는 값 (재접속에 쓰는 비밀 포함) */
export interface RoomIdentity {
  hostToken: string;
  hostPin: string;
  sessionId: string;
  createdAt: number;
}

/**
 * 방 하나의 저장본. 서버가 재시작돼도 이것으로 방을 되살린다.
 * 게임 상태는 원래 JSON으로 직렬화되도록 설계했으므로(GameModule 규칙) 그대로 담는다.
 * 소켓 연결, 속도 제한, 봇의 머리처럼 메모리에만 있는 것은 담지 않고 복구할 때 새로 만든다.
 */
export interface RoomSnapshot {
  v: 1;
  /** 저장한 순간의 서버 시각. 복구하면 이 순간에서 게임 시계를 멈춰 둔다 */
  savedAt: number;
  code: string;
  identity: RoomIdentity;
  pack: ResolvedPack;
  flow: GameId[];
  settings: RoomSettings;
  phase: RoomPhase;
  index: number;
  phaseSince: number;
  players: Array<{
    id: string;
    token: string;
    nickname: string;
    color: string;
    joinedAt: number;
    survey: { lobby?: number; endComfort?: number; newPeople?: number; comment?: string };
    bot: boolean;
  }>;
  kickedTokens: string[];
  /** 진행자가 숨긴 한 줄 소감 (예전 저장본에는 없다) */
  hiddenQuotes?: string[];
  teams: TeamInfo[] | null;
  game: { id: GameId; state: unknown; summary: GameSummary | null } | null;
  summaries: GameSummary[];
  pauseAccum: number;
  pausedAt: number | null;
  /** 예전 저장본에는 없을 수 있다 */
  pauseReason?: PauseReason | null;
  peakPlayers: number;
  peakBots: number;
  reactions: number;
  startedAt: number | null;
  endedAt: number | null;
  activeAtEnd: number;
  lastActivity: number;
  colorCursor: number;
}

export function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<RoomSnapshot>;
  return (
    v.v === 1 && typeof v.code === 'string' && typeof v.identity === 'object' && Array.isArray(v.players)
  );
}
