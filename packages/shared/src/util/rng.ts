/**
 * 시드 기반 난수 생성기 (mulberry32).
 * 같은 시드면 같은 퍼즐·팀 배정이 나오므로 재접속 복구와 버그 재현이 쉽다.
 */
export interface Rng {
  /** [0, 1) 실수 */
  next(): number;
  /** [min, max] 정수 (양 끝 포함) */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** 서로 다른 n개를 무작위로 고른다 */
  sample<T>(items: readonly T[], n: number): T[];
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = tmp;
    }
    return copy;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() on empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle,
    sample: <T>(items: readonly T[], n: number): T[] => shuffle(items).slice(0, Math.max(0, n)),
  };
}

/** 문자열·숫자들로 32비트 시드를 만든다 (FNV-1a). */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
