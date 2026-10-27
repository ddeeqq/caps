import { describe, expect, it } from 'vitest';
import { cardsection, mixColor, showFrame, type ShowParams } from '../src/games/cardsection';
import { makeCtx } from './helpers';

const params: ShowParams = {
  startAt: 0,
  durationMs: 40_000,
  rows: 4,
  cols: 8,
  message: '수고',
  teamColors: ['#ff0000', '#00ff00'],
};

describe('카드섹션 프레임 함수', () => {
  it('카운트다운 3, 2, 1', () => {
    expect(showFrame(params, { row: 0, col: 0, teamRank: null }, 500).text).toBe('3');
    expect(showFrame(params, { row: 0, col: 0, teamRank: null }, 1500).text).toBe('2');
    expect(showFrame(params, { row: 0, col: 0, teamRank: null }, 2500).text).toBe('1');
    expect(showFrame(params, { row: 0, col: 0, teamRank: null }, 2010).bg).toBe('#ffffff'); // 초마다 플래시
  });

  it('문구는 열마다 한 글자씩, 가운데 정렬', () => {
    const at = 22_000;
    expect(showFrame(params, { row: 0, col: 3, teamRank: null }, at).text).toBe('수');
    expect(showFrame(params, { row: 2, col: 4, teamRank: null }, at).text).toBe('고');
    expect(showFrame(params, { row: 0, col: 0, teamRank: null }, at).text).toBe('');
    expect(showFrame(params, { row: null, col: null, teamRank: null }, at)).toMatchObject({ text: '수고', small: true });
  });

  it('긴 문구는 오른쪽에서 흘러 들어온다', () => {
    const long = { ...params, message: '오늘 정말 수고 많으셨습니다' };
    const early = showFrame(long, { row: 0, col: 7, teamRank: null }, 21_000 + 700 * 1).text;
    expect(early).toBe('오');
  });

  it('팀 색은 순위대로 켜진다', () => {
    const first = showFrame(params, { row: 0, col: 0, teamRank: 0 }, 11_500);
    const second = showFrame(params, { row: 0, col: 0, teamRank: 1 }, 11_500);
    expect(second.bg).toBe('#0b0b10');
    expect(first.bg).not.toBe('#0b0b10');
  });

  it('마지막엔 모두 동시에 꺼진다, 길이를 줄이면 시간도 비례', () => {
    expect(showFrame(params, { row: 1, col: 1, teamRank: 0 }, 39_800).bg).toBe('#000000');
    const fast = { ...params, durationMs: 4_000 };
    expect(showFrame(fast, { row: 0, col: 0, teamRank: null }, 50).text).toBe('3');
    expect(showFrame(fast, { row: 0, col: 0, teamRank: null }, 3_990).bg).toBe('#000000');
  });

  it('같은 입력이면 같은 프레임 (모든 폰이 같은 결과)', () => {
    const cell = { row: 2, col: 5, teamRank: 1 };
    for (const t of [100, 5_000, 15_000, 25_000, 35_000]) {
      expect(showFrame(params, cell, t)).toEqual(showFrame(params, cell, t));
    }
  });

  it('색 섞기', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });
});

describe('카드섹션 게임', () => {
  it('자리 등록 → 연출 시작 → 종료', () => {
    const teams = [
      { id: 't1', name: '1팀', color: '#ff0000', memberIds: ['p1', 'p2'] },
      { id: 't2', name: '2팀', color: '#00ff00', memberIds: ['p3', 'p4'] },
    ];
    const ctx = makeCtx({
      players: 4,
      teams,
      settings: { seatRows: 2, seatCols: 4, cardsectionMs: 8_000 },
      history: [{ gameId: 'vault', title: '', headline: '', highlights: [], metrics: {}, ranking: ['t2', 't1'] }],
    });
    const s = cardsection.init(ctx);
    expect(s.teamRank).toEqual({ t2: 0, t1: 1 });
    cardsection.start(s, ctx);
    cardsection.input(s, ctx, 'p1', { type: 'seat', row: 0, col: 1 }, ctx.now);
    cardsection.input(s, ctx, 'p2', { type: 'seat', row: 9, col: 9 }, ctx.now); // 범위 밖
    expect(Object.keys(s.seats)).toEqual(['p1']);
    cardsection.hostAction?.(s, ctx, 'start-show');
    expect(s.stage).toBe('show');
    expect(s.show?.teamColors).toEqual(['#00ff00', '#ff0000']);
    expect(cardsection.playerView(s, ctx, 'p1').teamRank).toBe(1);
    ctx.now = s.endAt + 1_501;
    cardsection.tick(s, ctx);
    expect(cardsection.finished(s, ctx)).toBe(true);
    expect(cardsection.summary(s, ctx).metrics.seated).toBe(1);
  });
});
