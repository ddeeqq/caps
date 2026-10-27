/**
 * 동시 접속 부하 테스트: 봇 N명이 실제 게임을 하는 동안 지연을 잰다.
 *
 *   pnpm load --count 100 --seconds 60
 *
 * 측정: 입장 시간, 핑 왕복 시간(p50/p95/최대), 봇당 초당 수신 메시지, 서버 틱 처리 시간.
 */
import type { GameId } from '@caps/shared';
import { arg, percentile } from './args';
import { AutoHost, Bot, BotHub, sleep } from './bot';

const url = arg('url', 'http://localhost:3001');
const count = Number(arg('count', '100'));
const seconds = Number(arg('seconds', '60'));
const flow = arg('flow', 'nunchi,tiltrace,minority').split(',') as GameId[];

async function main() {
  console.log(`부하 테스트: ${url} · 봇 ${count}명 · ${seconds}초 · ${flow.join(' → ')}`);
  const host = new AutoHost({
    url,
    create: { preset: 'friends', flow, settings: { nunchiRounds: 10, minorityRounds: 5, tiltraceLength: 30 } },
    waitForPlayers: count,
    introMs: 1_500,
    resultMs: 2_000,
  });
  const { code } = await host.create();
  host.run();

  const hub = new BotHub();
  const bots: Bot[] = [];
  const joinTimes: number[] = [];
  const batch = 20;
  for (let i = 0; i < count; i += batch) {
    const group = Array.from({ length: Math.min(batch, count - i) }, () => new Bot({ url, code, hub, chatty: true }));
    const times = await Promise.all(group.map((b) => b.join()));
    joinTimes.push(...times);
    bots.push(...group);
  }
  console.log(`입장 완료: p50 ${percentile(joinTimes, 50).toFixed(0)}ms, p95 ${percentile(joinTimes, 95).toFixed(0)}ms`);

  const rtts: number[] = [];
  const ticks: number[] = [];
  const startReceived = bots.reduce((a, b) => a + b.received, 0);
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    await sleep(2_000);
    const samples = await Promise.all(bots.map((b) => b.clock.ping()));
    for (const s of samples) rtts.push(s.t1 - s.t0);
    try {
      const health = (await (await fetch(`${url}/api/health`)).json()) as { tickMs: number };
      ticks.push(health.tickMs);
    } catch {
      /* 서버 응답 없음은 아래 결과에 드러난다 */
    }
    process.stdout.write('.');
  }
  const elapsed = (Date.now() - started) / 1000;
  const received = bots.reduce((a, b) => a + b.received, 0) - startReceived;

  console.log('\n\n── 결과 ──');
  console.log(`핑 왕복: p50 ${percentile(rtts, 50).toFixed(1)}ms · p95 ${percentile(rtts, 95).toFixed(1)}ms · 최대 ${Math.max(...rtts).toFixed(1)}ms (${rtts.length}회)`);
  console.log(`수신 메시지: 봇당 초당 ${(received / bots.length / elapsed).toFixed(1)}개 (전체 ${(received / elapsed).toFixed(0)}개/초)`);
  if (ticks.length) {
    console.log(`서버 틱 처리: 평균 ${(ticks.reduce((a, b) => a + b, 0) / ticks.length).toFixed(2)}ms · 최대 ${Math.max(...ticks).toFixed(2)}ms (틱 간격 50ms)`);
  }
  console.log(`진행 단계: ${host.room?.phase} ${host.room?.gameId ?? ''}`);
  for (const b of bots) b.stop();
  host.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
