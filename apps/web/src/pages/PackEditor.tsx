import { LIMITS, PRESETS, type BalanceQuestion, type PackInput, type PresetId } from '@caps/shared';
import { useEffect, useRef, useState } from 'react';
import { ChipsInput, QRImage, Spinner, Wordmark } from '../components/ui';
import { api, ApiError, type PackPreview } from '../lib/api';
import { Link, navigate, useLocation } from '../lib/router';
import { keys, local } from '../lib/storage';

interface Draft {
  name: string;
  preset: PresetId;
  names: string[];
  keywords: string[];
  questions: BalanceQuestion[];
  teamNames: string[];
  finaleText: string;
  penalties: string[];
  personCompare: boolean | null;
}

const EMPTY: Draft = {
  name: '',
  preset: 'friends',
  names: [],
  keywords: [],
  questions: [],
  teamNames: [],
  finaleText: '',
  penalties: [],
  personCompare: null,
};

function toInput(d: Draft): PackInput {
  return {
    name: d.name.trim() || `${PRESETS[d.preset].label} 팩`,
    preset: d.preset,
    content: {
      names: d.names,
      keywords: d.keywords,
      balanceQuestions: d.questions.filter((q) => q.a.trim() && q.b.trim()),
      teamNames: d.teamNames,
      finaleText: d.finaleText.trim(),
      penalties: d.penalties,
    },
    options: d.personCompare === null ? {} : { personCompare: d.personCompare },
  };
}

