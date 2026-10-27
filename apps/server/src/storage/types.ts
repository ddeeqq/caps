import type { Pack, PackInput, SessionReport } from '@caps/shared';

/**
 * 저장소 인터페이스. 방 상태는 메모리에 두고, 팩과 세션 기록만 여기에 저장한다.
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
