import {
  DEFAULT_FLOW,
  DEFAULT_SETTINGS,
  GAME_IDS,
  GAME_META,
  PACK_STARTERS,
  PRESETS,
  type GameId,
  type PackStarter,
  type Pack,
  type PresetId,
  type RoomSettings,
} from '@caps/shared';
import { useEffect, useState } from 'react';
import { ChipsInput, Wordmark } from '../components/ui';
import { api } from '../lib/api';
import { useRoomClient } from '../lib/roomClient';
import { Link, navigate, useLocation } from '../lib/router';
import { keys, local } from '../lib/storage';

const SETTING_FIELDS: Array<{
  key: keyof RoomSettings;
  label: string;
  unit: string;
  min: number;
  max: number;
  game: GameId;
}> = [
  { key: 'nunchiRounds', label: '눈치게임 라운드', unit: '라운드', min: 1, max: 10, game: 'nunchi' },
  { key: 'soundmateSeconds', label: '소리 짝꿍 찾기 시간', unit: '초', min: 30, max: 600, game: 'soundmate' },
  { key: 'vaultSafes', label: '금고 개수', unit: '개', min: 1, max: 5, game: 'vault' },
  { key: 'seatRows', label: '카드섹션 줄 수', unit: '줄', min: 1, max: 12, game: 'cardsection' },
  { key: 'seatCols', label: '카드섹션 한 줄 자리 수', unit: '자리', min: 1, max: 16, game: 'cardsection' },
  { key: 'minorityRounds', label: '소수결 라운드', unit: '라운드', min: 1, max: 10, game: 'minority' },
  { key: 'minorityTalkSeconds', label: '소수결 작전 타임', unit: '초', min: 5, max: 120, game: 'minority' },
  { key: 'tiltraceLength', label: '레이스 길이', unit: '초 거리', min: 15, max: 120, game: 'tiltrace' },
  { key: 'liarRounds', label: '라이어 라운드', unit: '라운드', min: 1, max: 6, game: 'liar' },
  { key: 'liarTalkSeconds', label: '라이어 설명 시간', unit: '초', min: 30, max: 300, game: 'liar' },
  { key: 'waveRounds', label: '파장 라운드', unit: '라운드', min: 1, max: 8, game: 'wavelength' },
  { key: 'waveSeconds', label: '파장 한 라운드', unit: '초', min: 20, max: 180, game: 'wavelength' },
];

