import type { SessionReport } from '@caps/shared';
import { useEffect, useState } from 'react';
import { Spinner, Wordmark } from '../components/ui';
import { FinalReport } from '../games/common';
import { api } from '../lib/api';
import { Link } from '../lib/router';

/** 세션 기록 공유 페이지: 발표 자료에 그대로 쓸 수 있는 지표 화면 */
export function Report({ id }: { id: string }) {
  const [report, setReport] = useState<SessionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .session(id)
      .then((r) => setReport(r.report))
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
        {report && <FinalReport report={report} />}
      </main>
    </div>
  );
}