/** 팩 만들기·고치기: 이름과 키워드만 넣어도 템플릿이 질문과 금고 기호를 채운다 */
export function PackEditor({ code }: { code?: string }) {
  const { query } = useLocation();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(!!code);
  const [editKey, setEditKey] = useState<string | null>(() =>
    code ? (query.get('key') ?? local.get(keys.packEdit(code.toUpperCase()))) : null,
  );
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [saved, setSaved] = useState<{ code: string; editKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const debounce = useRef(0);

  useEffect(() => {
    if (!code) return;
    const upper = code.toUpperCase();
    const key = query.get('key');
    if (key) {
      local.set(keys.packEdit(upper), key);
      setEditKey(key);
    }
    api
      .getPack(upper)
      .then(({ pack }) => {
        setDraft({
          name: pack.name,
          preset: pack.preset,
          names: pack.content.names,
          keywords: pack.content.keywords,
          questions: pack.content.balanceQuestions,
          teamNames: pack.content.teamNames,
          finaleText: pack.content.finaleText,
          penalties: pack.content.penalties,
          personCompare: pack.options.personCompare,
        });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // 입력이 멈추면 미리보기를 다시 만든다
  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      api
        .previewPack(toInput(draft))
        .then(setPreview)
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(debounce.current);
  }, [draft]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const preset = PRESETS[draft.preset];
  const personCompare = draft.personCompare ?? preset.personCompare;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (code && editKey) {
        const { pack } = await api.updatePack(code.toUpperCase(), editKey, toInput(draft));
        setSaved({ code: pack.code, editKey });
      } else {
        const { pack, editKey: key } = await api.createPack(toInput(draft));
        local.set(keys.packEdit(pack.code), key);
        setSaved({ code: pack.code, editKey: key });
        navigate(`/pack/${pack.code}`, { replace: true });
        setEditKey(key);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="center-page">
        <Spinner label="팩을 불러오는 중" />
      </main>
    );
  }

  const readOnly = !!code && !editKey;
  const editLink = saved ? `${window.location.origin}/pack/${saved.code}?key=${saved.editKey}` : null;

  return (
    <main className="setup pack">
      <header className="setup__head">
        <Link to="/" aria-label="처음으로">
          <Wordmark size="sm" />
        </Link>
        <h1>{code ? `팩 ${code.toUpperCase()}` : '팩 만들기'}</h1>
      </header>
      {readOnly && (
        <p className="pack__notice">
          편집 링크로 열어야 고칠 수 있어요. 이 팩으로 방을 만드는 건 누구나 할 수 있어요.{' '}
          <Link to={`/host/new?pack=${code?.toUpperCase()}`}>이 팩으로 방 만들기</Link>
        </p>
      )}
      <div className="pack__layout">
        <div className="pack__form">
          <section className="setup__section">
            <label className="field">
              <span className="field__label">팩 이름</span>
              <input
                className="input"
                maxLength={LIMITS.packName}
                value={draft.name}
                placeholder="예: 3팀 회식"
                onChange={(e) => set('name', e.target.value)}
                disabled={readOnly}
              />
            </label>
            <div className="presets" role="radiogroup" aria-label="모임 종류">
              {Object.values(PRESETS).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.preset === p.id}
                  className={`preset ${draft.preset === p.id ? 'is-on' : ''}`}
                  onClick={() => set('preset', p.id)}
                  disabled={readOnly}
                >
                  <strong>{p.label}</strong>
                  <span>{p.description}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="setup__section stack">
            {preset.namesUsage !== 'none' && (
              <ChipsInput
                label="이름"
                hint="친구·팀원 이름"
                values={draft.names}
                onChange={(v) => set('names', v)}
              />
            )}
            <ChipsInput
              label="키워드"
              hint="단골집, 프로젝트명, 여행지, 별명처럼 우리끼리 통하는 단어"
              values={draft.keywords}
              onChange={(v) => set('keywords', v)}
            />
            {preset.namesUsage === 'all' && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={personCompare}
                  onChange={(e) => set('personCompare', e.target.checked)}
                  disabled={readOnly}
                />
                <span>
                  <strong>이름 비교 질문 쓰기</strong>
                  <span className="muted">
                    '먼저 연락할 것 같은 사람은? 지훈 vs 민수'처럼 긍정적인 질문만 만들어요
                  </span>
                </span>
              </label>
            )}
          </section>
          <section className="setup__section stack">
            <h2>밸런스 질문 직접 넣기</h2>
            <p className="muted">소리 짝꿍 팀 미션과 소수결 서바이벌에 먼저 쓰여요</p>
            {draft.questions.map((q, i) => (
              <div key={i} className="question-row">
                <input
                  className="input"
                  placeholder="질문 (예: 2차는?)"
                  maxLength={LIMITS.question}
                  value={q.prompt}
                  onChange={(e) =>
                    set(
                      'questions',
                      draft.questions.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)),
                    )
                  }
                  disabled={readOnly}
                />
                <input
                  className="input"
                  placeholder="A"
                  maxLength={LIMITS.questionSide}
                  value={q.a}
                  onChange={(e) =>
                    set(
                      'questions',
                      draft.questions.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)),
                    )
                  }
                  disabled={readOnly}
                />
                <span className="question-row__vs">vs</span>
                <input
                  className="input"
                  placeholder="B"
                  maxLength={LIMITS.questionSide}
                  value={q.b}
                  onChange={(e) =>
                    set(
                      'questions',
                      draft.questions.map((x, j) => (j === i ? { ...x, b: e.target.value } : x)),
                    )
                  }
                  disabled={readOnly}
                />
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() =>
                    set(
                      'questions',
                      draft.questions.filter((_, j) => j !== i),
                    )
                  }
                  disabled={readOnly}
                >
                  삭제
                </button>
              </div>
            ))}
            {draft.questions.length < LIMITS.questions && (
              <button
                type="button"
                className="btn btn--small btn--sun"
                onClick={() =>
                  set('questions', [...draft.questions, { prompt: '하나만 고른다면?', a: '', b: '' }])
                }
                disabled={readOnly}
              >
                질문 추가
              </button>
            )}
          </section>
          <section className="setup__section stack">
            <ChipsInput
              label="팀 이름"
              hint="소리 짝꿍에서 '마케팅 염소 팀'처럼 앞에 붙어요"
              values={draft.teamNames}
              onChange={(v) => set('teamNames', v)}
              max={LIMITS.teamNames}
            />
            <label className="field">
              <span className="field__label">카드섹션 마지막 문구</span>
              <input
                className="input"
                maxLength={LIMITS.finale}
                value={draft.finaleText}
                placeholder={preset.finaleText}
                onChange={(e) => set('finaleText', e.target.value)}
                disabled={readOnly}
              />
            </label>
            <ChipsInput
              label="눈치게임 벌칙"
              hint="가볍고 웃기게. 아무도 곤란하지 않은 걸로"
              values={draft.penalties}
              onChange={(v) => set('penalties', v)}
              max={LIMITS.penalties}
              maxLength={LIMITS.penalty}
              placeholder={preset.penalties[0]}
            />
          </section>
          {!readOnly && (
            <footer className="setup__foot">
              {error && <p className="error-text">{error}</p>}
              <button type="button" className="btn btn--primary btn--block" onClick={save} disabled={busy}>
                {busy ? '저장 중' : code ? '고친 내용 저장' : '팩 저장하고 코드 받기'}
              </button>
            </footer>
          )}
        </div>
        <aside className="pack__preview" aria-live="polite">
          {saved && (
            <div className="pack__saved panel">
              <p className="muted">공유 코드</p>
              <p className="code-big">{saved.code}</p>
              <QRImage
                text={`${window.location.origin}/host/new?pack=${saved.code}`}
                label="이 팩으로 방 만들기 QR"
                className="qr--small"
              />
              <div className="row">
                <Link to={`/host/new?pack=${saved.code}`} className="btn btn--sun">
                  이 팩으로 방 만들기
                </Link>
                {editLink && (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => void navigator.clipboard?.writeText(editLink)}
                  >
                    편집 링크 복사
                  </button>
                )}
              </div>
              <p className="muted">
                편집 링크가 있어야 다시 고칠 수 있어요. 코드만 알면 누구나 이 팩으로 방을 만들 수 있으니,
                이름이 들어간 팩은 모임 안에서만 공유해 주세요
              </p>
            </div>
          )}
          <h2>이렇게 만들어져요</h2>
          {preview ? (
            <>
              <h3>밸런스 질문 ({preview.balanceCount}개 중 일부)</h3>
              <ul className="pack__questions">
                {preview.balancePool.slice(0, 8).map((q) => (
                  <li key={`${q.prompt}${q.a}${q.b}`}>
                    <span className="muted">{q.prompt}</span>
                    <b>{q.a}</b> vs <b>{q.b}</b>
                  </li>
                ))}
              </ul>
              <h3>금고 기호</h3>
              <p className="pack__symbols">
                {preview.vaultSymbols.map((s) => (
                  <span key={s} className="chip chip--static">
                    {s}
                  </span>
                ))}
              </p>
              <h3>마지막 문구</h3>
              <p className="caption caption--sun pack__finale">{preview.finaleText}</p>
            </>
          ) : (
            <Spinner label="미리보기 만드는 중" />
          )}
        </aside>
      </div>
    </main>
  );
}
