import type { TeamInfo } from '../util/teams';
import { clamp, connectedPlayers, inputType, nicknameOf, reconcileTeams } from './common';
import type { GameCtx, GameModule, GameSummary } from './types';

/**
 * 게임 ④ 인간 카드섹션
 * 불을 끄고 모두 폰을 들면, 폰 화면들이 픽셀이 되어 색 파도와 문구가 방을 지나간다.
 * 서버는 "서버 시각 T에 시작"만 한 번 보낸다. 각 폰은 자기 좌표와 동기화된 시계로
 * 매 프레임 자기 색을 직접 계산한다 → 인원이 늘어도 서버 부하가 늘지 않는다.
 * 색 = showFrame(params, cell, t) 순수 함수라 큰 화면 시뮬레이터와 폰이 같은 결과를 낸다.
 */

export interface ShowParams {
  startAt: number;
  durationMs: number;
  rows: number;
  cols: number;
  message: string;
  /** 팀 색 (순위 순서) */
  teamColors: string[];
}

export interface CellInfo {
  row: number | null;
  col: number | null;
  /** 팀 순위 인덱스 (0 = 1등). 팀이 없으면 null */
  teamRank: number | null;
}

export interface CellFrame {
  bg: string;
  fg: string;
  text: string;
  /** 자리 미등록 폰에 문구 전체를 작게 보여줄 때 */
  small?: boolean;
}

/** 연출 구간 (40초 기준 타임라인) */
export const SHOW_BASE_MS = 40_000;
export const SHOW_SEGMENTS = [
  { id: 'countdown', from: 0, to: 3_000, label: '카운트다운' },
  { id: 'wave', from: 3_000, to: 11_000, label: '색 파도' },
  { id: 'teams', from: 11_000, to: 21_000, label: '팀 색 물결' },
  { id: 'message', from: 21_000, to: 33_000, label: '피날레 문구' },
  { id: 'finale', from: 33_000, to: 40_000, label: '한 색으로 모였다 꺼짐' },
] as const;

