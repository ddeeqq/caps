import { describe, expect, it } from 'vitest';
import { containsProfanity, cleanText } from '../src/pack/filter';
import { josa, pickJosa } from '../src/pack/josa';
import { resolvePack } from '../src/pack/resolve';
import { fillTemplate } from '../src/pack/templates';

describe('한글 조사', () => {
  it('받침 유무로 조사를 고른다', () => {
    expect(josa('지훈', '이/가')).toBe('지훈이');
    expect(josa('민수', '이/가')).toBe('민수가');
    expect(josa('단골집', '을/를')).toBe('단골집을');
    expect(josa('제주도', '을/를')).toBe('제주도를');
    expect(josa('마케팅팀', '은/는')).toBe('마케팅팀은');
  });

  it('으로/로는 ㄹ 받침을 따로 처리한다', () => {
    expect(josa('부산', '으로/로')).toBe('부산으로');
    expect(josa('서울', '으로/로')).toBe('서울로');
    expect(josa('바다', '으로/로')).toBe('바다로');
  });

  it('숫자와 영어 이름도 읽는 소리 기준으로 처리한다', () => {
    expect(josa('3', '이/가')).toBe('3이');
    expect(josa('2', '이/가')).toBe('2가');
    expect(josa('1', '으로/로')).toBe('1로');
    expect(josa('Tom', '이/가')).toBe('Tom이');
    expect(josa('Kate', '이/가')).toBe('Kate가');
  });

  it('판단할 수 없으면 병기한다', () => {
    expect(pickJosa('★', '이/가')).toBe('이(가)');
  });

  it('템플릿 자리에 조사를 자동으로 붙인다', () => {
    expect(fillTemplate('{name:이/가} 더 좋아할 것 같은 쪽은?', { name: '수빈' })).toBe(
      '수빈이 더 좋아할 것 같은 쪽은?',
    );
    expect(fillTemplate('{name:이/가} 고른 {thing}', { name: '하나', thing: '바다' })).toBe(
      '하나가 고른 바다',
    );
    expect(fillTemplate('{missing} 그대로', {})).toBe('{missing} 그대로');
  });
});

describe('팩 엔진', () => {
  it('친구 프리셋은 이름으로 비교·취향 질문을 만들고 커스텀 질문을 맨 앞에 둔다', () => {
    const pack = resolvePack({
      preset: 'friends',
      content: {
        names: ['지훈', '민수', '수빈'],
        keywords: ['단골집', '제주도', '노래방'],
        balanceQuestions: [{ prompt: '오늘 저녁은?', a: '삼겹살', b: '회' }],
      },
    });
    expect(pack.balancePool[0]).toEqual({ prompt: '오늘 저녁은?', a: '삼겹살', b: '회' });
    const withNames = pack.balancePool.filter((q) =>
      ['지훈', '민수', '수빈'].some((n) => `${q.prompt}${q.a}${q.b}`.includes(n)),
    );
    expect(withNames.length).toBeGreaterThan(0);
    expect(pack.vaultSymbols).toEqual(
      expect.arrayContaining(['지훈', '민수', '수빈', '단골집', '제주도', '노래방']),
    );
    expect(pack.vaultSymbols.length).toBeGreaterThanOrEqual(12);
  });

  it('직장 프리셋은 질문에 이름을 쓰지 않고 금고 기호에만 쓴다', () => {
    const pack = resolvePack({
      preset: 'work',
      content: { names: ['김 팀장', '박 대리'], keywords: ['프로젝트A', '스프린트'] },
    });
    expect(pack.options.personCompare).toBe(false);
    const leaks = pack.balancePool.filter(
      (q) => `${q.prompt}${q.a}${q.b}`.includes('팀장') || `${q.prompt}${q.a}${q.b}`.includes('대리'),
    );
    expect(leaks).toHaveLength(0);
    expect(pack.vaultSymbols).toEqual(expect.arrayContaining(['김 팀장', '박 대리', '프로젝트A']));
  });

  it('수업 프리셋은 이름을 아무 데도 쓰지 않는다', () => {
    const pack = resolvePack({ preset: 'class', content: { names: ['홍길동'] } });
    expect(pack.vaultSymbols).not.toContain('홍길동');
  });

  it('비어 있으면 프리셋 기본값으로 채운다', () => {
    const pack = resolvePack({ preset: 'friends' });
    expect(pack.content.finaleText).toBe('우리 우정 영원히');
    expect(pack.content.penalties.length).toBeGreaterThan(0);
    expect(pack.balancePool.length).toBeGreaterThan(10);
    expect(new Set(pack.balancePool.map((q) => `${q.prompt}${q.a}${q.b}`)).size).toBe(
      pack.balancePool.length,
    );
  });

  it('같은 시드면 같은 결과', () => {
    const input = {
      preset: 'friends' as const,
      content: { names: ['a', 'b', 'c'], keywords: ['x', 'y', 'z'] },
    };
    expect(resolvePack(input, 3)).toEqual(resolvePack(input, 3));
  });
});

describe('금칙어 필터', () => {
  it('띄어쓰기·기호로 우회해도 잡는다', () => {
    expect(containsProfanity('시 발')).toBe(true);
    expect(containsProfanity('F.U.C.K')).toBe(true);
    expect(containsProfanity('졸린 망고')).toBe(false);
  });

  it('공백을 정리하고 길이를 자른다', () => {
    expect(cleanText('  안녕   하세요  ', 20)).toBe('안녕 하세요');
    expect(cleanText('가나다라마바사', 3)).toBe('가나다');
  });
});
