/**
 * 시간 동기화 수학 (NTP 방식).
 *
 * 폰이 핑을 보낸 시각 t0, 서버가 받은 시각 ts, 폰이 응답을 받은 시각 t1로
 *   오프셋 θ = ts − (t0 + t1) / 2,  왕복 시간 δ = t1 − t0
 * 를 구한다. 가는 시간과 오는 시간이 같다고 가정하므로 δ가 짧은 측정일수록 정확하다.
 * 그래서 여러 번 재서 δ가 가장 짧은 몇 개의 θ 중앙값을 쓴다.
 */
export interface ClockSample {
  /** 폰이 보낸 시각 (폰의 단조 시계, performance.now) */
  t0: number;
  /** 서버가 받은 시각 (서버 시계) */
  ts: number;
  /** 폰이 응답을 받은 시각 (폰의 단조 시계) */
  t1: number;
}

export interface ClockEstimate {
  /** 서버 시각 = 폰 시각 + offset */
  offset: number;
  /** 채택한 측정 중 가장 짧은 왕복 시간 (ms) */
  rtt: number;
  /** 채택한 측정들의 오프셋 퍼짐 (max − min, ms) — 동기화 품질 지표 */
  spread: number;
  /** 추정에 쓴 전체 측정 수 */
  samples: number;
}

export function sampleOffset(s: ClockSample): { offset: number; rtt: number } {
  return { offset: s.ts - (s.t0 + s.t1) / 2, rtt: s.t1 - s.t0 };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * δ가 가장 짧은 best개의 θ 중앙값으로 오프셋을 추정한다.
 * 비정상 측정(음수 왕복, 숫자가 아닌 값)은 버린다.
 */
export function estimateOffset(samples: readonly ClockSample[], best = 3): ClockEstimate | null {
  const valid = samples
    .filter((s) => Number.isFinite(s.t0) && Number.isFinite(s.ts) && Number.isFinite(s.t1) && s.t1 >= s.t0)
    .map(sampleOffset)
    .sort((a, b) => a.rtt - b.rtt);
  if (valid.length === 0) return null;
  const chosen = valid.slice(0, Math.max(1, best));
  const offsets = chosen.map((c) => c.offset);
  return {
    offset: median(offsets),
    rtt: (chosen[0] as { rtt: number }).rtt,
    spread: Math.max(...offsets) - Math.min(...offsets),
    samples: valid.length,
  };
}

/**
 * 클라이언트가 보낸 "서버 기준 탭 시각"을 검증한다.
 * 수신 시각보다 미래이거나 너무 과거면 조작·오류로 보고 수신 시각을 쓴다.
 */
export function sanitizeClientTime(
  clientTime: unknown,
  receivedAt: number,
  { maxFutureMs = 50, maxPastMs = 1000 } = {},
): number {
  if (typeof clientTime !== 'number' || !Number.isFinite(clientTime)) return receivedAt;
  if (clientTime > receivedAt + maxFutureMs) return receivedAt;
  if (clientTime < receivedAt - maxPastMs) return receivedAt;
  return Math.min(clientTime, receivedAt);
}
