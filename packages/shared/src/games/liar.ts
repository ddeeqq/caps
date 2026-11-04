import type { TeamInfo } from '../util/teams';
import { colorOf, connectedPlayers, inputType, isConnected, nicknameOf, tableTeams } from './common';
import type { GameCtx, GameModule, GameSummary } from './types';
import { LIAR_CATEGORIES, LIAR_PRESET_CATEGORY, type WordCategory } from './words';

/**
 * 추가 게임: 라이어 게임 (보드게임·예능에서 온 국민 파티게임)
 * 테이블(팀)마다 한 명만 제시어를 모르는 "라이어"다. 라이어는 카테고리만 안다.
 * 돌아가며 제시어를 한마디로 설명하고(말로), 폰으로 라이어를 지목한다.
 * 라이어가 잡혀도 제시어를 맞히면 라이어 승리.
 *
 * 말문에 맞춘 점:
 *  - 큰 모임은 여러 테이블이 동시에 한다. 옆 테이블에서 엿듣지 못하게 테이블마다 제시어가 다르다
 *  - "한마디 설명"은 얼굴을 보고 말해야만 하는 구조라서 대화가 저절로 생긴다
 *  - 제시어는 누르고 있을 때만 보인다 (옆 사람이 화면을 훔쳐보지 못하게)
 */

export type LiarOutcome = 'caught' | 'escaped' | 'stolen';

export interface LiarTable {
  teamId: string;
  name: string;
  color: string;
  memberIds: string[];
  liarId: string | null;
  word: string;
  options: string[];
  starterId: string;
  votes: Record<string, string>;
  ready: Record<string, boolean>;
  accusedId: string | null;
  guess: string | null;
  outcome: LiarOutcome | null;
}

export interface LiarState {
  stage: 'intro' | 'word' | 'talk' | 'vote' | 'guess' | 'reveal' | 'done';
  round: number;
  rounds: number;
  deadline: number;
  category: string;
  categoryOrder: number[];
  teams: TeamInfo[];
  tables: LiarTable[];
  /** 지금까지 라이어였던 사람 (같은 사람이 연달아 걸리지 않게) */
  pastLiars: string[];
  points: Record<string, number>;
  wordMs: number;
  talkMs: number;
  voteMs: number;
  guessMs: number;
  revealMs: number;
  history: Array<{ round: number; category: string; caught: number; escaped: number; stolen: number }>;
}

export interface LiarHostTable {
  name: string;
  color: string;
  size: number;
  voted: number;
  ready: number;
  /** 공개 단계에서만 */
  outcome: LiarOutcome | null;
  liarName: string | null;
  word: string | null;
  accusedName: string | null;
  guess: string | null;
}

export interface LiarHostView {
  stage: LiarState['stage'];
  round: number;
  rounds: number;
  deadline: number;
  category: string;
  tables: LiarHostTable[];
  score: { citizens: number; liars: number };
  topLiars: Array<{ nickname: string; points: number }>;
}

export interface LiarPlayerView {
  stage: LiarState['stage'];
  round: number;
  rounds: number;
  deadline: number;
  category: string;
  /** 테이블이 없으면(도중 입장 직후 등) 구경 */
  seated: boolean;
  isLiar: boolean;
  word: string | null;
  tableName: string;
  tableColor: string;
  /** 말할 순서 (첫 사람부터) */
  order: Array<{ id: string; nickname: string; color: string }>;
  myVote: string | null;
  votedCount: number;
  ready: boolean;
  readyCount: number;
  /** 라이어가 맞힐 보기 (라이어의 맞히기 단계에서만) */
  options: string[] | null;
  myGuess: string | null;
  accusedName: string | null;
  result: null | {
    outcome: LiarOutcome;
    liarName: string;
    word: string;
    guess: string | null;
    youWon: boolean;
  };
  points: number;
}

const MIN_TABLE = 3;
const OPTIONS = 8;

function categoryPool(ctx: GameCtx): WordCategory[] {
  const pool: WordCategory[] = [];
  const kw = ctx.pack.content.keywords;
  if (kw.length >= OPTIONS) pool.push({ name: '우리 모임 키워드', words: kw });
  pool.push(LIAR_PRESET_CATEGORY[ctx.pack.preset]);
  pool.push(...LIAR_CATEGORIES);
  return pool;
}

function tableOf(s: LiarState, playerId: string): LiarTable | null {
  return s.tables.find((t) => t.memberIds.includes(playerId)) ?? null;
}

function present(ctx: GameCtx, t: LiarTable): string[] {
  return t.memberIds.filter((id) => isConnected(ctx, id));
}

