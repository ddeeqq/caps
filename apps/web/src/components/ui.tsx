import {
  NEW_PEOPLE_BUCKETS,
  REACTION_KINDS,
  REACTIONS,
  type PlayerSummary,
  type ReactionKind,
} from '@caps/shared';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { qrDataUrl } from '../lib/qr';
import type { ReactionEvent, RoomClient } from '../lib/roomClient';
import { buzz } from '../lib/sound';

export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`wordmark wordmark--${size}`}>
      <span className="caption caption--sun">말문</span>
      <svg className="wordmark__bubble" viewBox="0 0 40 32" aria-hidden="true">
        <path
          d="M6 3h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H17l-8 6v-6H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z"
          fill="#fff"
          stroke="#1b1a3a"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="14" r="2.6" fill="#1b1a3a" />
        <circle cx="20" cy="14" r="2.6" fill="#ff4f8b" />
        <circle cx="28" cy="14" r="2.6" fill="#1b1a3a" />
      </svg>
    </span>
  );
}

export function Caption({
  children,
  tone,
  as: Tag = 'p',
  className = '',
}: {
  children: ReactNode;
  tone?: 'sun' | 'mint' | 'coral' | 'soda' | 'ink';
  as?: 'h1' | 'h2' | 'p' | 'span';
  className?: string;
}) {
  return <Tag className={`caption ${tone ? `caption--${tone}` : ''} ${className}`}>{children}</Tag>;
}

export function QRImage({
  text,
  label,
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    qrDataUrl(text)
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <div className={`qr ${className}`}>
      {src ? <img src={src} alt={label ?? 'QR 코드'} /> : <div className="qr__placeholder" />}
    </div>
  );
}

function tiltOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 9) - 4) * 0.9;
}

/** 대기실 명단: 들어올 때마다 스티커처럼 톡 붙는다 */
export function Stickers({ players, max = 80 }: { players: PlayerSummary[]; max?: number }) {
  const shown = players.slice(-max);
  return (
    <ul className="stickers">
      {shown.map((p) => (
        <li
          key={p.id}
          className={`sticker ${p.connected ? '' : 'sticker--away'}`}
          style={{ '--tilt': `${tiltOf(p.id)}deg`, '--c': p.color } as CSSProperties}
        >
          {p.nickname}
        </li>
      ))}
      {players.length > max && <li className="sticker sticker--more">외 {players.length - max}명</li>}
    </ul>
  );
}

const REACTION_LABELS: Record<ReactionKind, string> = {
  clap: '박수',
  laugh: '웃음',
  wow: '놀람',
  heart: '하트',
  fire: '불꽃',
};

