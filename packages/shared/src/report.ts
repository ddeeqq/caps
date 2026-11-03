import type { SessionReport } from './protocol';

/** 리포트에서 한눈에 보여 줄 숫자들 (리포트 화면, 공유 이미지에서 같이 쓴다) */
export interface ReportHighlights {
  /** 종료 설문에서 "처음 말해본 사람이 1명 이상"이라고 답한 비율 (%), 응답이 없으면 null */
  newPeopleRate: number | null;
  endResponses: number;
  comfortBefore: number | null;
  comfortAfter: number | null;
  /** 분위기 점수 변화 (소수 첫째 자리), 둘 중 하나라도 없으면 null */
  comfortDelta: number | null;
  faceToFace: number;
  retention: number;
  people: number;
}

export function reportHighlights(report: SessionReport): ReportHighlights {
  const s = report.survey;
  const buckets = s.end.newPeople;
  const total = buckets.reduce((a, b) => a + b, 0);
  const met = total - buckets[0];
  return {
    newPeopleRate: total > 0 ? Math.round((met / total) * 100) : null,
    endResponses: total,
    comfortBefore: s.lobby.avg,
    comfortAfter: s.end.avg,
    comfortDelta:
      s.lobby.avg !== null && s.end.avg !== null ? Math.round((s.end.avg - s.lobby.avg) * 10) / 10 : null,
    faceToFace: report.metrics.faceToFace,
    retention: report.retention,
    people: report.peakPlayers,
  };
}
