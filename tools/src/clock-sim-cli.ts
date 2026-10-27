/**
 * 시계 동기화 정확도 시뮬레이션. 추정 방식별 오차를 비교한다 (발표 자료용 표).
 *
 *   pnpm clock-sim                       # 기본: 핑 10회, 2000번 반복
 *   pnpm clock-sim --jitter 40 --spike 0.15   # 더 나쁜 망
 */
import { percentileOf, simulateClockSync } from '@caps/shared';
import { arg } from './args';

const trials = Number(arg('trials', '2000'));
const pings = Number(arg('pings', '10'));
const jitterMs = Number(arg('jitter', '15'));
const spikeRate = Number(arg('spike', '0.05'));

const r = simulateClockSync({ trials, pings, best: 3, jitterMs, spikeRate, seed: 7 });
// 한글은 터미널에서 두 칸을 차지하므로 폭을 직접 계산해 맞춘다
const width = (s: string) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? 2 : 1), 0);
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));
const row = (label: string, xs: number[]) =>
  `${pad(label, 30)} p50 ${percentileOf(xs, 50).toFixed(1).padStart(6)}ms   p95 ${percentileOf(xs, 95).toFixed(1).padStart(6)}ms   최대 ${Math.max(
    ...xs,
  )
    .toFixed(1)
    .padStart(6)}ms`;

console.log(
  `망 모델: 편도 4~12ms + 지터(평균 ${jitterMs}ms) + ${(spikeRate * 100).toFixed(0)}% 확률 120ms 폭증 · 핑 ${pings}회 · ${trials}번 반복\n`,
);
console.log(row('핑 한 번', r.single));
console.log(row('전체 단순 평균', r.mean));
console.log(row('왕복 짧은 3개 중앙값 (채택)', r.bestMedian));
console.log('\n눈치게임 충돌 창은 300ms. 오차가 그보다 충분히 작으면 "누른 순간" 판정이 공정하다.');
