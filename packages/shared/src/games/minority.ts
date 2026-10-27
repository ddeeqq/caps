import type { BalanceQuestion } from '../pack/types';
import { connectedPlayers, inputType, nicknameOf } from './common';
import type { GameModule, GameSummary } from './types';

/**
 * 추가 게임: 소수결 서바이벌
 * 질문 공개 → 작전 타임(대화) → 투표 → 다수 쪽 탈락, 소수만 생존.
 * 살아남으려면 남을 설득하거나 동맹을 맺어야 해서 대화가 저절로 생긴다.
 * 탈락자는 "예언자"가 되어 다음 라운드의 소수 쪽을 맞히며 계속 참여한다.
 */

export type MinorityVote = 'a' | 'b';

export interface MinorityReveal {
  countA: number;
  countB: number;
  tie: boolean;
  minority: MinorityVote | null;
  eliminated: string[];
  noVote: string[];
}

export interface MinorityState {
  stage: 'intro' | 'talk' | 'vote' | 'reveal' | 'done';
  round: number;
  rounds: number;
  question: BalanceQuestion | null;
  questionIndex: number;
  everyone: string[];
  alive: Record<string, boolean>;
  votes: Record<string, MinorityVote>;
  predictions: Record<string, MinorityVote>;
  points: Record<string, number>;
  deadline: number;
  talkMs: number;
  voteMs: number;
  revealMs: number;
  lastReveal: MinorityReveal | null;
  history: Array<{
    round: number;
    question: BalanceQuestion;
    countA: number;
    countB: number;
    eliminated: number;
  }>;
}

export interface MinorityHostView {
  stage: MinorityState['stage'];
  round: number;
  rounds: number;
  question: BalanceQuestion | null;
  deadline: number;
  aliveCount: number;
  total: number;
  votedCount: number;
  reveal:
    null | (Omit<MinorityReveal, 'eliminated' | 'noVote'> & { eliminatedNames: string[]; survivors: number });
  survivors: string[];
  prophets: Array<{ nickname: string; points: number }>;
}

export interface MinorityPlayerView {
  stage: MinorityState['stage'];
  round: number;
  rounds: number;
  question: BalanceQuestion | null;
  deadline: number;
  alive: boolean;
  myVote: MinorityVote | null;
  myPrediction: MinorityVote | null;
  aliveCount: number;
  points: number;
  reveal: null | {
    countA: number;
    countB: number;
    tie: boolean;
    minority: MinorityVote | null;
    youEliminated: boolean;
    youSurvived: boolean;
    predictionCorrect: boolean | null;
  };
}

function aliveIds(s: MinorityState): string[] {
  return Object.entries(s.alive)
    .filter(([, a]) => a)
    .map(([id]) => id);
}

