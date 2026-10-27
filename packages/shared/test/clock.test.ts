import { describe, expect, it } from 'vitest';
import { estimateOffset, sampleOffset, sanitizeClientTime } from '../src/clock';
import { percentileOf, simulateClockSync } from '../src/clockSim';

describe('시계 오차 추정', () => {
  it('대칭 경로면 오프셋을 정확히 구한다', () => {
    // 폰 시계가 서버보다 500ms 느림, 편도 20ms
    const { offset, rtt } = sampleOffset({ t0: 1000, ts: 1520, t1: 1040 });
    expect(offset).toBe(500);
    expect(rtt).toBe(40);
  });

  it('왕복 시간이 짧은 측정만 골라 중앙값을 쓴다', () => {
    const trueOffset = 250;
    const samples = [
      // 깨끗한 측정 (왕복 20ms)
      { t0: 0, ts: 10 + trueOffset, t1: 20 },
      { t0: 100, ts: 110 + trueOffset, t1: 120 },
      { t0: 200, ts: 211 + trueOffset, t1: 222 },
      // 비대칭으로 크게 늦은 측정 (왕복 400ms) — 버려져야 한다
      { t0: 300, ts: 650 + trueOffset, t1: 700 },
      { t0: 800, ts: 1150 + trueOffset, t1: 1200 },
    ];
    const est = estimateOffset(samples, 3);
    expect(est).not.toBeNull();
    expect(Math.abs((est?.offset ?? 0) - trueOffset)).toBeLessThanOrEqual(1);
    expect(est?.rtt).toBe(20);
    expect(est?.samples).toBe(5);
  });

  it('지터와 지연 폭증이 있는 망에서도 오차 p95가 10ms 미만 (눈치게임 충돌 창 300ms의 3% 남짓)', () => {
    const r = simulateClockSync({ trials: 1000, pings: 10, best: 3, seed: 42 });
    const p95 = percentileOf(r.bestMedian, 95);
    expect(p95).toBeLessThan(10);
    // 핑 한 번이나 단순 평균보다 확실히 낫다
    expect(p95).toBeLessThan(percentileOf(r.mean, 95));
    expect(p95 * 4).toBeLessThan(percentileOf(r.single, 95));
  });

  it('비정상 측정은 무시한다', () => {
    expect(estimateOffset([{ t0: 10, ts: 5, t1: 5 }])).toBeNull();
    expect(estimateOffset([])).toBeNull();
  });

  it('클라이언트 시각은 수신 시각 기준 허용 범위 안에서만 믿는다', () => {
    expect(sanitizeClientTime(990, 1000)).toBe(990);
    expect(sanitizeClientTime(1200, 1000)).toBe(1000); // 미래
    expect(sanitizeClientTime(-5000, 1000)).toBe(1000); // 너무 과거
    expect(sanitizeClientTime('x', 1000)).toBe(1000);
    expect(sanitizeClientTime(1030, 1000)).toBe(1000); // 살짝 미래는 수신 시각으로 자름
  });
});
