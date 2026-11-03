import type { Pack, PackInput, SessionReport } from '@caps/shared';
import type { RoomSnapshot } from '../room/snapshot';

/**
 * 저장소 인터페이스. 방은 메모리에서 돌고, 팩·세션 기록·방 저장본(재시작 복구용)을 여기에 저장한다.
 * 기본은 JSON 파일(설치 없이 바로 실행), DATABASE_URL이 있으면 PostgreSQL.
 */
export interface Storage {
  readonly kind: 'json' | 'postgres';
  init(): Promise<void>;
  createPack(code: string, input: PackInput, editKeyHash: string): Promise<Pack>;
  getPack(code: string): Promise<Pack | null>;
  /** 편집 키 해시가 맞으면 갱신. 없으면 null, 키가 틀리면 'forbidden' */
  updatePack(code: string, input: PackInput, editKeyHash: string): Promise<Pack | null | 'forbidden'>;
  saveSession(report: SessionReport): Promise<void>;
  getSession(id: string): Promise<SessionReport | null>;
  /** 마지막으로 고친 지 이 시각(ms)보다 오래된 세션 기록을 지운다. 지운 개수를 돌려준다 */
  pruneSessions(before: number): Promise<number>;
  /** 진행 중인 방 전체의 저장본 (서버 재시작 복구용). 매번 통째로 덮어쓴다 */
  saveRoomSnapshots(snapshots: RoomSnapshot[]): Promise<void>;
  loadRoomSnapshots(): Promise<RoomSnapshot[]>;
  close(): Promise<void>;
}

export function toPack(code: string, input: PackInput, createdAt: string, updatedAt: string): Pack {
  return {
    code,
    name: input.name,
    preset: input.preset,
    content: {
      names: input.content.names,
      keywords: input.content.keywords,
      balanceQuestions: input.content.balanceQuestions,
      teamNames: input.content.teamNames,
      finaleText: input.content.finaleText,
      penalties: input.content.penalties,
    },
    options: { personCompare: input.options.personCompare ?? input.preset === 'friends' },
    createdAt,
    updatedAt,
  };
}
