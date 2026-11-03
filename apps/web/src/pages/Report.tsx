import type { SessionReport } from '@caps/shared';
import { useEffect, useState } from 'react';
import { Spinner, Wordmark } from '../components/ui';
import { FinalReport } from '../games/common';
import { api } from '../lib/api';
import { downloadBlob, renderReportCard, shareOrDownload } from '../lib/reportCard';
import { Link } from '../lib/router';

/** 파일 이름에 쓸 날짜 (YYYY-MM-DD) */
const day = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 주최자가 리포트를 가져가는 세 가지 방법: 공유 이미지, PDF(인쇄), 원본 데이터 */
function ReportActions({ report, retentionDays }: { report: SessionReport; retentionDays: number }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const base = `malmun-${report.roomCode}-${day(report.startedAt)}`;

  const image = async () => {
    setBusy(true);
    setNote(null);
    try {
      const blob = await renderReportCard(report);
      const how = await shareOrDownload(blob, `${base}.png`, `${report.packName} 말문 리포트`);
      setNote(how === 'saved' ? '이미지를 저장했어요' : null);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const data = () => {
    downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${base}.json`);
    setNote('원본 데이터(JSON)를 저장했어요');
  };

  return (
    <div className="report-actions">
      <div className="report-actions__row">
        <button type="button" className="btn btn--primary" onClick={() => void image()} disabled={busy}>
          {busy ? '이미지 만드는 중' : '이미지로 공유'}
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          PDF로 저장
        </button>
        <button type="button" className="btn btn--quiet" onClick={data}>
          원본 데이터
        </button>
      </div>
      <p className="report-actions__note" aria-live="polite">
        {note ??
          (retentionDays > 0
            ? `이 기록은 마지막으로 바뀐 날부터 ${retentionDays}일 동안 보관된 뒤 지워져요. 필요하면 지금 저장해 두세요.`
            : 'PDF로 저장은 인쇄 창에서 "PDF로 저장"을 고르면 돼요.')}
      </p>
    </div>
  );
}

/** 세션 기록 공유 페이지: 발표 자료에 그대로 쓸 수 있는 지표 화면 */
export function Report({ id }: { id: string }) {
  const [report, setReport] = useState<SessionReport | null>(null);
  const [retentionDays, setRetentionDays] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .session(id)
      .then((r) => {
        setReport(r.report);
        setRetentionDays(r.retentionDays ?? 0);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);
  return (
    <div className="screen screen--report" data-tone="sun">
      <header className="screen__bar">
        <Link to="/" aria-label="처음으로">
          <Wordmark size="sm" />
        </Link>
        {report && <span className="screen__code">{new Date(report.startedAt).toLocaleString('ko-KR')}</span>}
      </header>
      <main className="screen__stage">
        {error && <p className="error-text">{error}</p>}
        {!report && !error && <Spinner label="기록을 불러오는 중" />}
        {report && <ReportActions report={report} retentionDays={retentionDays} />}
        {report && <FinalReport report={report} />}
      </main>
    </div>
  );
}
