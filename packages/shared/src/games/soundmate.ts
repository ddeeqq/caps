import { josa } from '../pack/josa';
import { TEAM_COLORS, type TeamInfo } from '../util/teams';
import { ufAllConnected, ufFind, ufLargestGroup, ufUnion, type UnionFindState } from '../util/unionFind';
import {
  connectedPlayers,
  inputType,
  isConnected,
  nicknameOf,
  splitHumansAndBots,
  teamForNewcomer,
} from './common';
import type { GameCtx, GameModule, GameSummary } from './types';

/**
 * 게임 ② 소리 짝꿍
 * 폰을 누르면 배정된 동물 소리가 나고, 같은 소리를 내는 사람끼리 모이면 팀이 완성된다.
 * 소리는 폰이 내니 민망할 일이 없다. 팀원 아무나 한 명의 QR(또는 4자리 코드)만 찍어도 연결되고,
 * 서버는 연결들을 유니온 파인드로 묶어 팀 전체가 이어졌는지 판단한다.
 * 완성된 팀은 밸런스 질문 하나에 팀 의견을 통일하는 미션을 받는다.
 */

export interface SoundDef {
  id: string;
  name: string;
  /** 소리가 안 나는 폰에서 대신 보여줄 의성어 */
  text: string;
  icon: string;
}

export const SOUNDS: readonly SoundDef[] = [
  { id: 'goat', name: '염소', text: '음메에~', icon: '🐐' },
  { id: 'chicken', name: '닭', text: '꼬끼오!', icon: '🐓' },
  { id: 'duck', name: '오리', text: '꽥꽥', icon: '🦆' },
  { id: 'frog', name: '개구리', text: '개굴개굴', icon: '🐸' },
  { id: 'cat', name: '고양이', text: '야옹~', icon: '🐱' },
  { id: 'cow', name: '소', text: '음머~', icon: '🐮' },
  { id: 'dog', name: '강아지', text: '멍멍!', icon: '🐶' },
  { id: 'owl', name: '부엉이', text: '부엉부엉', icon: '🦉' },
];

export function soundById(id: string): SoundDef {
  return SOUNDS.find((s) => s.id === id) ?? (SOUNDS[0] as SoundDef);
}

/** variant 1은 같은 동물이 빠르게 두 번 운다 → 팀이 8개를 넘어도 구분된다 */
export function soundLabel(soundId: string, variant: number): string {
  const s = soundById(soundId);
  return variant === 1 ? `빠른 ${s.name}` : s.name;
}

export function soundText(soundId: string, variant: number): string {
  const s = soundById(soundId);
  return variant === 1 ? `${s.text} ${s.text}` : s.text;
}

export type Vote = 'a' | 'b';

export interface SoundmateTeam {
  id: string;
  name: string;
  color: string;
  soundId: string;
  variant: number;
  memberIds: string[];
  completeAt: number | null;
  rank: number | null;
  forced: boolean;
  mission: {
    prompt: string;
    a: string;
    b: string;
    votes: Record<string, Vote>;
    deadline: number | null;
    decided: Vote | 'split' | null;
  };
}

export interface SoundmateFeedback {
  kind: 'ok' | 'wrong' | 'self' | 'unknown' | 'already';
  text: string;
  at: number;
}

export interface SoundmateState {
  stage: 'intro' | 'search' | 'mission' | 'done';
  startedAt: number;
  teams: SoundmateTeam[];
  teamOf: Record<string, string>;
  codes: Record<string, string>;
  codeOwner: Record<string, string>;
  parent: UnionFindState;
  links: Array<{ a: string; b: string; at: number }>;
  wrong: Array<{ from: string; to: string; at: number }>;
  feedback: Record<string, SoundmateFeedback>;
  searchDeadline: number;
  missionMs: number;
  events: Array<{ text: string; at: number }>;
}

