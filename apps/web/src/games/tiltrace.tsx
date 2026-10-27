import { BOAT_HALF_WIDTH, type TiltraceHostView, type TiltracePlayerView } from '@caps/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Caption } from '../components/ui';
import { requestMotion, watchTilt } from '../lib/device';
import { useAnimationFrame, useTicker } from '../lib/hooks';
import { buzz } from '../lib/sound';
import type { GameProps } from './types';

const VIEW_AHEAD = 7; // 화면에 보이는 앞쪽 거리

export function TiltraceHost({ view, client }: GameProps<TiltraceHostView>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useTicker(250, view.stage === 'countdown');
  const now = client.gameNow();

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    const v = viewRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const lanes = Math.max(1, v.boats.length);
    const gap = 14;
    const laneW = (w - gap * (lanes + 1)) / lanes;
    const boatY = h * 0.8;
    const unit = (h * 0.78) / VIEW_AHEAD;
    v.boats.forEach((b, i) => {
      const x0 = gap + i * (laneW + gap);
      const cx = x0 + laneW / 2;
      const half = laneW / 2;
      // 물
      g.fillStyle = '#1f8fd0';
      g.beginPath();
      g.roundRect(x0, 0, laneW, h, 18);
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = '#1b1a3a';
      g.stroke();
      // 물결 줄무늬
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 2;
      for (let k = Math.floor(b.progress); k < b.progress + VIEW_AHEAD + 1; k++) {
        const y = boatY - (k - b.progress) * unit;
        g.beginPath();
        g.moveTo(x0 + 10, y);
        g.lineTo(x0 + laneW - 10, y);
        g.stroke();
      }
      // 결승선
      const finishY = boatY - (v.length - b.progress) * unit;
      if (finishY > -20) {
        g.fillStyle = '#ffffff';
        g.fillRect(x0 + 6, finishY - 6, laneW - 12, 12);
        g.fillStyle = '#1b1a3a';
        for (let k = 0; k < (laneW - 12) / 12; k += 2) g.fillRect(x0 + 6 + k * 12, finishY - 6, 12, 6);
      }
      // 바위
      for (const rock of v.rocks) {
        const dy = rock.y - b.progress;
        if (dy < -1 || dy > VIEW_AHEAD) continue;
        const ry = boatY - dy * unit;
        g.fillStyle = '#6f6e94';
        g.strokeStyle = '#1b1a3a';
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(
          cx + rock.x * half,
          ry,
          rock.r * half,
          Math.max(10, rock.r * half * 0.7),
          0,
          0,
          Math.PI * 2,
        );
        g.fill();
        g.stroke();
      }
      // 배
      const bx = cx + b.x * half;
      const bw = BOAT_HALF_WIDTH * half;
      const blink = b.stunned && Math.floor(performance.now() / 120) % 2 === 0;
      g.fillStyle = blink ? '#ffffff' : b.color;
      g.strokeStyle = '#1b1a3a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(bx, boatY - bw * 2.2);
      g.lineTo(bx + bw, boatY + bw * 0.9);
      g.lineTo(bx - bw, boatY + bw * 0.9);
      g.closePath();
      g.fill();
      g.stroke();
      // 팀 평균 기울기 화살표
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(cx - 2, h - 26, 4, 14);
      g.fillStyle = '#ffd93b';
      g.fillRect(cx, h - 24, b.avg * half * 0.9, 10);
    });
  }, true);

  const ranked = [...view.boats].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.progress - a.progress);
  return (
    <section className="race-host">
      <header className="race-host__head">
        {view.stage === 'countdown' && now < view.startAt ? (
          <Caption tone="sun" className="race-host__count">
            {Math.max(1, Math.ceil((view.startAt - now) / 1000))}
          </Caption>
        ) : (
          <p className="race-host__label">
            {view.stage === 'done' ? '레이스 끝!' : '다 같이 기울여서 바위를 피하세요'}
          </p>
        )}
      </header>
      <div className="race-host__lanes">
        <canvas ref={canvasRef} className="race-host__canvas" />
        <ul className="race-host__names" style={{ gridTemplateColumns: `repeat(${view.boats.length}, 1fr)` }}>
          {view.boats.map((b) => (
            <li key={b.teamId} style={{ '--c': b.color } as CSSProperties}>
              <strong>{b.name}</strong>
              <span>{b.rank ? `${b.rank}등` : `${Math.floor((b.progress / view.length) * 100)}%`}</span>
              <span>충돌 {b.hits}번</span>
            </li>
          ))}
        </ul>
      </div>
      {view.stage === 'done' && ranked[0] && <p className="race-host__winner">{ranked[0].name} 우승!</p>}
    </section>
  );
}