function humanPresent(ctx: GameCtx, t: LiarTable): string[] {
  return present(ctx, t).filter((id) => !ctx.players.find((p) => p.id === id)?.bot);
}

/** 라운드를 새로 깐다: 카테고리, 테이블마다 다른 제시어, 라이어, 첫 발언자 */
function deal(s: LiarState, ctx: GameCtx): void {
  const pool = categoryPool(ctx);
  const cat = pool[s.categoryOrder[(s.round - 1) % s.categoryOrder.length]! % pool.length]!;
  s.category = cat.name;
  const words = ctx.rng.shuffle(cat.words);
  s.tables = s.teams
    .filter((team) => team.memberIds.length > 0)
    .map((team, i) => {
      const word = words[i % words.length]!;
      const members = team.memberIds.filter((id) => ctx.players.some((p) => p.id === id));
      const candidates = members.filter((id) => isConnected(ctx, id));
      const fresh = candidates.filter((id) => !s.pastLiars.includes(id));
      const liarId =
        members.length >= MIN_TABLE && candidates.length > 0
          ? ctx.rng.pick(fresh.length > 0 ? fresh : candidates)
          : null;
      if (liarId) s.pastLiars.push(liarId);
      const decoys = ctx.rng.sample(
        cat.words.filter((w) => w !== word),
        OPTIONS - 1,
      );
      // 첫 발언자는 라이어가 아닌 사람 (첫 순서 라이어는 너무 불리하다)
      const starters = candidates.filter((id) => id !== liarId);
      return {
        teamId: team.id,
        name: team.name,
        color: team.color,
        memberIds: members,
        liarId,
        word,
        options: ctx.rng.shuffle([word, ...decoys]),
        starterId: starters.length > 0 ? ctx.rng.pick(starters) : (members[0] ?? ''),
        votes: {},
        ready: {},
        accusedId: null,
        guess: null,
        outcome: null,
      };
    });
}

