/**
 * 시계 동기화 시뮬레이터. 실제 망 없이 추정 방식의 정확도를 비교한다 (테스트, `pnpm clock-sim`).
 *
 * 망 모델 (와이파이를 거칠게 흉내): 편도 지연 = 기본 4~12ms + 지수분포 지터(평균 15ms),
 * 5% 확률로 120ms 지연 폭증. 가는 길과 오는 길을 따로 뽑으므로 경로가 비대칭이다.
 */
import { estimateOffset, type ClockSample } from './clock';
import { createRng } from './util/rng';

export interface ClockSimOptions {
  trials?: number;
  pings?: number;
  best?: number;
  seed?: number;
  /** 지터 평균 (ms) */
  jitterMs?: number;
  /** 지연 폭증 확률 */
  spikeRate?: number;
}

export interface ClockSimResult {
  /** 이 프로젝트 방식: 왕복이 짧은 best개의 중앙값 */
  bestMedian: number[];
  /** 모든 측정의 단순 평균 */
  mean: number[];
  /** 핑 한 번 */
  single: number[];
}

export function simulateClockSync(opts: ClockSimOptions = {}): ClockSimResult {
  const { trials = 1000, pings = 10, best = 3, seed = 1, jitterMs = 15, spikeRate = 0.05 } = opts;
  const rng = createRng(seed);
  const exp = (mean: number) => -Math.log(1 - rng.next()) * mean;
  const oneWay = () => 4 + rng.next() * 8 + exp(jitterMs) + (rng.next() < spikeRate ? 120 : 0);
  const out: ClockSimResult = { bestMedian: [], mean: [], single: [] };

  for (let k = 0; k < trials; k++) {
    const trueOffset = (rng.next() - 0.5) * 1e6; // 폰과 서버 시계는 아무리 달라도 된다
    const samples: ClockSample[] = [];
    let t = 1_000;
    for (let i = 0; i < pings; i++) {
      const up = oneWay();
      const down = oneWay();
      samples.push({ t0: t, ts: t + up + trueOffset, t1: t + up + down });
      t += up + down + 100; // 설계대로 100ms 간격으로 연달아 잰다
    }
    const est = estimateOffset(samples, best);
    const offsets = samples.map((s) => s.ts - (s.t0 + s.t1) / 2);
    out.bestMedian.push(Math.abs((est?.offset ?? 0) - trueOffset));
    out.mean.push(Math.abs(offsets.reduce((a, b) => a + b, 0) / offsets.length - trueOffset));
    out.single.push(Math.abs((offsets[0] ?? 0) - trueOffset));
  }
  return out;
}

export function percentileOf(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}
