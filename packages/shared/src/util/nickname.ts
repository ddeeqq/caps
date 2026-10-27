import type { Rng } from './rng';

const ADJECTIVES = [
  '졸린',
  '배고픈',
  '신난',
  '수줍은',
  '용감한',
  '느긋한',
  '엉뚱한',
  '반짝이는',
  '씩씩한',
  '행복한',
  '수상한',
  '똑똑한',
  '말랑한',
  '바쁜',
  '조용한',
  '다정한',
  '날쌘',
  '귀여운',
  '든든한',
  '상큼한',
  '호기심 많은',
  '떨리는',
  '당당한',
  '꼼꼼한',
] as const;

// 동물은 소리 짝꿍과 헷갈리지 않도록 닉네임에 쓰지 않는다.
const FRUITS = [
  '망고',
  '사과',
  '바나나',
  '포도',
  '복숭아',
  '자두',
  '키위',
  '레몬',
  '체리',
  '수박',
  '참외',
  '딸기',
  '귤',
  '홍시',
  '멜론',
  '블루베리',
  '라임',
  '석류',
  '파인애플',
  '무화과',
] as const;

export function randomNickname(rng: Rng): string {
  return `${rng.pick(ADJECTIVES)} ${rng.pick(FRUITS)}`;
}

/** 방 안에서 겹치지 않게 만든다: "졸린 망고" → "졸린 망고 2" */
export function uniqueNickname(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now() % 10000}`;
}