/** 투표를 센다: 가장 많이 지목된 한 명 (동점이면 지목 실패 → 라이어 도망) */
function tally(t: LiarTable): string | null {
  const count = new Map<string, number>();
  for (const target of Object.values(t.votes)) count.set(target, (count.get(target) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  let tie = false;
  for (const [id, n] of count) {
    if (n > bestN) {
      best = id;
      bestN = n;
      tie = false;
    } else if (n === bestN) tie = true;
  }
  return tie ? null : best;
}

function settle(s: LiarState, ctx: GameCtx): void {
  let caught = 0;
  let escaped = 0;
  let stolen = 0;
  for (const t of s.tables) {
    if (!t.liarId) continue;
    if (t.accusedId !== t.liarId) t.outcome = 'escaped';
    else t.outcome = t.guess === t.word ? 'stolen' : 'caught';
    if (t.outcome === 'caught') {
      caught += 1;
      for (const id of t.memberIds) if (id !== t.liarId) s.points[id] = (s.points[id] ?? 0) + 1;
    } else {
      if (t.outcome === 'escaped') escaped += 1;
      else stolen += 1;
      s.points[t.liarId] = (s.points[t.liarId] ?? 0) + (t.outcome === 'escaped' ? 3 : 2);
    }
  }
  s.history.push({ round: s.round, category: s.category, caught, escaped, stolen });
  s.stage = 'reveal';
  s.deadline = ctx.now + s.revealMs;
}

function toVote(s: LiarState, ctx: GameCtx): void {
  s.stage = 'vote';
  s.deadline = ctx.now + s.voteMs;
}

function afterVote(s: LiarState, ctx: GameCtx): void {
  for (const t of s.tables) t.accusedId = tally(t);
  const guessing = s.tables.some((t) => t.liarId && t.accusedId === t.liarId && isConnected(ctx, t.liarId));
  if (guessing) {
    s.stage = 'guess';
    s.deadline = ctx.now + s.guessMs;
  } else settle(s, ctx);
}

export const liar: GameModule<LiarState, LiarHostView, LiarPlayerView> = {
  meta: {
    id: 'liar',
    title: '라이어 게임',
    tagline: '우리 테이블에 제시어를 모르는 사람이 한 명 있다',
    rules: [
      '테이블마다 한 명은 라이어! 라이어는 카테고리만 알아요',
      '돌아가며 제시어를 한마디로 설명해요. 너무 쉬우면 라이어가 눈치채요',
      '다 말했으면 폰으로 라이어를 지목해요',
      '라이어가 잡혀도 제시어를 맞히면 라이어 승리',
    ],
    minPlayers: 3,
    permissions: [],
    usesPack: ['keywords', 'teamNames'],
    teamMode: 'uses',
    minutes: 6,
    extra: true,
  },

  init(ctx) {
    const pool = categoryPool(ctx);
    // 첫 라운드는 모임 키워드(있으면) 또는 모임 종류 카테고리, 다음부터는 섞어서
    const firsts = ctx.pack.content.keywords.length >= OPTIONS ? [0, 1] : [0];
    const rest = ctx.rng.shuffle(pool.map((_, i) => i).filter((i) => !firsts.includes(i)));
    return {
      stage: 'intro',
      round: 0,
      rounds: ctx.settings.liarRounds,
      deadline: 0,
      category: '',
      categoryOrder: [...firsts, ...rest],
      teams: [],
      tables: [],
      pastLiars: [],
      points: {},
      wordMs: 6_000,
      talkMs: ctx.settings.liarTalkSeconds * 1000,
      voteMs: 20_000,
      guessMs: 15_000,
      revealMs: 9_000,
      history: [],
    };
  },

  start(s, ctx) {
    s.teams = tableTeams(ctx, MIN_TABLE);
    s.round = 1;
    deal(s, ctx);
    s.stage = 'word';
    s.deadline = ctx.now + s.wordMs;
  },

  input(s, ctx, playerId, input) {
    const t = tableOf(s, playerId);
    if (!t?.liarId) return;
    const type = inputType(input);
    if (type === 'ready' && (s.stage === 'talk' || s.stage === 'word')) {
      t.ready[playerId] = true;
      const everyoneReady = s.tables
        .filter((tb) => tb.liarId)
        .every((tb) => {
          const humans = humanPresent(ctx, tb);
          const people = humans.length > 0 ? humans : present(ctx, tb);
          return people.every((id) => tb.ready[id]);
        });
      if (s.stage === 'talk' && everyoneReady) toVote(s, ctx);
      return;
    }
    if (type === 'vote' && s.stage === 'vote') {
      const target = (input as { target?: unknown }).target;
      if (typeof target !== 'string' || target === playerId || !t.memberIds.includes(target)) return;
      t.votes[playerId] = target;
      const allVoted = s.tables
        .filter((tb) => tb.liarId)
        .every((tb) => present(ctx, tb).every((id) => tb.votes[id] !== undefined));
      if (allVoted) afterVote(s, ctx);
      return;
    }
    if (type === 'guess' && s.stage === 'guess' && t.liarId === playerId && t.accusedId === playerId) {
      const word = (input as { word?: unknown }).word;
      if (typeof word !== 'string' || !t.options.includes(word) || t.guess !== null) return;
      t.guess = word;
      const pending = s.tables.some(
        (tb) => tb.liarId && tb.accusedId === tb.liarId && tb.guess === null && isConnected(ctx, tb.liarId),
      );
      if (!pending) settle(s, ctx);
    }
  },

  tick(s, ctx) {
    if (s.stage === 'word' && ctx.now >= s.deadline) {
      s.stage = 'talk';
      s.deadline = ctx.now + s.talkMs;
      return;
    }
    if (s.stage === 'talk' && ctx.now >= s.deadline) return toVote(s, ctx);
    if (s.stage === 'vote' && ctx.now >= s.deadline) return afterVote(s, ctx);
    if (s.stage === 'guess' && ctx.now >= s.deadline) return settle(s, ctx);
    if (s.stage === 'reveal' && ctx.now >= s.deadline) {
      if (s.round >= s.rounds) {
        s.stage = 'done';
        return;
      }
      s.round += 1;
      deal(s, ctx);
      s.stage = 'word';
      s.deadline = ctx.now + s.wordMs;
    }
  },

  hostAction(s, ctx, action) {
    if (action === 'skip-talk' && (s.stage === 'talk' || s.stage === 'word')) toVote(s, ctx);
    else if (action === 'end-vote' && s.stage === 'vote') afterVote(s, ctx);
  },

  finished(s) {
    return s.stage === 'done';
  },

  playerJoined(s, ctx, playerId) {
    if (tableOf(s, playerId) || s.tables.length === 0) return;
    // 늦게 온 사람은 가장 작은 테이블의 시민으로 앉는다 (제시어를 본다)
    const t = [...s.tables].sort((a, b) => a.memberIds.length - b.memberIds.length)[0]!;
    t.memberIds.push(playerId);
    const team = s.teams.find((tm) => tm.id === t.teamId);
    if (team && !team.memberIds.includes(playerId)) team.memberIds.push(playerId);
    void ctx;
  },

  hostView(s, ctx) {
    const reveal = s.stage === 'reveal' || s.stage === 'done';
    const liarsWins = s.history.reduce((n, h) => n + h.escaped + h.stolen, 0);
    const citizenWins = s.history.reduce((n, h) => n + h.caught, 0);
    return {
      stage: s.stage,
      round: s.round,
      rounds: s.rounds,
      deadline: s.deadline,
      category: s.category,
      tables: s.tables.map((t) => ({
        name: t.name,
        color: t.color,
        size: t.memberIds.length,
        voted: Object.keys(t.votes).length,
        ready: Object.values(t.ready).filter(Boolean).length,
        outcome: reveal ? t.outcome : null,
        liarName: reveal && t.liarId ? nicknameOf(ctx, t.liarId) : null,
        word: reveal ? t.word : null,
        accusedName: (reveal || s.stage === 'guess') && t.accusedId ? nicknameOf(ctx, t.accusedId) : null,
        guess: reveal ? t.guess : null,
      })),
      score: { citizens: citizenWins, liars: liarsWins },
      topLiars: Object.entries(s.points)
        .filter(([id]) => s.pastLiars.includes(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, points]) => ({ nickname: nicknameOf(ctx, id), points })),
    };
  },

  playerView(s, ctx, playerId) {
    const t = tableOf(s, playerId);
    const isLiar = !!t && t.liarId === playerId;
    const reveal = s.stage === 'reveal' || s.stage === 'done';
    const order = t
      ? (() => {
          const i = Math.max(0, t.memberIds.indexOf(t.starterId));
          const ring = [...t.memberIds.slice(i), ...t.memberIds.slice(0, i)];
          return ring.map((id) => ({ id, nickname: nicknameOf(ctx, id), color: colorOf(ctx, id) }));
        })()
      : [];
    let result: LiarPlayerView['result'] = null;
    if (reveal && t && t.outcome && t.liarId) {
      const liarWon = t.outcome !== 'caught';
      result = {
        outcome: t.outcome,
        liarName: nicknameOf(ctx, t.liarId),
        word: t.word,
        guess: t.guess,
        youWon: isLiar ? liarWon : !liarWon,
      };
    }
    return {
      stage: s.stage,
      round: s.round,
      rounds: s.rounds,
      deadline: s.deadline,
      category: s.category,
      seated: !!t?.liarId,
      isLiar,
      word: t && !isLiar ? t.word : null,
      tableName: t?.name ?? '',
      tableColor: t?.color ?? '#999999',
      order,
      myVote: t?.votes[playerId] ?? null,
      votedCount: t ? Object.keys(t.votes).length : 0,
      ready: t?.ready[playerId] ?? false,
      readyCount: t ? Object.values(t.ready).filter(Boolean).length : 0,
      options: s.stage === 'guess' && isLiar && t?.accusedId === playerId ? t.options : null,
      myGuess: isLiar ? (t?.guess ?? null) : null,
      accusedName: t?.accusedId && (s.stage === 'guess' || reveal) ? nicknameOf(ctx, t.accusedId) : null,
      result,
      points: s.points[playerId] ?? 0,
    };
  },

  summary(s, ctx): GameSummary {
    const caught = s.history.reduce((n, h) => n + h.caught, 0);
    const escaped = s.history.reduce((n, h) => n + h.escaped, 0);
    const stolen = s.history.reduce((n, h) => n + h.stolen, 0);
    const total = caught + escaped + stolen;
    const best = Object.entries(s.points)
      .filter(([id]) => s.pastLiars.includes(id) && (s.points[id] ?? 0) >= 2)
      .sort((a, b) => b[1] - a[1])[0];
    const highlights = [`라이어 ${total}명 중 ${caught}명 검거, ${escaped}명 도망, ${stolen}명 역전승`];
    if (best) highlights.push(`최고의 거짓말쟁이: ${nicknameOf(ctx, best[0])}`);
    const players = connectedPlayers(ctx).length;
    return {
      gameId: 'liar',
      title: '라이어 게임',
      headline:
        total === 0
          ? `${players}명이 서로를 의심했어요`
          : caught * 2 >= total
            ? `시민 승리! 라이어 ${total}명 중 ${caught}명을 잡았어요`
            : `라이어 승리! ${total - caught}명이 끝까지 속였어요`,
      highlights,
      metrics: { rounds: s.history.length, caught, escaped, stolen },
      teams: s.teams.map((t) => ({ ...t, memberIds: [...t.memberIds] })),
    };
  },
};
