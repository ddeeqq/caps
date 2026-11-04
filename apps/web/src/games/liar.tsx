import type { LiarHostView, LiarOutcome, LiarPlayerView } from '@caps/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Caption, TimerBar } from '../components/ui';
import { secondsLeft, useCountdownBeeps, useSoundCue, useTicker } from '../lib/hooks';
import { buzz, sfx } from '../lib/sound';
import type { GameProps } from './types';

const OUTCOME: Record<LiarOutcome, { label: string; tone: 'mint' | 'coral' | 'sun' }> = {
  caught: { label: '검거', tone: 'mint' },
  escaped: { label: '도망', tone: 'coral' },
  stolen: { label: '역전승', tone: 'sun' },
};

const HOST_STAGE: Record<LiarHostView['stage'], string> = {
  intro: '',
  word: '폰을 가리고 제시어를 확인하세요',
  talk: '폰에 나온 순서대로, 한 사람씩 한마디',
  vote: '누가 라이어일까? 폰으로 지목하세요',
  guess: '잡힌 라이어의 마지막 기회! 제시어를 맞히면 역전',
  reveal: '라이어 공개',
  done: '게임 끝',
};

export function LiarHost({ view, client, room }: GameProps<LiarHostView>) {
  useTicker(250);
  const now = client.gameNow();
  const timed = view.stage === 'talk' || view.stage === 'vote' || view.stage === 'guess';
  useCountdownBeeps(
    view.stage === 'vote' || view.stage === 'guess' ? view.deadline : null,
    () => client.gameNow(),
    {
      go: null,
    },
  );
  useSoundCue(`${view.round}:${view.stage}`, (_a, b) => {
    if (b.endsWith(':vote')) return 'whistle';
    if (b.endsWith(':guess')) return 'drumroll';
    if (b.endsWith(':reveal')) return 'boom';
    return null;
  });
  const reveal = view.stage === 'reveal' || view.stage === 'done';
  const total = view.stage === 'talk' ? 'ready' : 'voted';
  return (
    <section className="liar-host">
      <header className="liar-host__head">
        <p>
          {view.round} / {view.rounds} 라운드
        </p>
        <p
          className="liar-host__score"
          aria-label={`시민 ${view.score.citizens}승, 라이어 ${view.score.liars}승`}
        >
          시민 <b>{view.score.citizens}</b> : <b>{view.score.liars}</b> 라이어
        </p>
      </header>
      <div className="liar-host__category">
        <span>카테고리</span>
        <Caption tone="sun" className="liar-host__cat">
          {view.category}
        </Caption>
      </div>
      <p className="liar-host__stage">
        {HOST_STAGE[view.stage]}
        {timed && (
          <>
            {' '}
            <b>{secondsLeft(view.deadline, now)}</b>초
          </>
        )}
      </p>
      <ul className="liar-host__tables">
        {view.tables.map((t) => {
          const outcome = t.outcome ? OUTCOME[t.outcome] : null;
          const count = total === 'ready' ? t.ready : t.voted;
          return (
            <li
              key={t.name}
              className={`liar-table ${outcome ? `liar-table--${t.outcome}` : ''}`}
              style={{ '--c': t.color } as CSSProperties}
            >
              <div className="liar-table__name">
                <span className="dot" style={{ background: t.color }} />
                <strong>{t.name}</strong>
                <span className="muted">{t.size}명</span>
              </div>
              {reveal && t.liarName ? (
                <div className="liar-table__reveal">
                  <p>
                    라이어 <b>{t.liarName}</b>
                  </p>
                  <p>
                    제시어 <b>{t.word}</b>
                    {t.guess && t.outcome !== 'escaped' && (
                      <span className="muted"> (라이어의 답: {t.guess})</span>
                    )}
                  </p>
                  {outcome && (
                    <Caption tone={outcome.tone} className="liar-table__badge">
                      {outcome.label}
                    </Caption>
                  )}
                </div>
              ) : view.stage === 'guess' ? (
                <p className="liar-table__state">
                  {t.accusedName ? `${t.accusedName} 지목! 맞히는 중…` : '지목 실패, 공개를 기다려요'}
                </p>
              ) : view.stage === 'talk' || view.stage === 'vote' ? (
                <p className="liar-table__state">
                  {view.stage === 'talk' ? '다 말했어요' : '투표'} {count} / {t.size}
                </p>
              ) : (
                <p className="liar-table__state">제시어 확인 중</p>
              )}
            </li>
          );
        })}
      </ul>
      {timed && (
        <TimerBar
          from={
            view.deadline -
            (view.stage === 'talk'
              ? room.settings.liarTalkSeconds * 1000
              : view.stage === 'vote'
                ? 20_000
                : 15_000)
          }
          to={view.deadline}
          now={now}
          tone="sun"
        />
      )}
      {view.topLiars.length > 0 && reveal && (
        <aside className="scoreboard">
          <h2>속이기 장인</h2>
          <ol>
            {view.topLiars.map((p) => (
              <li key={p.nickname}>
                <span>{p.nickname}</span>
                <b>{p.points}</b>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </section>
  );
}

/** 누르고 있는 동안만 보이는 카드 (옆 사람이 화면을 훔쳐보지 못하게) */
function SecretCard({ view }: { view: LiarPlayerView }) {
  const [open, setOpen] = useState(false);
  const show = () => {
    setOpen(true);
    buzz(10);
  };
  const hide = () => setOpen(false);
  return (
    <button
      type="button"
      className={`secret ${open ? 'is-open' : ''} ${view.isLiar && open ? 'secret--liar' : ''}`}
      onPointerDown={show}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') show();
      }}
      onKeyUp={hide}
      onBlur={hide}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="누르고 있으면 제시어가 보여요"
    >
      {open ? (
        view.isLiar ? (
          <>
            <span className="secret__label">당신은</span>
            <Caption tone="coral" className="secret__word">
              라이어
            </Caption>
            <span className="secret__hint">카테고리 “{view.category}”만 알고 아는 척하세요</span>
          </>
        ) : (
          <>
            <span className="secret__label">제시어</span>
            <Caption tone="sun" className="secret__word">
              {view.word}
            </Caption>
            <span className="secret__hint">라이어가 눈치채지 못하게 설명하세요</span>
          </>
        )
      ) : (
        <>
          <span className="secret__eye" aria-hidden="true">
            👀
          </span>
          <span className="secret__label">누르고 있으면 보여요</span>
          <span className="secret__hint">화면을 몸 쪽으로 가리고 확인하세요</span>
        </>
      )}
    </button>
  );
}

export function LiarPlayer({ view, client, room }: GameProps<LiarPlayerView>) {
  useTicker(250);
  const now = client.gameNow();
  const shown = useRef('');
  const key = `${view.round}:${view.stage}`;

  useEffect(() => {
    if (shown.current === key) return;
    shown.current = key;
    if (view.stage === 'reveal' && view.result) {
      if (view.result.youWon) sfx('win');
      else {
        sfx('fail');
        buzz([80, 60, 80]);
      }
    }
    if (view.stage === 'guess' && view.options) {
      sfx('drumroll');
      buzz([60, 40, 60]);
    }
  }, [key, view.stage, view.result, view.options]);

  const style = { '--c': view.tableColor } as CSSProperties;
  const tableTag = (
    <p className="liar-player__table">
      <span className="dot" style={{ background: view.tableColor }} />
      {view.tableName} 테이블 · {view.round}/{view.rounds} 라운드
    </p>
  );

  if (!view.seated) {
    return (
      <section className="liar-player">
        <Caption tone="sun" className="liar-player__title">
          구경하기
        </Caption>
        <p>테이블 인원이 모자라서 이번 판은 구경해요. 옆 테이블의 설명을 들어 보세요!</p>
      </section>
    );
  }

  if ((view.stage === 'reveal' || view.stage === 'done') && view.result) {
    const r = view.result;
    return (
      <section className={`verdict ${r.youWon ? 'verdict--safe' : 'verdict--lost'}`} style={style}>
        <Caption tone={r.youWon ? 'mint' : 'coral'} className="verdict__title">
          {r.youWon ? '이겼다!' : '졌다…'}
        </Caption>
        <p className="verdict__why">
          라이어는 <b>{r.liarName}</b>, 제시어는 <b>{r.word}</b>
        </p>
        <p className="muted">
          {r.outcome === 'caught'
            ? '라이어를 잡았고, 제시어도 지켰어요'
            : r.outcome === 'stolen'
              ? `잡혔지만 제시어를 맞혀서 라이어 역전승 (답: ${r.guess})`
              : '라이어를 놓쳤어요. 끝까지 속였네요'}
        </p>
        <p className="liar-player__points">내 점수 {view.points}점</p>
      </section>
    );
  }

  if (view.stage === 'vote') {
    const others = view.order.filter((p) => p.id !== room.you?.id);
    return (
      <section className="liar-player" style={style}>
        {tableTag}
        <p className="liar-player__stage">
          라이어는 누구? <b>{secondsLeft(view.deadline, now)}초</b>
        </p>
        <div className="liar-vote">
          {others.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`choice liar-vote__btn ${view.myVote === p.id ? 'is-on' : ''}`}
              onClick={() => {
                client.input({ type: 'vote', target: p.id });
                sfx('tap');
                buzz(15);
              }}
            >
              <span className="dot" style={{ background: p.color }} />
              <span className="choice__text">{p.nickname}</span>
            </button>
          ))}
        </div>
        <p className="muted">
          {view.votedCount}명 투표함 · 마감 전까지 바꿀 수 있어요{view.isLiar ? ' (라이어도 투표해요!)' : ''}
        </p>
      </section>
    );
  }

  if (view.stage === 'guess') {
    if (view.options) {
      return (
        <section className="liar-player" style={style}>
          <Caption tone="coral" className="liar-player__title">
            들켰다!
          </Caption>
          <p className="liar-player__stage">
            제시어를 맞히면 역전승 <b>{secondsLeft(view.deadline, now)}초</b>
          </p>
          <div className="liar-guess">
            {view.options.map((w) => (
              <button
                key={w}
                type="button"
                className={`choice ${view.myGuess === w ? 'is-on' : ''}`}
                disabled={view.myGuess !== null}
                onClick={() => {
                  client.input({ type: 'guess', word: w });
                  sfx('tap');
                }}
              >
                <span className="choice__text">{w}</span>
              </button>
            ))}
          </div>
          <p className="muted">한 번만 고를 수 있어요. 설명을 떠올려 보세요</p>
        </section>
      );
    }
    return (
      <section className="liar-player" style={style}>
        {tableTag}
        <Caption tone="sun" className="liar-player__title">
          두근두근
        </Caption>
        <p>
          {view.accusedName
            ? `${view.accusedName}님이 지목됐어요. 라이어라면 지금 제시어를 맞히는 중!`
            : '지목이 엇갈렸어요. 공개를 기다려요'}
        </p>
      </section>
    );
  }

  // word / talk
  const meFirst = view.order[0];
  return (
    <section className="liar-player" style={style}>
      {tableTag}
      <SecretCard view={view} />
      {view.stage === 'talk' ? (
        <>
          <p className="liar-player__stage">
            한 사람씩 한마디 <b>{secondsLeft(view.deadline, now)}초</b>
          </p>
          <ol className="liar-order" aria-label="말할 순서">
            {view.order.map((p, i) => (
              <li key={p.id} style={{ '--c': p.color } as CSSProperties}>
                <span className="liar-order__n">{i + 1}</span>
                {p.nickname}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className={`btn btn--block ${view.ready ? '' : 'btn--sun'}`}
            disabled={view.ready}
            onClick={() => {
              client.input({ type: 'ready' });
              sfx('ok');
            }}
          >
            {view.ready ? `기다리는 중 (${view.readyCount}명 완료)` : '다 말했어요, 투표하러 가기'}
          </button>
        </>
      ) : (
        <p className="liar-player__stage">
          {meFirst ? `곧 ${meFirst.nickname}님부터 설명을 시작해요` : '곧 설명을 시작해요'}
        </p>
      )}
    </section>
  );
}