export function ReactionBar({ client }: { client: RoomClient }) {
  const [burst, setBurst] = useState<{ kind: ReactionKind; id: number } | null>(null);
  return (
    <div className="react-bar" role="group" aria-label="리액션 보내기">
      {REACTION_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="react-bar__btn"
          aria-label={REACTION_LABELS[kind]}
          onClick={() => {
            client.react(kind);
            buzz(15);
            setBurst({ kind, id: Date.now() });
          }}
        >
          {REACTIONS[kind]}
          {burst?.kind === kind && (
            <span key={burst.id} className="react-bar__pop" aria-hidden="true">
              {REACTIONS[kind]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface Floating extends ReactionEvent {
  x: number;
  born: number;
}

/** 큰 화면 위로 떠오르는 리액션. lane: 떠오를 가로 구간(%) — 대기실에서는 QR을 가리지 않게 오른쪽만 쓴다 */
export function ReactionLayer({ client, lane = [4, 92] }: { client: RoomClient; lane?: [number, number] }) {
  const [items, setItems] = useState<Floating[]>([]);
  const laneRef = useRef(lane);
  laneRef.current = lane;
  useEffect(
    () =>
      client.onReaction((r) => {
        const [from, to] = laneRef.current;
        setItems((list) => [
          ...list.slice(-40),
          { ...r, x: from + Math.random() * (to - from), born: Date.now() },
        ]);
      }),
    [client],
  );
  useEffect(() => {
    const id = window.setInterval(
      () => setItems((list) => list.filter((i) => Date.now() - i.born < 3_400)),
      500,
    );
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="reactions" aria-hidden="true">
      {items.map((i) => (
        <div key={i.id} className="reaction" style={{ left: `${i.x}%`, '--c': i.color } as CSSProperties}>
          <span className="reaction__emoji">{REACTIONS[i.kind]}</span>
          <span className="reaction__name">{i.nickname}</span>
        </div>
      ))}
    </div>
  );
}

const FACES = [
  { v: 1, e: '😬', l: '어색해요' },
  { v: 2, e: '😐', l: '살짝 어색' },
  { v: 3, e: '🙂', l: '보통' },
  { v: 4, e: '😊', l: '편해요' },
  { v: 5, e: '😆', l: '아주 편함' },
];

export function ComfortScale({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="scale" role="radiogroup" aria-label="지금 분위기">
      {FACES.map((f) => (
        <button
          key={f.v}
          type="button"
          role="radio"
          aria-checked={value === f.v}
          className={`scale__item ${value === f.v ? 'is-on' : ''}`}
          onClick={() => onChange(f.v)}
        >
          <span className="scale__emoji" aria-hidden="true">
            {f.e}
          </span>
          <span className="scale__label">{f.l}</span>
        </button>
      ))}
    </div>
  );
}

export function NewPeopleScale({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="scale scale--wide" role="radiogroup" aria-label="오늘 처음 말해본 사람 수">
      {NEW_PEOPLE_BUCKETS.map((label, i) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={value === i}
          className={`scale__item ${value === i ? 'is-on' : ''}`}
          onClick={() => onChange(i)}
        >
          <span className="scale__label scale__label--big">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** 남은 시간 막대 */
export function TimerBar({
  from,
  to,
  now,
  tone = 'gum',
}: {
  from: number;
  to: number;
  now: number;
  tone?: string;
}) {
  const total = Math.max(1, to - from);
  const left = Math.max(0, Math.min(1, (to - now) / total));
  return (
    <div
      className="timerbar"
      role="progressbar"
      aria-valuenow={Math.round(left * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="timerbar__fill" style={{ width: `${left * 100}%`, background: `var(--${tone})` }} />
    </div>
  );
}

/** 아래에서 올라오는 시트 (내 QR, 스캐너) */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet__backdrop" onClick={onClose} />
      <div className="sheet__body" ref={ref} tabIndex={-1}>
        <div className="sheet__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--small" onClick={onClose}>
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ children, tone }: { children: ReactNode; tone?: 'ok' | 'bad' }) {
  return (
    <div className={`toast ${tone ? `toast--${tone}` : ''}`} role="status">
      {children}
    </div>
  );
}

/** 칩 입력: 엔터·쉼표로 추가, 칩을 눌러 삭제 */
export function ChipsInput({
  label,
  hint,
  values,
  onChange,
  max = 40,
  maxLength = 16,
  placeholder,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  max?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const items = raw
      .split(/[,\n]/)
      .map((s) => s.trim().slice(0, maxLength))
      .filter(Boolean);
    if (items.length === 0) return;
    const next = [...values];
    for (const item of items) if (!next.includes(item) && next.length < max) next.push(item);
    onChange(next);
    setDraft('');
  };
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {hint && <span className="field__hint">{hint}</span>}
      <div className="chips">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            className="chip"
            onClick={() => onChange(values.filter((x) => x !== v))}
            aria-label={`${v} 지우기`}
          >
            {v} <span aria-hidden="true">×</span>
          </button>
        ))}
        <input
          className="chips__input"
          value={draft}
          placeholder={values.length >= max ? '더 넣을 수 없어요' : (placeholder ?? '입력 후 엔터')}
          disabled={values.length >= max}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(',')) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            // 한글 입력 중(조합 중) 엔터는 글자 확정용이다. 여기서 추가하면 마지막 글자가 남거나 두 번 들어간다
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
          aria-label={label}
        />
      </div>
    </div>
  );
}

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{label}</span>
    </div>
  );
}
