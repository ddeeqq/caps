/**
 * 한글 조사 자동 처리: 앞 글자의 받침 유무로 이/가, 을/를, 은/는 … 을 고른다.
 * 템플릿에서는 `{name:이/가}`처럼 쓴다.
 */
export type JosaPair = '이/가' | '을/를' | '은/는' | '과/와' | '으로/로' | '아/야' | '이랑/랑' | '이에요/예요';

export const JOSA_PAIRS: readonly JosaPair[] = [
  '이/가',
  '을/를',
  '은/는',
  '과/와',
  '으로/로',
  '아/야',
  '이랑/랑',
  '이에요/예요',
];

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const RIEUL_JONG = 8; // ㄹ 받침 인덱스

// 숫자 읽기 기준 받침: 영(ㅇ) 일(ㄹ) 삼(ㅁ) 육(ㄱ) 칠(ㄹ) 팔(ㄹ)
const DIGIT_BATCHIM: Record<string, { has: boolean; rieul: boolean }> = {
  '0': { has: true, rieul: false },
  '1': { has: true, rieul: true },
  '2': { has: false, rieul: false },
  '3': { has: true, rieul: false },
  '4': { has: false, rieul: false },
  '5': { has: false, rieul: false },
  '6': { has: true, rieul: false },
  '7': { has: true, rieul: true },
  '8': { has: true, rieul: true },
  '9': { has: false, rieul: false },
};

function lastMeaningfulChar(word: string): string | null {
  const trimmed = word.replace(/[\s)\]}"'.,!?~…]+$/u, '');
  if (!trimmed) return null;
  const chars = Array.from(trimmed);
  return chars[chars.length - 1] ?? null;
}

/** 받침 정보. 판단할 수 없으면 null. */
export function batchimInfo(word: string): { has: boolean; rieul: boolean } | null {
  const ch = lastMeaningfulChar(word);
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= HANGUL_START && code <= HANGUL_END) {
    const jong = (code - HANGUL_START) % 28;
    return { has: jong !== 0, rieul: jong === RIEUL_JONG };
  }
  if (ch in DIGIT_BATCHIM) return DIGIT_BATCHIM[ch] as { has: boolean; rieul: boolean };
  const lower = ch.toLowerCase();
  if (/[a-z]/.test(lower)) {
    // 영어 이름의 대표적인 끝소리만 처리: Tom이, Bill이, Ken이
    if (lower === 'l') return { has: true, rieul: true };
    if (lower === 'm' || lower === 'n') return { has: true, rieul: false };
    if (lower === 'g' && /ng$/i.test(word.trim())) return { has: true, rieul: false };
    return { has: false, rieul: false };
  }
  return null;
}

/** 단어에 맞는 조사만 돌려준다. 판단 불가면 "이(가)" 형태. */
export function pickJosa(word: string, pair: JosaPair): string {
  const [withBatchim, withoutBatchim] = pair.split('/') as [string, string];
  const info = batchimInfo(word);
  if (!info) return `${withBatchim}(${withoutBatchim})`;
  if (pair === '으로/로') return info.has && !info.rieul ? withBatchim : withoutBatchim;
  return info.has ? withBatchim : withoutBatchim;
}

/** 단어 + 조사 */
export function josa(word: string, pair: JosaPair): string {
  return `${word}${pickJosa(word, pair)}`;
}
