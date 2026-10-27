import { z } from 'zod';

export type PresetId = 'friends' | 'work' | 'class';
export const PRESET_IDS: readonly PresetId[] = ['friends', 'work', 'class'];

export interface BalanceQuestion {
  prompt: string;
  a: string;
  b: string;
}

/** 팩 내용: 게임 규칙은 그대로 두고 단어와 질문만 모임에 맞게 바꾼다 */
export interface PackContent {
  /** 인물 이름 — 금고 기호, (친구 프리셋) 밸런스 질문 */
  names: string[];
  /** 모임 고유 키워드 — 금고 기호, 밸런스 질문 */
  keywords: string[];
  /** 직접 넣은 밸런스 질문 — 소리 짝꿍 팀 미션, 소수결 서바이벌 */
  balanceQuestions: BalanceQuestion[];
  /** 팀 표시 이름 */
  teamNames: string[];
  /** 카드섹션 마지막 문구 */
  finaleText: string;
  /** 눈치게임 벌칙 문구 */
  penalties: string[];
}

export interface PackOptions {
  /** 인물 이름을 비교하는 질문 사용 여부 (직장 프리셋 기본 OFF) */
  personCompare: boolean;
}

export interface Pack {
  code: string;
  name: string;
  preset: PresetId;
  content: PackContent;
  options: PackOptions;
  createdAt: string;
  updatedAt: string;
}

export const LIMITS = {
  packName: 30,
  word: 16,
  listItems: 40,
  question: 40,
  questionSide: 20,
  questions: 50,
  finale: 30,
  penalty: 40,
  penalties: 20,
  teamNames: 20,
  nickname: 12,
} as const;

const word = z.string().trim().min(1).max(LIMITS.word);

export const balanceQuestionSchema = z.object({
  prompt: z.string().trim().max(LIMITS.question).default('하나만 고른다면?'),
  a: z.string().trim().min(1).max(LIMITS.questionSide),
  b: z.string().trim().min(1).max(LIMITS.questionSide),
});

export const packContentInputSchema = z.object({
  names: z.array(word).max(LIMITS.listItems).default([]),
  keywords: z.array(word).max(LIMITS.listItems).default([]),
  balanceQuestions: z.array(balanceQuestionSchema).max(LIMITS.questions).default([]),
  teamNames: z.array(word).max(LIMITS.teamNames).default([]),
  finaleText: z.string().trim().max(LIMITS.finale).default(''),
  penalties: z.array(z.string().trim().min(1).max(LIMITS.penalty)).max(LIMITS.penalties).default([]),
});

export const packInputSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.packName),
  preset: z.enum(['friends', 'work', 'class']),
  content: packContentInputSchema.default({
    names: [],
    keywords: [],
    balanceQuestions: [],
    teamNames: [],
    finaleText: '',
    penalties: [],
  }),
  options: z
    .object({
      personCompare: z.boolean().optional(),
    })
    .default({}),
});

export type PackInput = z.infer<typeof packInputSchema>;
export type PackContentInput = z.infer<typeof packContentInputSchema>;
