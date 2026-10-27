/**
 * 서버가 받는 입력의 런타임 검증 스키마 (zod).
 *
 * 런타임 스키마는 이 파일에만 둔다. 공용 패키지는 `sideEffects: false`라서
 * 웹 번들은 이 모듈을 통째로 버리고, 참가자 폰이 zod를 내려받지 않는다.
 * 타입(z.infer)은 컴파일 때 지워지므로 어디서 가져다 써도 된다.
 */
import { z } from 'zod';
import { GAME_IDS, type GameId } from './games/types';
import { LIMITS } from './pack/types';

const gameIdSchema = z.enum(GAME_IDS as [GameId, ...GameId[]]);
const presetSchema = z.enum(['friends', 'work', 'class']);

// ── 방 설정 ─────────────────────────────────
export const settingsSchema = z
  .object({
    nunchiRounds: z.number().int().min(1).max(10),
    nunchiWindowMs: z.number().int().min(150).max(600),
    soundmateSeconds: z.number().int().min(10).max(600),
    missionSeconds: z.number().int().min(5).max(120),
    vaultSafes: z.number().int().min(1).max(5),
    seatRows: z.number().int().min(1).max(12),
    seatCols: z.number().int().min(1).max(16),
    cardsectionMs: z.number().int().min(4000).max(120_000),
    minorityRounds: z.number().int().min(1).max(10),
    minorityTalkSeconds: z.number().int().min(2).max(120),
    minorityVoteSeconds: z.number().int().min(2).max(60),
    tiltraceLength: z.number().int().min(5).max(120),
  })
  .partial();

// ── 커스텀 팩 ───────────────────────────────
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
  preset: presetSchema,
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

// ── 소켓 이벤트 ─────────────────────────────
export const hostCreateSchema = z.object({
  preset: presetSchema,
  packCode: z.string().trim().toUpperCase().max(8).optional(),
  packName: z.string().trim().max(LIMITS.packName).optional(),
  inlinePack: packContentInputSchema.partial().optional(),
  personCompare: z.boolean().optional(),
  flow: z.array(gameIdSchema).min(1).max(12),
  settings: settingsSchema.optional(),
});
export type HostCreatePayload = z.input<typeof hostCreateSchema>;

export const hostCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('skip') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('kick'), playerId: z.string().max(40) }),
  z.object({ type: z.literal('game'), action: z.string().max(40), data: z.unknown().optional() }),
  z.object({ type: z.literal('setFlow'), flow: z.array(gameIdSchema).min(1).max(12) }),
]);
export type HostCommand = z.infer<typeof hostCommandSchema>;

export const playerJoinSchema = z.object({
  code: z.string().trim().toUpperCase().length(4),
  nickname: z.string().max(40).optional(),
  token: z.string().max(80).optional(),
});
export type PlayerJoinPayload = z.input<typeof playerJoinSchema>;

export const surveySchema = z.object({
  phase: z.enum(['lobby', 'end']),
  comfort: z.number().int().min(1).max(5).optional(),
  newPeople: z.number().int().min(0).max(3).optional(),
});
export type SurveyAnswer = z.infer<typeof surveySchema>;