const DARK = '#0b0b10';
const BLACK = '#000000';
const GOLD = '#FFD84D';

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const h = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function mixColor(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = clamp(t, 0, 1);
  return toHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s)}% ${Math.round(clamp(l, 0, 100))}%)`;
}

/** 셀 하나의 현재 프레임. elapsedMs = 서버 시각 기준 연출 시작 후 경과 시간 */
export function showFrame(p: ShowParams, cell: CellInfo, elapsedMs: number): CellFrame {
  const u = (elapsedMs * SHOW_BASE_MS) / Math.max(1, p.durationMs);
  if (u < 0) return { bg: BLACK, fg: '#777777', text: '' };
  if (u >= SHOW_BASE_MS) return { bg: BLACK, fg: BLACK, text: '' };
  const cols = Math.max(1, p.cols);
  const rows = Math.max(1, p.rows);
  const col = cell.col ?? (cols - 1) / 2;
  const row = cell.row ?? (rows - 1) / 2;

  // 1. 카운트다운: 매 초 시작에 흰색 플래시
  if (u < 3_000) {
    const n = 3 - Math.floor(u / 1000);
    const flash = u % 1000 < 140;
    return flash
      ? { bg: '#ffffff', fg: BLACK, text: String(n) }
      : { bg: DARK, fg: '#ffffff', text: String(n) };
  }

  // 2. 색 파도: 밝은 띠가 왼쪽 열부터 오른쪽 열로 두 번 지나간다
  if (u < 11_000) {
    const s = (u - 3_000) / 8_000;
    const span = cols + 4;
    const pos = ((s * 2 * span) % span) - 2;
    const intensity =
      cell.col === null
        ? 0.5 + 0.5 * Math.sin(s * Math.PI * 8)
        : Math.exp(-((col - pos) ** 2) / (2 * 1.1 * 1.1));
    const hue = 200 + s * 540 + row * 12;
    return { bg: hsl(hue, 95, 6 + 58 * intensity), fg: '#ffffff', text: '' };
  }

  // 3. 팀 색 물결: 금고 순위대로 팀 색이 하나씩 켜진다
  if (u < 21_000) {
    const n = Math.max(1, p.teamColors.length);
    const step = 8_000 / n;
    if (cell.teamRank !== null && p.teamColors.length > 0) {
      const litAt = 11_000 + cell.teamRank * step;
      if (u < litAt) return { bg: DARK, fg: '#ffffff', text: '' };
      const since = u - litAt;
      const base = p.teamColors[cell.teamRank % p.teamColors.length] as string;
      if (since < 180) return { bg: '#ffffff', fg: BLACK, text: '' };
      const pulse = 0.72 + 0.28 * Math.sin((since / 1000) * Math.PI * 2 * 1.2);
      return { bg: mixColor(BLACK, base, pulse), fg: '#ffffff', text: '' };
    }
    const allLitAt = 11_000 + n * step;
    if (u < allLitAt) return { bg: DARK, fg: '#ffffff', text: '' };
    const pulse = 0.18 + 0.12 * Math.sin(((u - allLitAt) / 1000) * Math.PI * 2);
    return { bg: mixColor(BLACK, '#ffffff', pulse), fg: '#ffffff', text: '' };
  }

  // 4. 문구: 각 열이 한 글자씩 맡는다. 열보다 길면 오른쪽에서 흘러 들어온다
  if (u < 33_000) {
    const local = u - 21_000;
    const hue = 270 + row * 10 + (local / 12_000) * 70;
    const bg = hsl(hue, 70, 14);
    if (cell.col === null) return { bg, fg: '#ffffff', text: p.message, small: true };
    const chars = Array.from(p.message);
    let ch = '';
    if (chars.length <= cols) {
      const pad = Math.floor((cols - chars.length) / 2);
      ch = chars[cell.col - pad] ?? '';
    } else {
      const shift = Math.floor(local / 700);
      const idx = cell.col + shift - cols;
      ch = idx >= 0 && idx < chars.length ? (chars[idx] as string) : '';
    }
    return { bg, fg: '#ffffff', text: ch.trim() };
  }

  // 5. 피날레: 가운데부터 금색으로 번져 하나가 되고, 흰색으로 빛난 뒤 동시에 꺼진다
  if (u < 37_000) {
    const t = (u - 33_000) / 4_000;
    const cr = (rows - 1) / 2;
    const cc = (cols - 1) / 2;
    const maxDist = Math.hypot(cr, cc) || 1;
    const delay = (Math.hypot(row - cr, col - cc) / maxDist) * 0.35;
    const k = clamp((t - delay) / 0.65, 0, 1);
    return { bg: mixColor(DARK, GOLD, k), fg: BLACK, text: '' };
  }
  if (u < 39_400) {
    const t = (u - 37_000) / 2_400;
    return { bg: mixColor(GOLD, '#ffffff', clamp(t * 3, 0, 1)), fg: BLACK, text: '' };
  }
  return { bg: BLACK, fg: BLACK, text: '' };
}

export interface CardsectionState {
  stage: 'intro' | 'seat' | 'show' | 'done';
  rows: number;
  cols: number;
  seats: Record<string, { row: number; col: number }>;
  show: ShowParams | null;
  endAt: number;
  teams: TeamInfo[] | null;
  teamRank: Record<string, number>;
}

export interface CardsectionHostView {
  stage: CardsectionState['stage'];
  rows: number;
  cols: number;
  seats: Array<{ row: number; col: number; color: string; nickname: string; teamRank: number | null }>;
  seatedCount: number;
  playerCount: number;
  show: ShowParams | null;
  endAt: number;
  segments: typeof SHOW_SEGMENTS;
}

export interface CardsectionPlayerView {
  stage: CardsectionState['stage'];
  rows: number;
  cols: number;
  mySeat: { row: number; col: number } | null;
  taken: Array<[number, number]>;
  show: ShowParams | null;
  teamRank: number | null;
  teamColor: string | null;
  endAt: number;
}

const SHOW_LEAD_MS = 5_000;

function rankOf(s: CardsectionState, playerId: string): number | null {
  const team = s.teams?.find((t) => t.memberIds.includes(playerId));
  if (!team) return null;
  return s.teamRank[team.id] ?? null;
}

export const cardsection: GameModule<CardsectionState, CardsectionHostView, CardsectionPlayerView> = {
  meta: {
    id: 'cardsection',
    title: '인간 카드섹션',
    tagline: '폰을 들고만 있으면 방 전체가 하나의 화면이 된다',
    rules: [
      '좌석 격자에서 지금 내 자리를 탭해 주세요',
      '화면 밝기를 최대로, 폰을 세로로 머리 위로!',
      '모든 폰이 같은 순간에 색을 바꿔요',
      '마지막엔 모두의 문구가 한 줄로 떠올라요',
    ],
    minPlayers: 1,
    permissions: ['wakelock'],
    usesPack: ['teamNames', 'finaleText'],
    teamMode: 'uses',
    minutes: 3,
  },

  init(ctx) {
    const teams = ctx.teams ? reconcileTeams(ctx) : null;
    const teamRank: Record<string, number> = {};
    if (teams) {
      const ranking =
        [...ctx.history].reverse().find((h) => h.ranking && h.ranking.length > 0)?.ranking ?? [];
      const order = [...ranking.filter((id) => teams.some((t) => t.id === id))];
      for (const t of teams) if (!order.includes(t.id)) order.push(t.id);
      order.forEach((id, i) => {
        teamRank[id] = i;
      });
    }
    return {
      stage: 'intro',
      rows: ctx.settings.seatRows,
      cols: ctx.settings.seatCols,
      seats: {},
      show: null,
      endAt: 0,
      teams,
      teamRank,
    };
  },

  start(s) {
    s.stage = 'seat';
  },

  input(s, ctx, playerId, input) {
    if (inputType(input) !== 'seat') return;
    if (s.stage !== 'seat' && !(s.stage === 'show' && s.show && ctx.now < s.show.startAt)) return;
    const { row, col } = input as { row?: unknown; col?: unknown };
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    const r = row as number;
    const c = col as number;
    if (r < 0 || r >= s.rows || c < 0 || c >= s.cols) return;
    s.seats[playerId] = { row: r, col: c };
  },

  hostAction(s, ctx, action) {
    if (action === 'start-show' && s.stage === 'seat') {
      const teamColors: string[] = [];
      if (s.teams) {
        const sorted = [...s.teams].sort((a, b) => (s.teamRank[a.id] ?? 99) - (s.teamRank[b.id] ?? 99));
        for (const t of sorted) teamColors.push(t.color);
      }
      s.show = {
        startAt: ctx.now + SHOW_LEAD_MS,
        durationMs: ctx.settings.cardsectionMs,
        rows: s.rows,
        cols: s.cols,
        message: ctx.pack.content.finaleText,
        teamColors,
      };
      s.endAt = s.show.startAt + s.show.durationMs;
      s.stage = 'show';
    }
  },

  tick(s, ctx) {
    if (s.stage === 'show' && ctx.now >= s.endAt + 1_500) s.stage = 'done';
  },

  finished(s) {
    return s.stage === 'done';
  },

  hostView(s, ctx) {
    const seats = Object.entries(s.seats)
      .filter(([id]) => ctx.players.some((p) => p.id === id))
      .map(([id, seat]) => {
        const rank = rankOf(s, id);
        const team = s.teams?.find((t) => t.memberIds.includes(id));
        return {
          row: seat.row,
          col: seat.col,
          color: team?.color ?? ctx.players.find((p) => p.id === id)?.color ?? '#ffffff',
          nickname: nicknameOf(ctx, id),
          teamRank: rank,
        };
      });
    return {
      stage: s.stage,
      rows: s.rows,
      cols: s.cols,
      seats,
      seatedCount: seats.length,
      playerCount: connectedPlayers(ctx).length,
      show: s.show,
      endAt: s.endAt,
      segments: SHOW_SEGMENTS,
    };
  },

  playerView(s, ctx, playerId) {
    const team = s.teams?.find((t) => t.memberIds.includes(playerId));
    return {
      stage: s.stage,
      rows: s.rows,
      cols: s.cols,
      mySeat: s.seats[playerId] ?? null,
      taken: Object.entries(s.seats)
        .filter(([id]) => id !== playerId && ctx.players.some((p) => p.id === id))
        .map(([, seat]) => [seat.row, seat.col] as [number, number]),
      show: s.show,
      teamRank: rankOf(s, playerId),
      teamColor: team?.color ?? null,
      endAt: s.endAt,
    };
  },

  summary(s, ctx): GameSummary {
    const seated = Object.keys(s.seats).filter((id) => ctx.players.some((p) => p.id === id)).length;
    const total = Math.max(1, ctx.players.length);
    return {
      gameId: 'cardsection',
      title: '인간 카드섹션',
      headline: `${seated}명의 폰이 하나의 화면이 됐어요`,
      highlights: [
        `${s.rows}×${s.cols} 격자 중 ${seated}칸이 빛났어요`,
        `피날레 문구: ${ctx.pack.content.finaleText}`,
      ],
      metrics: { seated, seatRate: Math.round((seated / total) * 100) },
      ...(s.teams ? { teams: s.teams } : {}),
    };
  },
};
