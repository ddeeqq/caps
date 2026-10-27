import type { Rng } from '../util/rng';
import { josa, JOSA_PAIRS, type JosaPair } from './josa';

/**
 * `{name}`, `{name:이/가}`, `{keyword:을/를}` 형태의 자리를 채운다.
 * 조사가 붙은 자리는 앞 단어의 받침에 맞춰 자동 선택된다.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)(?::([^}]+))?\}/g, (whole, key: string, pair?: string) => {
    const value = vars[key];
    if (value === undefined) return whole;
    if (pair && (JOSA_PAIRS as readonly string[]).includes(pair)) return josa(value, pair as JosaPair);
    return value;
  });
}

/** 서로 다른 두 원소 쌍을 n개 뽑는다 (같은 쌍 반복 없음) */
export function distinctPairs<T>(items: readonly T[], n: number, rng: Rng): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) pairs.push([items[i] as T, items[j] as T]);
  }
  return rng.sample(pairs, n).map(([a, b]) => (rng.next() < 0.5 ? [a, b] : [b, a]));
}
