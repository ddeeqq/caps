import {
  GAME_META,
  NEW_PEOPLE_BUCKETS,
  type GameId,
  type GameSummary,
  type Permission,
  type SessionReport,
} from '@caps/shared';
import { useState } from 'react';
import { Caption } from '../components/ui';
import { keepScreenOn, requestMotion } from '../lib/device';
import { playAnimal, unlockAudio } from '../lib/sound';

const PERMISSION_TEXT: Record<Permission, string> = {
  audio: '폰 소리를 켜 주세요 (무음 모드 해제)',
  camera: '카메라로 QR을 스캔해요',
  motion: '폰을 기울여서 조종해요',
  wakelock: '화면이 꺼지지 않게 해 둘게요',
};

/** 큰 화면: 게임 소개 */
export function HostIntro({
  gameId,
  index,
  total,
  playerCount,
}: {
  gameId: GameId;
  index: number;
  total: number;
  playerCount: number;
}) {
  const meta = GAME_META[gameId];
  const tooFew = playerCount < meta.minPlayers;
  return (
    <section className="intro">
      <p className="intro__step">
        게임 {index + 1} / {total}
        {meta.extra ? <span className="intro__extra">추가 게임</span> : null}
      </p>
      <Caption as="h1" className="intro__title">
        {meta.title}
      </Caption>
      <p className="intro__tagline">{meta.tagline}</p>
      <ul className="intro__rules">
        {meta.rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {meta.permissions.length > 0 && (
        <ul className="intro__needs">
          {meta.permissions.map((p) => (
            <li key={p}>{PERMISSION_TEXT[p]}</li>
          ))}
        </ul>
      )}
      {tooFew && (
        <p className="intro__warn">
          최소 {meta.minPlayers}명이 필요해요. 지금 {playerCount}명이에요.
        </p>
      )}
    </section>
  );
}

/** 폰: 게임 소개 + 필요한 권한을 미리 켜 두기 */
export function PlayerIntro({ gameId }: { gameId: GameId }) {
  const meta = GAME_META[gameId];
  const [audioOk, setAudioOk] = useState<boolean | null>(null);
  const [motionOk, setMotionOk] = useState<boolean | null>(null);
  const [awake, setAwake] = useState<boolean | null>(null);
  return (
    <section className="p-intro">
      <Caption as="h1" tone="sun" className="p-intro__title">
        {meta.title}
      </Caption>
      <p className="p-intro__tagline">{meta.tagline}</p>
      <ul className="p-intro__rules">
        {meta.rules.slice(0, 3).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="stack">
        {meta.permissions.includes('audio') && (
          <button
            type="button"
            className={`btn btn--block ${audioOk ? 'btn--mint' : 'btn--sun'}`}
            onClick={async () => {
              const ok = await unlockAudio();
              setAudioOk(ok);
              if (ok) playAnimal('chicken');
            }}
          >
            {audioOk ? '소리 켜짐. 꼬끼오가 들렸나요?' : '소리 켜기 테스트'}
          </button>
        )}
        {audioOk === false && <p className="error-text">소리를 켤 수 없어요. 무음 모드를 확인해 주세요</p>}
        {meta.permissions.includes('motion') && (
          <button
            type="button"
            className={`btn btn--block ${motionOk ? 'btn--mint' : 'btn--sun'}`}
            onClick={async () => setMotionOk(await requestMotion())}
          >
            {motionOk ? '기울기 센서 켜짐' : '기울기 센서 켜기'}
          </button>
        )}
        {motionOk === false && <p className="muted">센서를 못 쓰면 게임 중에 버튼으로 조종할 수 있어요</p>}
        {meta.permissions.includes('wakelock') && (
          <button
            type="button"
            className={`btn btn--block ${awake ? 'btn--mint' : 'btn--sun'}`}
            onClick={async () => setAwake(await keepScreenOn())}
          >
            {awake ? '화면 꺼짐 방지 켜짐' : '화면 꺼짐 방지 켜기'}
          </button>
        )}
      </div>
      <p className="p-intro__wait">진행자가 시작하면 바로 바뀌어요</p>
    </section>
  );
}

/** 큰 화면: 게임 결과 */
export function HostResult({ summary, nextGame }: { summary: GameSummary | null; nextGame: GameId | null }) {
  if (!summary) return null;
  return (
    <section className="result-screen">
      <p className="result-screen__game">{summary.title} 결과</p>
      <Caption as="h1" className="result-screen__headline">
        {summary.headline}
      </Caption>
      {summary.highlights.length > 0 && (
        <ul className="result-screen__list">
          {summary.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      <p className="result-screen__next">
        {nextGame ? `다음 게임: ${GAME_META[nextGame].title}` : '이제 마무리할 시간이에요'}
      </p>
    </section>
  );
}

export function PlayerResult({ summary }: { summary: GameSummary | null }) {
  return (
    <section className="p-result">
      <p className="p-result__game">{summary?.title ?? '게임'} 끝</p>
      <Caption as="h1" tone="sun" className="p-result__headline">
        {summary?.headline ?? '수고했어요!'}
      </Caption>
      <p className="muted">큰 화면을 봐 주세요. 리액션으로 박수를 보내도 좋아요</p>
    </section>
  );
}

function Bars({ values, labels }: { values: number[]; labels: readonly string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="bars">
      {values.map((v, i) => (
        <div key={labels[i]} className="bars__row">
          <span className="bars__label">{labels[i]}</span>
          <span className="bars__track">
            <span className="bars__fill" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="bars__value">{v}명</span>
        </div>
      ))}
    </div>
  );
}

/** 세션 마지막 화면이자 /report 페이지: 커뮤니케이션 지표 */
export function FinalReport({ report, live = false }: { report: SessionReport; live?: boolean }) {
  const s = report.survey;
  const delta =
    s.lobby.avg !== null && s.end.avg !== null ? Math.round((s.end.avg - s.lobby.avg) * 10) / 10 : null;
  const newPeopleCount = s.end.newPeople.reduce((a, b) => a + b, 0);
  return (
    <section className="report">
      <header className="report__head">
        <Caption as="h1" className="report__title">
          오늘 말문이 트였나요?
        </Caption>
        <p className="report__sub">
          {report.packName}, 최대 {report.peakPlayers}명이 함께했어요
          {(report.bots ?? 0) > 0
            ? ` (봇 ${report.bots}명이 같이 놀아서 연결 수에는 봇의 행동도 섞여 있어요)`
            : ''}
        </p>
        {live && <p className="report__hint">폰에서 마지막 설문에 답해 주세요. 결과가 바로 반영돼요</p>}
      </header>
      <div className="report__grid">
        <article className="report__card report__card--wide">
          <h2>오늘 처음 말해본 사람</h2>
          {newPeopleCount > 0 ? (
            <Bars values={s.end.newPeople} labels={NEW_PEOPLE_BUCKETS} />
          ) : (
            <p className="muted">설문 응답을 기다리는 중이에요</p>
          )}
        </article>
        <article className="report__card">
          <h2>분위기 편안함</h2>
          <p className="report__big">
            {s.lobby.avg ?? '-'} <span aria-hidden="true">→</span>
            <span className="sr-only">에서</span> {s.end.avg ?? '-'}
          </p>
          <p className="muted">5점 만점{delta !== null ? `, ${delta >= 0 ? '+' : ''}${delta}점` : ''}</p>
        </article>
        <article className="report__card">
          <h2>얼굴 보고 말 건 횟수</h2>
          <p className="report__big">{report.metrics.faceToFace}번</p>
          <p className="muted">
            소리 짝꿍에서 서로 QR을 찍은 횟수 (헛걸음 {report.metrics.wrongLinks}번 포함)
          </p>
        </article>
        <article className="report__card">
          <h2>끝까지 함께한 사람</h2>
          <p className="report__big">{report.retention}%</p>
          <p className="muted">
            최대 {report.peakPlayers}명 중 {report.activeAtEnd}명
          </p>
        </article>
        {report.metrics.vaultSuccessRate >= 0 && (
          <article className="report__card">
            <h2>말로 연 금고</h2>
            <p className="report__big">{report.metrics.vaultSuccessRate}%</p>
            <p className="muted">팀이 정보를 합쳐 연 비율</p>
          </article>
        )}
      </div>
      {report.games.length > 0 && (
        <ol className="report__games">
          {report.games.map((g) => (
            <li key={`${g.gameId}-${g.headline}`}>
              <strong>{g.title}</strong>
              <span>{g.headline}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