export interface SoundmateHostView {
  stage: SoundmateState['stage'];
  searchDeadline: number;
  teams: Array<{
    id: string;
    name: string;
    color: string;
    icon: string;
    size: number;
    found: number;
    complete: boolean;
    rank: number | null;
    forced: boolean;
    seconds: number | null;
    mission: {
      prompt: string;
      a: string;
      b: string;
      votesA: number;
      votesB: number;
      decided: Vote | 'split' | null;
    };
  }>;
  links: number;
  wrong: number;
  events: Array<{ text: string; at: number }>;
}

export interface SoundmatePlayerView {
  stage: SoundmateState['stage'];
  soundId: string;
  variant: number;
  soundText: string;
  myCode: string;
  teamSize: number;
  groupSize: number;
  teamComplete: boolean;
  teamName: string | null;
  teamColor: string | null;
  teamIcon: string | null;
  teammates: string[] | null;
  rank: number | null;
  mission: null | {
    prompt: string;
    a: string;
    b: string;
    myVote: Vote | null;
    deadline: number | null;
    decided: Vote | 'split' | null;
    votesA: number;
    votesB: number;
    total: number;
  };
  feedback: SoundmateFeedback | null;
  searchDeadline: number;
}

const FEEDBACK_TTL = 6_000;
const LATE_MISSION_MS = 20_000;

function teamFor(s: SoundmateState, playerId: string): SoundmateTeam | null {
  const id = s.teamOf[playerId];
  return id ? (s.teams.find((t) => t.id === id) ?? null) : null;
}

function newCode(s: SoundmateState, ctx: GameCtx): string {
  for (let i = 0; i < 200; i++) {
    const code = String(ctx.rng.int(1000, 9999));
    if (!s.codeOwner[code]) return code;
  }
  return String(10000 + Object.keys(s.codeOwner).length);
}

function assignCode(s: SoundmateState, ctx: GameCtx, playerId: string): void {
  const code = newCode(s, ctx);
  s.codes[playerId] = code;
  s.codeOwner[code] = playerId;
}

function pushEvent(s: SoundmateState, text: string, at: number): void {
  s.events.push({ text, at });
  if (s.events.length > 20) s.events.shift();
}

function requiredMembers(team: SoundmateTeam, ctx: GameCtx): string[] {
  return team.memberIds.filter((id) => isConnected(ctx, id));
}

function completeTeam(s: SoundmateState, ctx: GameCtx, team: SoundmateTeam, forced: boolean): void {
  if (team.completeAt !== null) return;
  team.completeAt = ctx.now;
  team.forced = forced;
  team.rank = s.teams.filter((t) => t.completeAt !== null).length;
  team.mission.deadline = ctx.now + (forced ? Math.min(LATE_MISSION_MS, s.missionMs) : s.missionMs);
  if (!forced) {
    const sec = Math.round((ctx.now - s.startedAt) / 1000);
    pushEvent(s, `${team.name} 완성! ${team.rank}등 (${sec}초)`, ctx.now);
  }
}

function checkTeam(s: SoundmateState, ctx: GameCtx, team: SoundmateTeam): void {
  if (team.completeAt !== null) return;
  const required = requiredMembers(team, ctx);
  if (required.length === 0) return;
  if (ufAllConnected(s.parent, required)) completeTeam(s, ctx, team, false);
}

function decideMission(team: SoundmateTeam, ctx: GameCtx, force: boolean): void {
  const m = team.mission;
  if (m.decided !== null || team.completeAt === null) return;
  const voters = requiredMembers(team, ctx);
  const votes = voters.map((id) => m.votes[id]).filter((v): v is Vote => v !== undefined);
  const allVoted = voters.length > 0 && votes.length === voters.length;
  if (allVoted && votes.every((v) => v === votes[0])) {
    m.decided = votes[0] as Vote;
    return;
  }
  if (force || (m.deadline !== null && ctx.now >= m.deadline)) {
    const a = votes.filter((v) => v === 'a').length;
    const b = votes.length - a;
    m.decided = a === b ? 'split' : a > b ? 'a' : 'b';
  }
}

