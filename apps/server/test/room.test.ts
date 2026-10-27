import type { NunchiHostView, NunchiPlayerView, RoomState, ViewEnvelope } from '@caps/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, call, connect, nextEvent, sleep, startTestServer, type TestServer, type TestSocket } from './helpers';

let t: TestServer;
const sockets: TestSocket[] = [];
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await t.close();
});

interface Tracked {
  socket: TestSocket;
  room: RoomState | null;
  view: ViewEnvelope | null;
}

/** 소켓을 열고 마지막으로 받은 room / view 상태를 계속 기억한다 */
async function open(): Promise<Tracked> {
  const socket = await connect(t.url);
  sockets.push(socket);
  const tracked: Tracked = { socket, room: null, view: null };
  socket.on('room', (r) => {
    tracked.room = r;
  });
  socket.on('view', (v) => {
    tracked.view = v;
  });
  return tracked;
}

async function until(pred: () => boolean, timeoutMs = 5_000, label = '조건'): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(`${label}을(를) 기다리다 시간 초과`);
}

type Flow = Array<'nunchi' | 'soundmate' | 'vault' | 'cardsection' | 'minority' | 'tiltrace'>;

async function createRoom(flow: Flow = ['nunchi']) {
  const host = await open();
  const res = await call(host.socket, 'host:create', { preset: 'work', flow, settings: { nunchiRounds: 1 } });
  if (!res.ok) throw new Error(res.message);
  return { host, ...res };
}

