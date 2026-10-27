import { describe, expect, it } from 'vitest';
import { applyRule, assignRoles, generatePuzzle, vault, VAULT_LEVELS } from '../src/games/vault';
import { createRng } from '../src/util/rng';
import { makeCtx } from './helpers';

describe('금고 퍼즐', () => {
  it('같은 시드면 같은 퍼즐, 정답은 변환표와 규칙에서 나온다', () => {
    const symbols = ['지훈', '민수', '수빈', '단골집', '제주도', '노래방', '여행', '별명'];
    const a = generatePuzzle(symbols, 2, createRng(5));
    const b = generatePuzzle(symbols, 2, createRng(5));
    expect(a).toEqual(b);
    expect(a.seq).toHaveLength(VAULT_LEVELS[2]!.seq);
    expect(a.table).toHaveLength(VAULT_LEVELS[2]!.seq + VAULT_LEVELS[2]!.decoys);
    expect(a.rule).not.toBeNull();
    const raw = a.seq.map((sym) => a.table.find((e) => e.symbol === sym)!.digit);
    expect(a.raw).toEqual(raw);
    expect(a.answer).toBe(applyRule(raw, a.rule).join(''));
    expect(a.checksum).toBe(a.answer.split('').reduce((x, d) => x + Number(d), 0));
  });

  it('기호가 모자라면 기본 기호로 채운다', () => {
    const p = generatePuzzle(['하나'], 1, createRng(1));
    expect(new Set(p.table.map((e) => e.symbol)).size).toBe(8);
  });

  it('규칙 적용', () => {
    expect(applyRule([1, 2, 3, 9], { kind: 'plus', pos: 3, text: '' })).toEqual([1, 2, 3, 0]);
    expect(applyRule([1, 2, 3, 4], { kind: 'nineMinus', pos: 3, text: '' })).toEqual([1, 2, 3, 5]);
    expect(applyRule([1, 2, 3, 4], { kind: 'swap', text: '' })).toEqual([2, 1, 3, 4]);
    expect(applyRule([1, 2, 3, 4], { kind: 'reverse', text: '' })).toEqual([4, 3, 2, 1]);
    expect(applyRule([1, 2], null)).toEqual([1, 2]);
  });

  it('인원별 역할 분배와 금고마다 역할 회전', () => {
    expect(assignRoles(['a', 'b', 'c', 'd'], false, 0)).toEqual({
      a: ['order'],
      b: ['decode'],
      c: ['input'],
      d: ['checksum'],
    });
    expect(assignRoles(['a', 'b', 'c', 'd'], true, 1)).toEqual({
      b: ['order'],
      c: ['decode'],
      d: ['input'],
      a: ['rule'],
    });
    expect(assignRoles(['a', 'b', 'c'], true, 0)).toEqual({ a: ['order'], b: ['decode'], c: ['input', 'rule'] });
    expect(assignRoles(['a', 'b'], false, 0)).toEqual({ a: ['order', 'decode'], b: ['input'] });
    expect(assignRoles(['a'], true, 0)).toEqual({ a: ['order', 'decode', 'input', 'rule'] });
  });
});

describe('금고 게임 흐름', () => {
  it('틀리면 잠기고, 맞히면 다음 금고, 다 끝나면 순위', () => {
    const ctx = makeCtx({ players: 6, settings: { vaultSafes: 2 } });
    const s = vault.init(ctx);
    expect(s.teams).toHaveLength(2);
    vault.start(s, ctx);
    const team = s.teams[0]!;
    const ts = s.perTeam[team.id]!;
    expect(ts.status).toBe('active');
    const inputter = Object.entries(ts.roles).find(([, r]) => r.includes('input'))![0];
    const orderer = Object.entries(ts.roles).find(([, r]) => r.includes('order'))![0];

    // 역할별 정보만 보인다
    expect(vault.playerView(s, ctx, orderer).order).toEqual(ts.puzzle.seq);
    expect(vault.playerView(s, ctx, orderer).table).toBeNull();
    expect(vault.playerView(s, ctx, inputter).order).toBeNull();

    // 입력 담당이 아니면 무시
    vault.input(s, ctx, orderer, { type: 'submit', code: ts.puzzle.answer }, ctx.now);
    expect(ts.status).toBe('active');

    vault.input(s, ctx, inputter, { type: 'submit', code: '000' === ts.puzzle.answer ? '111' : '000' }, ctx.now);
    expect(ts.lockedUntil).toBeGreaterThan(ctx.now);
    vault.input(s, ctx, inputter, { type: 'submit', code: ts.puzzle.answer }, ctx.now);
    expect(ts.status).toBe('active'); // 잠김 동안은 무시

    ctx.advance(3_000);
    vault.input(s, ctx, inputter, { type: 'submit', code: ts.puzzle.answer }, ctx.now);
    expect(ts.status).toBe('solved');
    expect(vault.playerView(s, ctx, orderer).reveal).toBe(ts.puzzle.answer);

    ctx.advance(3_000);
    vault.tick(s, ctx);
    const next = s.perTeam[team.id]!;
    expect(next.safeIndex).toBe(1);
    expect(next.status).toBe('active');

    // 나머지는 시간 초과로 실패시키며 끝까지
    for (let i = 0; i < 20 && s.stage !== 'done'; i++) {
      ctx.advance(80_000);
      vault.tick(s, ctx);
    }
    expect(vault.finished(s, ctx)).toBe(true);
    const summary = vault.summary(s, ctx);
    expect(summary.ranking?.[0]).toBe(team.id);
    expect(summary.metrics.solved).toBe(1);
    expect(summary.metrics.safes).toBe(4);
  });

  it('입력 담당이 나가면 남은 팀원에게 역할이 넘어간다', () => {
    const ctx = makeCtx({ players: 6 });
    const s = vault.init(ctx);
    vault.start(s, ctx);
    const ts = s.perTeam[s.teams[0]!.id]!;
    const inputter = Object.entries(ts.roles).find(([, r]) => r.includes('input'))![0];
    ctx.players.find((p) => p.id === inputter)!.connected = false;
    vault.tick(s, ctx);
    const holders = Object.entries(ts.roles).filter(([, r]) => r.includes('input'));
    expect(holders).toHaveLength(1);
    expect(holders[0]![0]).not.toBe(inputter);
  });
});