export const soundmate: GameModule<SoundmateState, SoundmateHostView, SoundmatePlayerView> = {
  meta: {
    id: 'soundmate',
    title: '소리 짝꿍',
    tagline: '같은 소리를 내는 사람을 귀로 찾아라',
    rules: [
      '버튼을 누르면 내 폰에서 동물 소리가 나요',
      '같은 소리를 내는 사람을 찾아 그 사람의 QR을 스캔!',
      '팀원 누구 한 명과만 연결돼도 이어져요',
      '팀이 모이면 밸런스 질문 하나에 팀 의견을 통일하세요',
    ],
    minPlayers: 4,
    permissions: ['audio', 'camera'],
    usesPack: ['teamNames', 'balanceQuestions'],
    teamMode: 'creates',
    minutes: 5,
  },

  init(ctx) {
    const groups = splitHumansAndBots(connectedPlayers(ctx), ctx.rng);
    const questions = ctx.pack.balancePool;
    const s: SoundmateState = {
      stage: 'intro',
      startedAt: ctx.now,
      teams: [],
      teamOf: {},
      codes: {},
      codeOwner: {},
      parent: {},
      links: [],
      wrong: [],
      feedback: {},
      searchDeadline: ctx.now + ctx.settings.soundmateSeconds * 1000,
      missionMs: ctx.settings.missionSeconds * 1000,
      events: [],
    };
    groups.forEach((memberIds, i) => {
      const sound = SOUNDS[i % SOUNDS.length] as SoundDef;
      const variant = Math.floor(i / SOUNDS.length) % 2;
      const label = soundLabel(sound.id, variant);
      const prefix = ctx.pack.content.teamNames[i];
      const q = questions.length > 0 ? questions[i % questions.length] : undefined;
      const team: SoundmateTeam = {
        id: `t${i + 1}`,
        name: prefix ? `${prefix} ${label}` : `${label} 팀`,
        color: TEAM_COLORS[i % TEAM_COLORS.length] as string,
        soundId: sound.id,
        variant,
        memberIds: [...memberIds],
        completeAt: null,
        rank: null,
        forced: false,
        mission: {
          prompt: q?.prompt ?? '하나만 고른다면?',
          a: q?.a ?? '짜장',
          b: q?.b ?? '짬뽕',
          votes: {},
          deadline: null,
          decided: null,
        },
      };
      s.teams.push(team);
      for (const id of memberIds) {
        s.teamOf[id] = team.id;
        s.parent[id] = id;
        assignCode(s, ctx, id);
      }
    });
    return s;
  },

  start(s, ctx) {
    s.stage = 'search';
    s.startedAt = ctx.now;
    s.searchDeadline = ctx.now + ctx.settings.soundmateSeconds * 1000;
    // 혼자인 팀(접속자가 한 명뿐인 팀)은 바로 완성 처리
    for (const team of s.teams) checkTeam(s, ctx, team);
  },

  input(s, ctx, playerId, input, at) {
    void at;
    const type = inputType(input);
    const me = teamFor(s, playerId);
    if (!me) return;

    if (type === 'link' && s.stage === 'search') {
      const raw = String((input as { code?: unknown }).code ?? '');
      const code = raw.replace(/\D/g, '').slice(-5);
      const target = s.codeOwner[code];
      if (!target) {
        s.feedback[playerId] = {
          kind: 'unknown',
          text: '그런 코드는 없어요. 다시 확인해 주세요',
          at: ctx.now,
        };
        return;
      }
      if (target === playerId) {
        s.feedback[playerId] = { kind: 'self', text: '그건 내 코드예요 :)', at: ctx.now };
        return;
      }
      const other = teamFor(s, target);
      if (!other || other.id !== me.id) {
        // 같은 사람을 여러 번 찍어도 "말 건 횟수"는 한 번만 센다 (지표 부풀림 방지)
        if (!s.wrong.some((w) => w.from === playerId && w.to === target)) {
          s.wrong.push({ from: playerId, to: target, at: ctx.now });
        }
        const label = other ? soundLabel(other.soundId, other.variant) : '다른 팀';
        s.feedback[playerId] = {
          kind: 'wrong',
          text: `땡! ${nicknameOf(ctx, target)}님은 ${label}예요`,
          at: ctx.now,
        };
        return;
      }
      if (ufFind(s.parent, playerId) === ufFind(s.parent, target)) {
        s.feedback[playerId] = { kind: 'already', text: '이미 이어진 팀원이에요', at: ctx.now };
        return;
      }
      ufUnion(s.parent, playerId, target);
      s.links.push({ a: playerId, b: target, at: ctx.now });
      s.feedback[playerId] = {
        kind: 'ok',
        text: `연결! ${nicknameOf(ctx, target)}님과 같은 팀`,
        at: ctx.now,
      };
      s.feedback[target] = {
        kind: 'ok',
        text: `연결! ${nicknameOf(ctx, playerId)}님이 찾아왔어요`,
        at: ctx.now,
      };
      checkTeam(s, ctx, me);
      return;
    }

    if (type === 'vote') {
      const choice = (input as { choice?: unknown }).choice;
      if (choice !== 'a' && choice !== 'b') return;
      if (me.completeAt === null || me.mission.decided !== null) return;
      me.mission.votes[playerId] = choice;
      decideMission(me, ctx, false);
    }
  },

  tick(s, ctx) {
    if (s.stage === 'intro' || s.stage === 'done') return;
    for (const team of s.teams) {
      checkTeam(s, ctx, team); // 접속이 끊긴 팀원이 생기면 남은 인원만으로 완성될 수 있다
      decideMission(team, ctx, false);
    }
    if (s.stage === 'search') {
      const allComplete = s.teams.every((t) => t.completeAt !== null);
      if (ctx.now >= s.searchDeadline && !allComplete) {
        for (const team of s.teams) if (team.completeAt === null) completeTeam(s, ctx, team, true);
        pushEvent(s, '시간 종료! 못 모인 사람도 팀으로 합류해요', ctx.now);
      }
      if (s.teams.every((t) => t.completeAt !== null)) s.stage = 'mission';
    }
    if (s.stage === 'mission' && s.teams.every((t) => t.mission.decided !== null)) s.stage = 'done';
  },

  finished(s) {
    return s.stage === 'done';
  },

  hostAction(s, ctx, action) {
    if (action === 'end-search' && s.stage === 'search') {
      s.searchDeadline = ctx.now;
    }
    if (action === 'end-missions') {
      for (const team of s.teams) {
        if (team.completeAt === null) completeTeam(s, ctx, team, true);
        decideMission(team, ctx, true);
      }
    }
  },

  playerJoined(s, ctx, playerId) {
    if (s.teamOf[playerId]) return;
    const team = teamForNewcomer(s.teams, ctx, playerId);
    if (!team) return;
    team.memberIds.push(playerId);
    s.teamOf[playerId] = team.id;
    s.parent[playerId] = playerId;
    assignCode(s, ctx, playerId);
    // 이미 완성된 팀이면 자동으로 이어 준다 (완성 상태를 되돌리지 않음)
    if (team.completeAt !== null && team.memberIds[0]) ufUnion(s.parent, playerId, team.memberIds[0]);
  },

  hostView(s) {
    return {
      stage: s.stage,
      searchDeadline: s.searchDeadline,
      teams: s.teams.map((t) => {
        const votes = Object.values(t.mission.votes);
        return {
          id: t.id,
          name: t.name,
          color: t.color,
          icon: soundById(t.soundId).icon,
          size: t.memberIds.length,
          found: ufLargestGroup(s.parent, t.memberIds),
          complete: t.completeAt !== null,
          rank: t.rank,
          forced: t.forced,
          seconds:
            t.completeAt !== null && !t.forced ? Math.round((t.completeAt - s.startedAt) / 1000) : null,
          mission: {
            prompt: t.mission.prompt,
            a: t.mission.a,
            b: t.mission.b,
            votesA: votes.filter((v) => v === 'a').length,
            votesB: votes.filter((v) => v === 'b').length,
            decided: t.mission.decided,
          },
        };
      }),
      links: s.links.length,
      wrong: s.wrong.length,
      events: s.events.slice(-6),
    };
  },

  playerView(s, ctx, playerId) {
    const team = teamFor(s, playerId);
    const fb = s.feedback[playerId];
    if (!team) {
      return {
        stage: s.stage,
        soundId: 'goat',
        variant: 0,
        soundText: '',
        myCode: '',
        teamSize: 0,
        groupSize: 0,
        teamComplete: false,
        teamName: null,
        teamColor: null,
        teamIcon: null,
        teammates: null,
        rank: null,
        mission: null,
        feedback: null,
        searchDeadline: s.searchDeadline,
      };
    }
    const complete = team.completeAt !== null;
    const myRoot = ufFind(s.parent, playerId);
    const groupSize = team.memberIds.filter((id) => ufFind(s.parent, id) === myRoot).length;
    const votes = Object.values(team.mission.votes);
    return {
      stage: s.stage,
      soundId: team.soundId,
      variant: team.variant,
      soundText: soundText(team.soundId, team.variant),
      myCode: s.codes[playerId] ?? '',
      teamSize: team.memberIds.length,
      groupSize,
      teamComplete: complete,
      teamName: complete ? team.name : null,
      teamColor: complete ? team.color : null,
      teamIcon: complete ? soundById(team.soundId).icon : null,
      teammates: complete
        ? team.memberIds.filter((id) => id !== playerId).map((id) => nicknameOf(ctx, id))
        : null,
      rank: team.rank,
      mission: complete
        ? {
            prompt: team.mission.prompt,
            a: team.mission.a,
            b: team.mission.b,
            myVote: team.mission.votes[playerId] ?? null,
            deadline: team.mission.deadline,
            decided: team.mission.decided,
            votesA: votes.filter((v) => v === 'a').length,
            votesB: votes.filter((v) => v === 'b').length,
            total: team.memberIds.length,
          }
        : null,
      feedback: fb && ctx.now - fb.at < FEEDBACK_TTL ? fb : null,
      searchDeadline: s.searchDeadline,
    };
  },

  summary(s): GameSummary {
    const finished = s.teams.filter((t) => t.completeAt !== null && !t.forced);
    const first = [...finished].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
    const avgSec =
      finished.length > 0
        ? Math.round(
            finished.reduce((sum, t) => sum + ((t.completeAt as number) - s.startedAt), 0) /
              finished.length /
              1000,
          )
        : -1;
    const unanimous = s.teams.filter(
      (t) =>
        t.mission.decided !== null &&
        t.mission.decided !== 'split' &&
        Object.keys(t.mission.votes).length === t.memberIds.length,
    ).length;
    const highlights: string[] = [];
    if (first?.completeAt != null) {
      highlights.push(
        `가장 빨리 모인 팀: ${first.name} (${Math.round((first.completeAt - s.startedAt) / 1000)}초)`,
      );
    }
    highlights.push(`서로 말을 걸어 연결한 횟수 ${s.links.length}번 (헛걸음 ${s.wrong.length}번)`);
    if (unanimous > 0) highlights.push(`만장일치로 의견을 모은 팀 ${unanimous}개`);
    const teams: TeamInfo[] = s.teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      memberIds: [...t.memberIds],
      soundId: t.soundId,
    }));
    return {
      gameId: 'soundmate',
      title: '소리 짝꿍',
      headline: first ? `${josa(first.name, '이/가')} 가장 먼저 서로를 찾아냈어요` : '모두 팀으로 모였어요',
      highlights,
      metrics: {
        links: s.links.length,
        wrongLinks: s.wrong.length,
        faceToFace: s.links.length + s.wrong.length,
        avgCompleteSec: avgSec,
        forcedTeams: s.teams.filter((t) => t.forced).length,
        unanimousTeams: unanimous,
      },
      teams,
      ranking: [...s.teams].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((t) => t.id),
    };
  },
};
