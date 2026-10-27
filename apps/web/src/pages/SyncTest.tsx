import { useEffect, useRef, useState } from 'react';
import { Caption, Wordmark } from '../components/ui';
import { enterFullscreen, keepScreenOn, releaseScreen } from '../lib/device';
import { useAnimationFrame } from '../lib/hooks';
import { useClientSnapshot, useRoomClient } from '../lib/roomClient';
import { Link } from '../lib/router';

const FLASH_COLORS = ['#ffffff', '#ffd93b', '#ff4f8b', '#3ec1f3'];

/**
 * 설계서 1주차 게이트용 측정 페이지.
 * 여러 폰에서 이 페이지를 열고 '동시 점등'을 켜면, 모두 서버 시각 기준 매 초 정각에 깜빡이고
 * 서버 시각 밀리초를 크게 보여준다. 나란히 놓고 240fps 슬로모션으로 찍으면 기기 간 오차를 프레임 단위로 잴 수 있다.
 */
export function SyncTest() {
  const client = useRoomClient();
  const snap = useClientSnapshot(client);
  const [, rerender] = useState(0);
  const [flashing, setFlashing] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const msRef = useRef<HTMLSpanElement>(null);
  const secRef = useRef<HTMLSpanElement>(null);

  useEffect(() => client.clock.subscribe(() => rerender((x) => x + 1)), [client]);
  useEffect(() => {
    if (flashing) void keepScreenOn();
    else releaseScreen();
  }, [flashing]);

  useAnimationFrame(() => {
    const t = client.serverNow();
    const sec = Math.floor(t / 1000);
    const ms = Math.floor(t % 1000);
    const el = stageRef.current;
    if (!el) return;
    const on = ms < 120;
    el.style.background = on ? (FLASH_COLORS[sec % FLASH_COLORS.length] as string) : '#000000';
    el.style.color = on ? '#1b1a3a' : '#ffffff';
    if (msRef.current) msRef.current.textContent = String(ms).padStart(3, '0');
    if (secRef.current) secRef.current.textContent = String(sec % 100).padStart(2, '0');
  }, flashing);

  const s = client.clock.stats;

  if (flashing) {
    return (
      <div
        className="sync-flash"
        ref={stageRef}
        onClick={() => setFlashing(false)}
        role="button"
        tabIndex={0}
        aria-label="동시 점등 끄기"
      >
        <p className="sync-flash__time">
          <span ref={secRef}>00</span>.<span ref={msRef}>000</span>
        </p>
        <p className="sync-flash__hint">서버 시각 초.밀리초</p>
        <p className="sync-flash__hint">화면을 누르면 멈춰요</p>
      </div>
    );
  }

  return (
    <main className="phone-page sync">
      <header className="phone-page__head">
        <Link to="/" aria-label="처음으로">
          <Wordmark size="sm" />
        </Link>
        <h1>동기화 테스트</h1>
      </header>
      <Caption as="p" tone="sun" className="sync__big">
        {s ? `${Math.round(s.rtt)}ms` : '측정 중'}
      </Caption>
      <p className="sync__caption">서버까지 가장 빠른 왕복 시간</p>
      <dl className="sync__stats">
        <div>
          <dt>시계 차이 (오프셋)</dt>
          <dd>{s ? `${Math.round(s.offset)}ms` : '-'}</dd>
        </div>
        <div>
          <dt>추정 퍼짐</dt>
          <dd>{s ? `${s.spread.toFixed(1)}ms` : '-'}</dd>
        </div>
        <div>
          <dt>측정 횟수</dt>
          <dd>{client.clock.sampleCount}</dd>
        </div>
        <div>
          <dt>연결</dt>
          <dd>{snap.connected ? '연결됨' : '끊김'}</dd>
        </div>
      </dl>
      <section className="panel stack">
        <h2>동시 점등 테스트</h2>
        <p>
          폰 여러 대에서 이 페이지를 열고 아래 버튼을 누르세요. 모든 폰이 서버 시각으로 매 초 정각에 깜빡이고,
          서버 시각의 밀리초를 크게 보여줘요.
        </p>
        <p className="muted">
          나란히 놓고 다른 폰으로 슬로모션(240fps) 촬영하면, 같은 프레임에 찍힌 숫자 차이가 곧 기기 간
          오차예요. 목표는 50ms 이하.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => {
            setFlashing(true);
            void enterFullscreen();
          }}
          disabled={!s}
        >
          동시 점등 시작
        </button>
      </section>
    </main>
  );
}
