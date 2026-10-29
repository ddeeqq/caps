import type { MinorityHostView, MinorityPlayerView, MinorityVote } from '@caps/shared';
import { useEffect, useRef } from 'react';
import { Caption } from '../components/ui';
import { secondsLeft, useCountdownBeeps, useSoundCue, useTicker } from '../lib/hooks';
import { buzz, sfx } from '../lib/sound';
import type { GameProps } from './types';

const STAGE_LABEL = {
  intro: '',
  talk: '작전 타임',
  vote: '투표 마감까지',
  reveal: '결과',
  done: '끝',
} as const;

export function MinorityHost({ view, client }: GameProps<MinorityHostView>) {
  useTicker(250);
  const now = client.gameNow();
  const q = view.question;
  const r = view.reveal;
  // 작전 타임 끝 → 호루라기, 투표 마감 3·2·1, 공개 → 탈락자가 있으면 쾅, 무효면 톡
  useCountdownBeeps(view.stage === 'vote' ? view.deadline : null, () => client.gameNow(), { go: null });
  useSoundCue(`${view.round}:${view.stage}`, (_a, b) => {
    if (b.endsWith(':vote')) return 'whistle';
    if (b.endsWith(':reveal')) return r && !r.tie ? 'boom' : 'pop';
    return null;
  });
  return (
    <section className="mino-host">
      <header className="mino-host__head">
        <p>
          {view.round} / {view.rounds} 라운드
        </p>
        <p>
          생존 <b>{view.aliveCount}</b> / {view.total}명
        </p>
      </header>
      {q && <p className="mino-host__prompt">{q.prompt}</p>}
      {q && (
        <div className="mino-host__sides">
          {(['a', 'b'] as const).map((k) => {
            const count = r ? (k === 'a' ? r.countA : r.countB) : null;
            const isMinority = r?.minority === k;
            return (
              <div
                key={k}
                className={`side side--${k} ${r ? (isMinority ? 'is-win' : r.tie ? '' : 'is-lose') : ''}`}
              >
                <span className="side__text">{k === 'a' ? q.a : q.b}</span>
                {count !== null && <span className="side__count">{count}명</span>}
              </div>
            );
          })}
        </div>
      )}
      {view.stage === 'talk' || view.stage === 'vote' ? (
        <p className="mino-host__timer">
          {STAGE_LABEL[view.stage]} <b>{secondsLeft(view.deadline, now)}</b>초
          {view.stage === 'vote' && <span className="muted"> 투표 {view.votedCount}명</span>}
        </p>
      ) : null}
      {view.stage === 'reveal' && r && (
        <div className="mino-host__reveal">
          <Caption tone={r.tie ? 'sun' : 'coral'} className="mino-host__verdict">
            {r.tie ? '무효! 모두 생존' : '다수 탈락!'}
          </Caption>
          {r.eliminatedNames.length > 0 && (
            <p className="mino-host__out">
              탈락: {r.eliminatedNames.slice(0, 14).join(', ')}
              {r.eliminatedNames.length > 14 ? ` 외 ${r.eliminatedNames.length - 14}명` : ''}
            </p>
          )}
        </div>
      )}
      {view.stage === 'done' && (
        <div className="mino-host__reveal">
          <Caption tone="mint" className="mino-host__verdict">
            최후의 소수
          </Caption>
          <p className="mino-host__out">{view.survivors.join(', ') || `${view.aliveCount}명`}</p>
        </div>
      )}
      {view.prophets.length > 0 && (
        <aside className="scoreboard">
          <h2>예언자 순위</h2>
          <ol>
            {view.prophets.map((p) => (
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

export function MinorityPlayer({ view, client }: GameProps<MinorityPlayerView>) {
  useTicker(250);
  const now = client.gameNow();
  const shownRound = useRef(0);
  const q = view.question;
  const r = view.reveal;

  useEffect(() => {
    if (view.stage !== 'reveal' || !r || shownRound.current === view.round) return;
    shownRound.current = view.round;
    if (r.youEliminated) {
      sfx('fail');
      buzz([80, 60, 80]);
    } else if (view.alive) sfx('ok');
  }, [view.stage, view.round, r, view.alive]);

  if (view.stage === 'reveal' && r) {
    if (r.youEliminated) {
      return (
        <section className="verdict verdict--lost">
          <Caption tone="coral" className="verdict__title">
            탈락!
          </Caption>
          <p className="verdict__why">다수 쪽이었어요. 이제 예언자가 되어 소수 쪽을 맞혀 보세요</p>
        </section>
      );
    }
    return (
      <section className={`verdict ${view.alive ? 'verdict--safe' : ''}`}>
        <Caption tone={view.alive ? 'mint' : 'sun'} className="verdict__title">
          {view.alive
            ? r.tie
              ? '무효! 생존'
              : '살아남았다!'
            : r.predictionCorrect
              ? '예언 적중!'
              : '결과 발표'}
        </Caption>
        <p className="verdict__why">
          {q?.a} {r.countA}명, {q?.b} {r.countB}명
        </p>
        {!view.alive && <p className="muted">예언 점수 {view.points}점</p>}
      </section>
    );
  }
  if (view.stage === 'done') {
    return (
      <section className="verdict">
        <Caption tone={view.alive ? 'mint' : 'sun'} className="verdict__title">
          {view.alive ? '최후의 소수!' : '게임 끝'}
        </Caption>
        <p className="verdict__why">{view.alive ? '끝까지 살아남았어요' : `예언 점수 ${view.points}점`}</p>
      </section>
    );
  }

  const choose = (k: MinorityVote) => {
    client.input({ type: view.alive ? 'vote' : 'predict', choice: k });
    sfx('tap');
    buzz(15);
  };
  const mine = view.alive ? view.myVote : view.myPrediction;
  return (
    <section className="mino-player">
      <p className="mino-player__stage">
        {view.alive
          ? view.stage === 'talk'
            ? '작전 타임! 주변과 상의하세요'
            : '투표 마감 직전!'
          : '예언자 모드: 어느 쪽이 소수일까?'}
        <b> {secondsLeft(view.deadline, now)}초</b>
      </p>
      {q && <p className="mino-player__prompt">{q.prompt}</p>}
      <div className="mino-player__choices">
        {(['a', 'b'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`choice choice--${k} ${mine === k ? 'is-on' : ''}`}
            onClick={() => choose(k)}
          >
            <span className="choice__text">{q ? (k === 'a' ? q.a : q.b) : k.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <p className="muted">
        {view.alive ? '더 많이 고른 쪽이 탈락해요. 마감 전까지 바꿀 수 있어요' : '맞히면 예언 점수 1점'}
      </p>
      <p className="mino-player__alive">지금 생존 {view.aliveCount}명</p>
    </section>
  );
}