export function TiltracePlayer({ view, client }: GameProps<TiltracePlayerView>) {
  useTicker(250, view.stage === 'countdown');
  const [sensor, setSensor] = useState<'off' | 'on' | 'denied'>('off');
  const [tilt, setTilt] = useState(0);
  const tiltRef = useRef(0);
  const holdRef = useRef(0);
  const racing = view.stage === 'race' || view.stage === 'countdown';

  useEffect(() => {
    if (sensor !== 'on') return;
    return watchTilt((v) => {
      tiltRef.current = v;
      setTilt(v);
    });
  }, [sensor]);

  // 초당 8번 서버로 보낸다 (버튼을 누르고 있으면 버튼 값 우선)
  useEffect(() => {
    if (!racing) return;
    const id = window.setInterval(() => {
      const v = holdRef.current !== 0 ? holdRef.current : sensor === 'on' ? tiltRef.current : 0;
      client.input({ type: 'tilt', v: Math.round(v * 100) / 100 });
    }, 125);
    return () => window.clearInterval(id);
  }, [racing, sensor, client]);

  useEffect(() => {
    if (view.stunned) buzz(120);
  }, [view.stunned]);

  const hold = (v: number) => ({
    onPointerDown: () => {
      holdRef.current = v;
      setTilt(v);
    },
    onPointerUp: () => {
      holdRef.current = 0;
      setTilt(sensor === 'on' ? tiltRef.current : 0);
    },
    onPointerLeave: () => {
      holdRef.current = 0;
    },
    onPointerCancel: () => {
      holdRef.current = 0;
    },
  });

  if (view.stage === 'done' || view.finished) {
    return (
      <section className="verdict verdict--safe">
        <Caption tone="mint" className="verdict__title">
          {view.place}등!
        </Caption>
        <p className="verdict__why">{view.teamName} 골인. 큰 화면을 봐 주세요</p>
      </section>
    );
  }
  const now = client.gameNow();
  return (
    <section className="race-player" style={{ '--c': view.teamColor } as CSSProperties}>
      <header className="race-player__head">
        <span className="dot" style={{ background: view.teamColor }} />
        <strong>{view.teamName}</strong>
        <span>
          {view.place} / {view.teams}등
        </span>
        <span>{view.progressPct}%</span>
      </header>
      {view.stage === 'countdown' && now < view.startAt && (
        <Caption tone="sun" className="race-player__count">
          {Math.max(1, Math.ceil((view.startAt - now) / 1000))}
        </Caption>
      )}
      <div className="tilt-meter" aria-label="기울기">
        <span className="tilt-meter__mine" style={{ left: `${50 + tilt * 45}%` }}>
          나
        </span>
        <span className="tilt-meter__team" style={{ left: `${50 + view.avg * 45}%` }}>
          팀
        </span>
      </div>
      <p className="race-player__hint">
        {view.stunned ? '쾅! 바위에 부딪혔어요' : '팀원과 소리쳐서 방향을 맞추세요'}
      </p>
      {sensor !== 'on' && (
        <button
          type="button"
          className="btn btn--sun btn--block"
          onClick={async () => setSensor((await requestMotion()) ? 'on' : 'denied')}
        >
          {sensor === 'denied' ? '센서를 쓸 수 없어요. 아래 버튼으로 조종' : '기울기 센서 켜기'}
        </button>
      )}
      <div className="race-player__pads">
        <button type="button" className="pad" {...hold(-1)} aria-label="왼쪽">
          ◀
        </button>
        <button type="button" className="pad" {...hold(1)} aria-label="오른쪽">
          ▶
        </button>
      </div>
    </section>
  );
}