export const minority: GameModule<MinorityState, MinorityHostView, MinorityPlayerView> = {
  meta: {
    id: 'minority',
    title: '소수결 서바이벌',
    tagline: '다수가 되면 탈락. 설득하고, 동맹하고, 배신하라',
    rules: [
      '질문이 뜨면 작전 타임! 마음껏 상의하세요',
      '투표가 끝나면 더 많이 고른 쪽이 탈락해요',
      '동점이거나 모두 같은 쪽이면 무효, 투표 안 하면 탈락',
      '탈락하면 예언자가 되어 소수 쪽을 맞혀 점수를 모아요',
    ],
    minPlayers: 3,
    permissions: [],
    usesPack: ['balanceQuestions', 'names', 'keywords'],
    teamMode: 'none',
    minutes: 4,
    extra: true,
  },

  init(ctx) {
    const everyone = connectedPlayers(ctx).map((p) => p.id);
    return {
      stage: 'intro',
      round: 0,
      rounds: ctx.settings.minorityRounds,
      question: null,
      questionIndex: ctx.rng.int(0, Math.max(0, ctx.pack.balancePool.length - 1)),
      everyone,
      alive: Object.fromEntries(everyone.map((id) => [id, true])),
      votes: {},
      predictions: {},
      points: {},
      deadline: 0,
      talkMs: ctx.settings.minorityTalkSeconds * 1000,
      voteMs: ctx.settings.minorityVoteSeconds * 1000,
      revealMs: 6_500,
      lastReveal: null,
      history: [],
    };
  },

  start(s, ctx) {
    s.round = 1;
    s.question = ctx.pack.balancePool[s.questionIndex % Math.max(1, ctx.pack.balancePool.length)] ?? {
      prompt: '하나만 고른다면?',
      a: '짜장',
      b: '짬뽕',
    };
    s.stage = 'talk';
    s.deadline = ctx.now + s.talkMs;
  },

  input(s, ctx, playerId, input) {
    if (s.stage !== 'talk' && s.stage !== 'vote') return;
    const type = inputType(input);
    const choice = (input as { choice?: unknown }).choice;
    if (choice !== 'a' && choice !== 'b') return;
    if (type === 'vote' && s.alive[playerId]) s.votes[playerId] = choice;
    if (type === 'predict' && !s.alive[playerId]) s.predictions[playerId] = choice;
    void ctx;
  },

  tick(s, ctx) {
    if (s.stage === 'talk' && ctx.now >= s.deadline) {
      s.stage = 'vote';
      s.deadline = ctx.now + s.voteMs;
      return;
    }
    if (s.stage === 'vote' && ctx.now >= s.deadline) {
      const alive = aliveIds(s);
      const noVote = alive.filter((id) => s.votes[id] === undefined);
      const voters = alive.filter((id) => s.votes[id] !== undefined);
      const countA = voters.filter((id) => s.votes[id] === 'a').length;
      const countB = voters.length - countA;
      const tie = countA === countB || countA === 0 || countB === 0;
      const minority: MinorityVote | null = tie ? null : countA < countB ? 'a' : 'b';
      const majorityVoters = minority ? voters.filter((id) => s.votes[id] !== minority) : [];
      const eliminated = [...majorityVoters, ...noVote];
      // 모두 탈락하는 경우(아무도 투표 안 함)는 무효 처리
      const effective = eliminated.length >= alive.length ? [] : eliminated;
      for (const id of effective) s.alive[id] = false;
      if (minority) {
        for (const [id, guess] of Object.entries(s.predictions)) {
          if (guess === minority) s.points[id] = (s.points[id] ?? 0) + 1;
        }
      }
      s.lastReveal = { countA, countB, tie, minority, eliminated: effective, noVote };
      if (s.question) {
        s.history.push({
          round: s.round,
          question: s.question,
          countA,
          countB,
          eliminated: effective.length,
        });
      }
      s.stage = 'reveal';
      s.deadline = ctx.now + s.revealMs;
      return;
    }
    if (s.stage === 'reveal' && ctx.now >= s.deadline) {
      const aliveCount = aliveIds(s).length;
      if (aliveCount <= 2 || s.round >= s.rounds) {
        s.stage = 'done';
        return;
      }
      s.round += 1;
      s.questionIndex += 1;
      s.question =
        ctx.pack.balancePool[s.questionIndex % Math.max(1, ctx.pack.balancePool.length)] ?? s.question;
      s.votes = {};
      s.predictions = {};
      s.lastReveal = null;
      s.stage = 'talk';
      s.deadline = ctx.now + s.talkMs;
    }
  },

  finished(s) {
    return s.stage === 'done';
  },

  hostAction(s, ctx, action) {
    if (action === 'skip-talk' && s.stage === 'talk') s.deadline = ctx.now;
  },

  playerJoined(s, ctx, playerId) {
    if (playerId in s.alive) return;
    s.everyone.push(playerId);
    s.alive[playerId] = false; // 늦게 온 사람은 예언자로 참여
    void ctx;
  },

  hostView(s, ctx) {
    const alive = aliveIds(s);
    const r = s.lastReveal;
    return {
      stage: s.stage,
      round: s.round,
      rounds: s.rounds,
      question: s.question,
      deadline: s.deadline,
      aliveCount: alive.length,
      total: s.everyone.length,
      votedCount: alive.filter((id) => s.votes[id] !== undefined).length,
      reveal: r
        ? {
            countA: r.countA,
            countB: r.countB,
            tie: r.tie,
            minority: r.minority,
            eliminatedNames: r.eliminated.map((id) => nicknameOf(ctx, id)),
            survivors: alive.length,
          }
        : null,
      survivors: alive.length <= 12 ? alive.map((id) => nicknameOf(ctx, id)) : [],
      prophets: Object.entries(s.points)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, points]) => ({ nickname: nicknameOf(ctx, id), points })),
    };
  },

  playerView(s, _ctx, playerId) {
    const r = s.lastReveal;
    const alive = s.alive[playerId] ?? false;
    return {
      stage: s.stage,
      round: s.round,
      rounds: s.rounds,
      question: s.question,
      deadline: s.deadline,
      alive,
      myVote: s.votes[playerId] ?? null,
      myPrediction: s.predictions[playerId] ?? null,
      aliveCount: aliveIds(s).length,
      points: s.points[playerId] ?? 0,
      reveal: r
        ? {
            countA: r.countA,
            countB: r.countB,
            tie: r.tie,
            minority: r.minority,
            youEliminated: r.eliminated.includes(playerId),
            youSurvived: alive,
            predictionCorrect:
              s.predictions[playerId] !== undefined && r.minority
                ? s.predictions[playerId] === r.minority
                : null,
          }
        : null,
    };
  },

  summary(s, ctx): GameSummary {
    const survivors = aliveIds(s);
    const prophet = Object.entries(s.points).sort((a, b) => b[1] - a[1])[0];
    const highlights = [
      `${s.history.length}번의 투표, 동점·무효 ${s.history.filter((h) => h.eliminated === 0).length}번`,
    ];
    if (prophet) highlights.push(`최고의 예언자: ${nicknameOf(ctx, prophet[0])} (${prophet[1]}번 적중)`);
    return {
      gameId: 'minority',
      title: '소수결 서바이벌',
      headline:
        survivors.length > 0 && survivors.length <= 4
          ? `최후의 소수: ${survivors.map((id) => nicknameOf(ctx, id)).join(', ')}`
          : `${survivors.length}명이 끝까지 살아남았어요`,
      highlights,
      metrics: { rounds: s.history.length, survivors: survivors.length },
    };
  },
};
