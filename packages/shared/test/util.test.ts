import { describe, expect, it } from 'vitest';
import { randomNickname, uniqueNickname } from '../src/util/nickname';
import { createRng, hashSeed } from '../src/util/rng';
import { splitIntoTeams } from '../src/util/teams';
import { ufAllConnected, ufFind, ufLargestGroup, ufUnion } from '../src/util/unionFind';

describe('난수', () => {
  it('같은 시드면 같은 수열', () => {
    const a = createRng(1);
    const b = createRng(1);
    expect([a.next(), a.next(), a.int(0, 9)]).toEqual([b.next(), b.next(), b.int(0, 9)]);
    expect(hashSeed('ABCD', 1)).toBe(hashSeed('ABCD', 1));
    expect(hashSeed('ABCD', 1)).not.toBe(hashSeed('ABCD', 2));
  });

  it('sample은 서로 다른 원소를 고른다', () => {
    const rng = createRng(9);
    const picked = rng.sample([1, 2, 3, 4, 5], 3);
    expect(new Set(picked).size).toBe(3);
  });
});

describe('팀 나누기', () => {
  it.each([
    [14, [4, 4, 3, 3]],
    [5, [3, 2]],
    [8, [4, 4]],
    [9, [3, 3, 3]],
    [3, [3]],
  ])('%i명 → %j', (n, sizes) => {
    const teams = splitIntoTeams(
      Array.from({ length: n }, (_, i) => i),
      createRng(1),
    );
    expect(teams.map((t) => t.length).sort((a, b) => b - a)).toEqual(sizes);
    expect(teams.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
  });
});

describe('유니온 파인드', () => {
  it('아무 팀원 한 명과만 이어져도 전체가 연결된다', () => {
    const parent: Record<string, string> = {};
    const team = ['a', 'b', 'c', 'd'];
    expect(ufAllConnected(parent, team)).toBe(false);
    ufUnion(parent, 'a', 'b');
    ufUnion(parent, 'c', 'd');
    expect(ufLargestGroup(parent, team)).toBe(2);
    expect(ufUnion(parent, 'b', 'a')).toBe(false);
    ufUnion(parent, 'd', 'a');
    expect(ufAllConnected(parent, team)).toBe(true);
    expect(ufFind(parent, 'c')).toBe(ufFind(parent, 'b'));
  });
});

describe('닉네임', () => {
  it('형용사 + 과일로 만들고 겹치면 번호를 붙인다', () => {
    const name = randomNickname(createRng(3));
    expect(name.split(' ').length).toBeGreaterThanOrEqual(2);
    expect(uniqueNickname('졸린 망고', new Set(['졸린 망고']))).toBe('졸린 망고 2');
    expect(uniqueNickname('졸린 망고', new Set(['졸린 망고', '졸린 망고 2']))).toBe('졸린 망고 3');
  });
});