describe('방과 참가자', () => {
  it('시계 핑은 서버 시각을 돌려준다', async () => {
    const { socket } = await open();
    const before = Date.now();
    const ts = await new Promise<number>((r) => socket.emit('clock:ping', performance.now(), r));
    expect(Math.abs(ts - before)).toBeLessThan(2_000);
  });

  it('입장 → 대기실 상태 수신, 같은 토큰으로 다시 들어오면 같은 사람', async () => {
    const { host, code } = await createRoom();
    const p = await open();
    const joined = await call(p.socket, 'player:join', { code: code.toLowerCase(), nickname: '테스트 망고' });
    if (!joined.ok) throw new Error(joined.message);
    expect(joined.nickname).toBe('테스트 망고');
    await until(() => p.room?.you?.id === joined.playerId, 5_000, '참가자 상태');
    expect(p.room?.phase).toBe('lobby');
    expect(p.room?.players).toBeNull(); // 참가자에게는 명단을 보내지 않는다
    await until(() => host.room?.players?.length === 1, 5_000, '진행자 명단');
    expect(host.room?.players?.[0]?.nickname).toBe('테스트 망고');

    p.socket.disconnect();
    await until(() => host.room?.players?.[0]?.connected === false, 5_000, '연결 끊김 표시');
    const again = await open();
    const rejoined = await call(again.socket, 'player:join', { code, token: joined.token });
    expect(rejoined.ok && rejoined.playerId).toBe(joined.playerId);
    await until(() => host.room?.players?.[0]?.connected === true, 5_000, '재접속 표시');
    expect(host.room?.players).toHaveLength(1);
  });

  it('닉네임 중복은 번호를 붙이고, 금칙어는 거절한다', async () => {
    const { code } = await createRoom();
    const a = await call((await open()).socket, 'player:join', { code, nickname: '같은 이름' });
    const b = await call((await open()).socket, 'player:join', { code, nickname: '같은 이름' });
    expect(a.ok && a.nickname).toBe('같은 이름');
    expect(b.ok && b.nickname).toBe('같은 이름 2');
    const bad = await call((await open()).socket, 'player:join', { code, nickname: '씨발' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('NICKNAME_BLOCKED');
    const auto = await call((await open()).socket, 'player:join', { code });
    expect(auto.ok && auto.nickname.length).toBeGreaterThan(2);
  });

  it('없는 방은 거절, 진행자 권한 없이는 명령 불가', async () => {
    const { socket } = await open();
    const res = await call(socket, 'player:join', { code: 'QQQQ' });
    expect(res.ok).toBe(false);
    const cmd = await call(socket, 'host:command', { type: 'start' });
    expect(cmd.ok).toBe(false);
  });

  it('리모컨은 PIN으로 붙고, 틀린 PIN은 거절', async () => {
    const { code, hostPin } = await createRoom();
    const remote = await open();
    const wrong = await call(remote.socket, 'host:remote-login', { code, pin: hostPin === '0000' ? '1111' : '0000' });
    expect(wrong.ok).toBe(false);
    const ok = await call(remote.socket, 'host:remote-login', { code, pin: hostPin });
    expect(ok.ok).toBe(true);
    await until(() => remote.room?.role === 'remote', 5_000, '리모컨 상태');
    expect(remote.room?.code).toBe(code);
    const flow = await call(remote.socket, 'host:command', { type: 'setFlow', flow: ['minority', 'nunchi'] });
    expect(flow.ok).toBe(true);
    await until(() => remote.room?.flow[0] === 'minority', 5_000, '진행 순서 변경');
  });

  it('진행: 소개 → 플레이 → 일시정지 동안 시계 멈춤 → 결과 → 종료와 기록 저장', async () => {
    const { host, code } = await createRoom(['nunchi']);
    const players: Tracked[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await open();
      const r = await call(p.socket, 'player:join', { code });
      expect(r.ok).toBe(true);
      players.push(p);
    }
    expect((await call(host.socket, 'host:command', { type: 'start' })).ok).toBe(true);
    await until(() => host.view?.phase === 'intro', 5_000, '소개 단계');
    expect(host.view?.gameId).toBe('nunchi');
    expect((await call(host.socket, 'host:command', { type: 'next' })).ok).toBe(true);
    await until(() => host.view?.phase === 'playing', 5_000, '플레이 단계');
    expect((host.view?.view as NunchiHostView).participantCount).toBe(3);

    // 일시정지: 게임 시계가 멈춘다
    await call(host.socket, 'host:command', { type: 'pause' });
    await until(() => host.room?.paused === true, 5_000, '일시정지');
    const pausedAt = host.room!.pausedAt;
    await sleep(400);
    expect(host.room?.pausedAt).toBe(pausedAt);
    // 일시정지 중 입력은 무시
    players[0]!.socket.emit('player:input', { input: { type: 'tap' }, at: Date.now() });
    await call(host.socket, 'host:command', { type: 'resume' });
    await until(() => host.room?.paused === false, 5_000, '재개');
    expect(host.room!.timeBase).toBeGreaterThanOrEqual(350);

    // 버튼이 열리면 두 명이 차례로 눌러서 마지막 한 명이 벌칙
    await until(
      () => players.every((p) => (p.view?.view as NunchiPlayerView | undefined)?.stage === 'open'),
      8_000,
      '버튼 열림',
    );
    expect(players.every((p) => (p.view?.view as NunchiPlayerView).canTap)).toBe(true);
    players[0]!.socket.emit('player:input', { input: { type: 'tap' }, at: Date.now() });
    await sleep(700);
    players[1]!.socket.emit('player:input', { input: { type: 'tap' }, at: Date.now() });
    await until(() => (host.view?.view as NunchiHostView | undefined)?.stage === 'roundEnd', 5_000, '라운드 종료');
    const out = (host.view?.view as NunchiHostView).outcome;
    expect(out?.kind).toBe('last');
    expect(out?.losers).toHaveLength(1);
    const loserView = players[2]!.view?.view as NunchiPlayerView;
    expect(loserView.outcome?.youLost).toBe(true);

    // 1라운드 설정이라 곧 결과 단계
    await until(() => host.view?.phase === 'result', 8_000, '결과 단계');
    expect(host.view?.summary?.gameId).toBe('nunchi');

    // 종료 → 설문 → 기록 저장
    await call(host.socket, 'host:command', { type: 'next' });
    await until(() => host.room?.phase === 'finished', 5_000, '세션 종료');
    const reportId = host.room!.report!.id;
    expect(host.room!.report!.games).toHaveLength(1);
    players[0]!.socket.emit('player:survey', { phase: 'end', comfort: 5, newPeople: 2 });
    await until(() => host.room?.survey?.end.count === 1, 5_000, '설문 반영');
    expect(host.room!.survey!.end.newPeople).toEqual([0, 0, 1, 0]);
    await sleep(2_600);
    const saved = await t.storage.getSession(reportId);
    expect(saved?.roomCode).toBe(code);
    expect(saved?.survey.end.count).toBe(1);
    const viaApi = await body(fetch(`${t.url}/api/sessions/${reportId}`));
    expect(viaApi.report.games[0].gameId).toBe('nunchi');
  });

  it('진행자가 내보낸 사람은 같은 토큰으로 다시 못 들어온다', async () => {
    const { host, code } = await createRoom();
    const p = await open();
    const joined = await call(p.socket, 'player:join', { code });
    if (!joined.ok) throw new Error('join failed');
    const kicked = nextEvent(p.socket, 'kicked');
    expect((await call(host.socket, 'host:command', { type: 'kick', playerId: joined.playerId })).ok).toBe(true);
    await kicked;
    const back = await call((await open()).socket, 'player:join', { code, token: joined.token });
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.error).toBe('KICKED');
  });

  it('리액션은 큰 화면으로만 간다', async () => {
    const { host, code } = await createRoom();
    const p = await open();
    await call(p.socket, 'player:join', { code, nickname: '박수왕' });
    const got = nextEvent(host.socket, 'reaction');
    p.socket.emit('player:react', 'clap');
    const [r] = await got;
    expect(r).toMatchObject({ kind: 'clap', nickname: '박수왕' });
  });
});