export function HostNew() {
  const { query } = useLocation();
  const client = useRoomClient();
  const initialPack = (query.get('pack') ?? '').toUpperCase();
  const [preset, setPreset] = useState<PresetId>(
    (local.get(keys.lastPreset) as PresetId | null) ?? 'friends',
  );
  const [mode, setMode] = useState<'quick' | 'code'>(initialPack ? 'code' : 'quick');
  const [packCode, setPackCode] = useState(initialPack);
  const [pack, setPack] = useState<Pack | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [finale, setFinale] = useState('');
  const [starter, setStarter] = useState<PackStarter | null>(null);
  const [flow, setFlow] = useState<GameId[]>([...DEFAULT_FLOW]);
  const [settings, setSettings] = useState<RoomSettings>({ ...DEFAULT_SETTINGS });
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'code' || !/^[A-Z2-9]{6}$/.test(packCode)) {
      setPack(null);
      setPackError(null);
      return;
    }
    let alive = true;
    api
      .getPack(packCode)
      .then((r) => {
        if (!alive) return;
        setPack(r.pack);
        setPreset(r.pack.preset);
        setPackError(null);
      })
      .catch((e: Error) => alive && (setPack(null), setPackError(e.message)));
    return () => {
      alive = false;
    };
  }, [mode, packCode]);

  const toggle = (id: GameId) => setFlow((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const move = (id: GameId, dir: -1 | 1) =>
    setFlow((f) => {
      const i = f.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= f.length) return f;
      const next = [...f];
      [next[i], next[j]] = [next[j] as GameId, next[i] as GameId];
      return next;
    });

  const create = async () => {
    setError(null);
    if (flow.length === 0) {
      setError('게임을 하나 이상 골라 주세요');
      return;
    }
    if (mode === 'code' && !pack) {
      setError('팩 코드를 확인해 주세요');
      return;
    }
    setBusy(true);
    local.set(keys.lastPreset, preset);
    const res = await client.call('host:create', {
      preset,
      flow,
      settings,
      ...(mode === 'code'
        ? { packCode }
        : {
            inlinePack: {
              names,
              keywords,
              finaleText: finale,
              ...(starter
                ? { balanceQuestions: starter.content.balanceQuestions, penalties: starter.content.penalties }
                : {}),
            },
            packName: starter?.packName ?? `${PRESETS[preset].label} 모임`,
          }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    local.set(keys.host(res.code), res.hostToken);
    navigate(`/host/${res.code}`);
  };

  /** 템플릿을 고르면 모임 성격, 키워드, 마지막 문구, 순서를 한 번에 채운다. 다시 누르면 해제 */
  const pickStarter = (st: PackStarter) => {
    if (starter?.id === st.id) {
      setStarter(null);
      return;
    }
    setStarter(st);
    setMode('quick');
    setPreset(st.preset);
    setKeywords([...st.content.keywords]);
    setFinale(st.content.finaleText);
    setFlow([...st.flow]);
  };

  const presetDef = PRESETS[preset];
  const nameHint =
    presetDef.namesUsage === 'all'
      ? '금고 기호와 밸런스 질문에 쓰여요 (예: 지훈이가 더 좋아할 것 같은 쪽은?)'
      : presetDef.namesUsage === 'vault'
        ? '직장 모드에서는 금고 기호에만 쓰여요. 특정인을 지목하는 질문은 만들지 않아요'
        : '수업·동아리 모드는 서로 이름을 모르는 사이라 이름을 쓰지 않아요';

  return (
    <main className="setup">
      <header className="setup__head">
        <Link to="/" aria-label="처음으로">
          <Wordmark size="sm" />
        </Link>
        <h1>방 만들기</h1>
      </header>

      <section className="setup__section" aria-labelledby="starter-title">
        <h2 id="starter-title">템플릿으로 빠르게 시작</h2>
        <p className="muted">
          고르면 아래 모임 성격, 키워드, 질문, 순서가 채워져요. 그대로 써도 되고 고쳐도 돼요
        </p>
        {/* 다시 누르면 해제되므로 라디오가 아니라 켜고 끄는 버튼 묶음이다 */}
        <div className="starters" role="group" aria-labelledby="starter-title">
          {PACK_STARTERS.map((st) => (
            <button
              key={st.id}
              type="button"
              aria-pressed={starter?.id === st.id}
              className={`preset ${starter?.id === st.id ? 'is-on' : ''}`}
              onClick={() => pickStarter(st)}
            >
              <strong>{st.label}</strong>
              <span>{st.description}</span>
            </button>
          ))}
        </div>
        {starter && (
          <p className="pack-found">
            <strong>{starter.label}</strong> 템플릿: 질문 {starter.content.balanceQuestions.length}개, 키워드{' '}
            {starter.content.keywords.length}개, 게임 {starter.flow.length}개
          </p>
        )}
      </section>

      <section className="setup__section" aria-labelledby="preset-title">
        <h2 id="preset-title">어떤 모임인가요?</h2>
        <div className="presets" role="radiogroup">
          {Object.values(PRESETS).map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              className={`preset ${preset === p.id ? 'is-on' : ''}`}
              onClick={() => setPreset(p.id)}
              disabled={mode === 'code' && !!pack}
            >
              <strong>{p.label}</strong>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="setup__section" aria-labelledby="pack-title">
        <h2 id="pack-title">우리 모임 단어 넣기</h2>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'quick'}
            className={mode === 'quick' ? 'is-on' : ''}
            onClick={() => setMode('quick')}
          >
            빠르게 입력
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'code'}
            className={mode === 'code' ? 'is-on' : ''}
            onClick={() => setMode('code')}
          >
            저장된 팩 쓰기
          </button>
        </div>
        {mode === 'quick' ? (
          <div className="stack">
            {presetDef.namesUsage !== 'none' && (
              <ChipsInput
                label="이름"
                hint={nameHint}
                values={names}
                onChange={setNames}
                placeholder="예: 지훈 (엔터)"
              />
            )}
            <ChipsInput
              label="키워드"
              hint="모임에서만 통하는 단어: 단골집, 프로젝트명, 여행지, 별명"
              values={keywords}
              onChange={setKeywords}
              placeholder="예: 단골집 (엔터)"
            />
            <label className="field">
              <span className="field__label">마지막 문구</span>
              <span className="field__hint">카드섹션 피날레에 한 글자씩 떠올라요</span>
              <input
                className="input"
                maxLength={30}
                value={finale}
                placeholder={presetDef.finaleText}
                onChange={(e) => setFinale(e.target.value)}
              />
            </label>
            <p className="muted">
              비워 둬도 괜찮아요. 기본 질문과 기호로 진행돼요. 질문까지 직접 넣고 저장하려면{' '}
              <Link to="/pack/new">팩 만들기</Link>
            </p>
          </div>
        ) : (
          <div className="stack">
            <label className="field">
              <span className="field__label">팩 코드 6자리</span>
              <input
                className="input input--code"
                maxLength={6}
                value={packCode}
                placeholder="ABC234"
                onChange={(e) => setPackCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
              />
            </label>
            {pack && (
              <p className="pack-found">
                <strong>{pack.name}</strong> ({PRESETS[pack.preset].label}, 이름 {pack.content.names.length}
                개, 키워드 {pack.content.keywords.length}개, 질문 {pack.content.balanceQuestions.length}개)
              </p>
            )}
            {packError && <p className="error-text">{packError}</p>}
          </div>
        )}
      </section>

      <section className="setup__section" aria-labelledby="flow-title">
        <h2 id="flow-title">진행 순서</h2>
        <p className="muted">
          기본은 웃음 → 섞임 → 협동 → 일체감 순서예요. 순서를 바꾸거나 빼고 더할 수 있어요
        </p>
        <ol className="flow-edit">
          {flow.map((id, i) => (
            <li key={id}>
              <span className="flow-edit__title">
                <strong>{GAME_META[id].title}</strong>
                <span className="muted">약 {GAME_META[id].minutes}분</span>
              </span>
              <span className="flow-edit__btns">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => move(id, -1)}
                  disabled={i === 0}
                  aria-label="위로"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => move(id, 1)}
                  disabled={i === flow.length - 1}
                  aria-label="아래로"
                >
                  ↓
                </button>
                <button type="button" className="btn btn--small" onClick={() => toggle(id)}>
                  빼기
                </button>
              </span>
            </li>
          ))}
        </ol>
        {GAME_IDS.some((id) => !flow.includes(id)) && (
          <div className="flow-add">
            {GAME_IDS.filter((id) => !flow.includes(id)).map((id) => (
              <button key={id} type="button" className="btn btn--small btn--sun" onClick={() => toggle(id)}>
                + {GAME_META[id].title}
                {GAME_META[id].extra ? ' (추가 게임)' : ''}
              </button>
            ))}
          </div>
        )}
        <p className="muted">
          예상 시간 약 {flow.reduce((a, id) => a + GAME_META[id].minutes, 0) + flow.length}분
        </p>
      </section>

      <section className="setup__section">
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => setShowSettings((s) => !s)}
          aria-expanded={showSettings}
        >
          {showSettings ? '세부 설정 닫기' : '세부 설정 (시간, 라운드, 좌석)'}
        </button>
        {showSettings && (
          <div className="settings-grid">
            {SETTING_FIELDS.filter((f) => flow.includes(f.game)).map((f) => (
              <label key={f.key} className="field">
                <span className="field__label">{f.label}</span>
                <span className="row">
                  <input
                    className="input input--num"
                    type="number"
                    min={f.min}
                    max={f.max}
                    value={settings[f.key]}
                    onChange={(e) => {
                      const v = Math.max(f.min, Math.min(f.max, Number(e.target.value) || f.min));
                      setSettings((s) => ({ ...s, [f.key]: v }));
                    }}
                  />
                  <span className="muted">{f.unit}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <footer className="setup__foot">
        {error && <p className="error-text">{error}</p>}
        <button type="button" className="btn btn--primary btn--block" onClick={create} disabled={busy}>
          {busy ? '방을 여는 중' : '방 열기'}
        </button>
        <p className="muted">방을 열면 이 화면이 큰 화면(프로젝터)용으로 바뀌어요</p>
      </footer>
    </main>
  );
}
