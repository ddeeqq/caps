import { describe, expect, it } from 'vitest';
import { GAME_META } from '../src/games';
import { GAME_IDS } from '../src/games/types';
import { hostScript } from '../src/hostScript';
import { containsProfanity } from '../src/pack/filter';
import { resolvePack } from '../src/pack/resolve';
import { PACK_STARTERS } from '../src/pack/starters';
import { reportHighlights } from '../src/report';
import { packContentInputSchema } from '../src/schemas';
import type { SessionReport } from '../src/protocol';

describe('팩 템플릿', () => {
  it('4종 모두 입력 규칙을 지키고 금칙어가 없으며, 그대로 팩이 된다', () => {
    expect(PACK_STARTERS).toHaveLength(4);
    for (const st of PACK_STARTERS) {
      const parsed = packContentInputSchema.partial().safeParse(st.content);
      expect(parsed.success, st.id).toBe(true);
      const words = [
        ...st.content.keywords,
        st.content.finaleText,
        ...st.content.penalties,
        ...st.content.balanceQuestions.flatMap((q) => [q.prompt, q.a, q.b]),
      ];
      for (const w of words) expect(containsProfanity(w), w).toBe(false);
      for (const id of st.flow) expect(GAME_IDS).toContain(id);
      const pack = resolvePack({ preset: st.preset, content: st.content });
      // 템플릿 질문이 실제로 게임에 쓰인다
      expect(pack.balancePool[0]?.a).toBe(st.content.balanceQuestions[0]!.a);
      expect(pack.vaultSymbols).toContain(st.content.keywords[0]);
    }
  });
});

describe('진행 멘트 카드', () => {
  it('모든 게임의 소개와 결과에 읽을 말이 있다', () => {
    for (const id of GAME_IDS) {
      const intro = hostScript({ phase: 'intro', gameId: id });
      expect(intro.say.length, `${GAME_META[id].title} 소개`).toBeGreaterThan(0);
      expect(hostScript({ phase: 'result', gameId: id, last: false }).say[0]).toContain('박수');
    }
  });

  it('게임 안 단계마다 다른 말, 모르는 단계는 무난한 기본 말', () => {
    const search = hostScript({ phase: 'playing', gameId: 'soundmate', stage: 'search' });
    const mission = hostScript({ phase: 'playing', gameId: 'soundmate', stage: 'mission' });
    expect(search.say).not.toEqual(mission.say);
    expect(search.tip).toContain('찾기 마감');
    expect(hostScript({ phase: 'playing', gameId: 'vault', stage: '???' }).say.length).toBe(1);
  });

  it('멈췄을 때와 마지막 결과는 따로 안내한다', () => {
    expect(hostScript({ phase: 'playing', gameId: 'nunchi', stage: 'open', paused: true }).tip).toContain(
      '다시 진행',
    );
    expect(hostScript({ phase: 'result', gameId: 'cardsection', last: true }).tip).toContain('마무리하기');
    expect(hostScript({ phase: 'lobby', gameId: null }).say.join(' ')).toContain('QR');
  });
});

describe('리포트 요약 숫자', () => {
  const base = {
    survey: {
      lobby: { count: 4, avg: 2.5 },
      end: { count: 4, avg: 4, newPeople: [1, 2, 1, 0] as [number, number, number, number] },
    },
    metrics: { faceToFace: 7, links: 7, wrongLinks: 1, reactions: 3, vaultSuccessRate: 50 },
    retention: 90,
    peakPlayers: 10,
  } as unknown as SessionReport;

  it('새 사람과 말한 비율과 분위기 변화', () => {
    const h = reportHighlights(base);
    expect(h.newPeopleRate).toBe(75);
    expect(h.comfortDelta).toBe(1.5);
    expect(h.people).toBe(10);
  });

  it('설문이 없으면 비율을 지어내지 않는다', () => {
    const h = reportHighlights({
      ...base,
      survey: { lobby: { count: 0, avg: null }, end: { count: 0, avg: null, newPeople: [0, 0, 0, 0] } },
    });
    expect(h.newPeopleRate).toBeNull();
    expect(h.comfortDelta).toBeNull();
  });
});
