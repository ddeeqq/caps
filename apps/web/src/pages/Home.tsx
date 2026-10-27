import { DEFAULT_FLOW, GAME_META, GAME_IDS } from '@caps/shared';
import { useState, type FormEvent } from 'react';
import { Caption, Wordmark } from '../components/ui';
import { api } from '../lib/api';
import { Link, navigate } from '../lib/router';

/** 게임 속 실제 순간들. 홈 첫 화면에 스티커처럼 붙여 무슨 서비스인지 바로 보여준다 */
const MOMENTS = [
  { text: '충돌!', tone: 'coral', tilt: -6 },
  { text: '꼬끼오!', tone: 'sun', tilt: 4 },
  { text: '3번!', tone: undefined, tilt: -2 },
  { text: '금고 열렸다!', tone: 'mint', tilt: 5 },
  { text: '다수 탈락!', tone: 'soda', tilt: -4 },
] as const;

export function Home() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) {
      setError('방 코드는 영문 4글자예요');
      return;
    }
    setBusy(true);
    try {
      const r = await api.room(c);
      if (!r.exists) setError('그런 방이 없어요. 큰 화면의 코드를 다시 확인해 주세요');
      else navigate(`/play/${c}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const extras = GAME_IDS.filter((id) => !DEFAULT_FLOW.includes(id));

  return (
    <main className="home">
      <header className="home__hero">
        <Wordmark size="lg" />
        <Caption as="h1" className="home__headline">
          말문이 트이는 20분
        </Caption>
        <p className="home__lead">
          QR 하나로 들어와서 폰을 들고 같이 노는 아이스브레이킹 게임이에요. 앱 설치도, 가입도 없어요.
        </p>
        <ul className="home__moments" aria-hidden="true">
          {MOMENTS.map((m) => (
            <li key={m.text} style={{ rotate: `${m.tilt}deg` }}>
              <span className={`caption ${m.tone ? `caption--${m.tone}` : ''}`}>{m.text}</span>
            </li>
          ))}
        </ul>
      </header>

      <section className="home__join panel" aria-labelledby="join-title">
        <h2 id="join-title">참가하기</h2>
        <form className="stack" onSubmit={join}>
          <label className="field">
            <span className="field__label">큰 화면에 보이는 방 코드</span>
            <input
              className="input input--code"
              value={code}
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCD"
              onChange={(e) => {
                setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase());
                setError(null);
              }}
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={busy || code.length !== 4}>
            입장하기
          </button>
        </form>
      </section>

      <section className="home__host" aria-labelledby="host-title">
        <h2 id="host-title">진행하기</h2>
        <p>
          큰 화면에 띄울 방을 만들어요. 친구 이름이나 회사 키워드를 넣으면 게임 속 단어와 질문이 우리 모임에
          맞게 바뀌어요.
        </p>
        <div className="row">
          <Link to="/host/new" className="btn btn--sun">
            방 만들기
          </Link>
          <Link to="/pack/new" className="btn">
            팩 만들기
          </Link>
        </div>
      </section>

      <section className="home__flow" aria-labelledby="flow-title">
        <h2 id="flow-title">기본 진행 순서</h2>
        <p className="muted">웃음에서 시작해 섞이고, 협동하고, 다 같이 마무리해요</p>
        <ol className="flowlist">
          {DEFAULT_FLOW.map((id) => (
            <li key={id}>
              <strong>{GAME_META[id].title}</strong>
              <span>{GAME_META[id].tagline}</span>
            </li>
          ))}
        </ol>
        <h3>더 넣을 수 있는 게임</h3>
        <ul className="flowlist flowlist--plain">
          {extras.map((id) => (
            <li key={id}>
              <strong>{GAME_META[id].title}</strong>
              <span>{GAME_META[id].tagline}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="home__foot">
        <Link to="/remote">폰으로 진행하기 (리모컨)</Link>
        <Link to="/sync">동기화 테스트</Link>
      </footer>
    </main>
  );
}
