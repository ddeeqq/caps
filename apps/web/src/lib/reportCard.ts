import { reportHighlights, type SessionReport } from '@caps/shared';

/**
 * 세션 리포트를 공유용 이미지(1080×1350, 세로 4:5)로 그린다.
 * 카카오톡·인스타그램에 그대로 올릴 수 있는 크기. 화면 캡처 대신 캔버스에 직접 그려서
 * 폰·PC 어디서 저장해도 같은 모양이 나온다.
 */
const W = 1080;
const H = 1350;
const C = {
  sun: '#ffd93b',
  sun2: '#fff0a3',
  ink: '#1b1a3a',
  ink3: '#6f6e94',
  paper: '#ffffff',
  gum: '#ff4f8b',
};
const DISPLAY = "'Black Han Sans', 'Pretendard Variable', sans-serif";
const BODY = "'Pretendard Variable', 'Apple SD Gothic Neo', sans-serif";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 박스: 잉크색 그림자 + 테두리 (앱의 버튼·카드와 같은 모양) */
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  ctx.fillStyle = C.ink;
  roundRect(ctx, x, y + 8, w, h, 28);
  ctx.fill();
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, 28);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = C.ink;
  ctx.stroke();
}

/** 폭을 넘으면 말줄임 */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** 한글 웹폰트는 쓰는 글자 조각만 받으므로, 그릴 글자를 미리 불러 둔다 */
async function loadFonts(texts: string[]): Promise<void> {
  if (!document.fonts) return;
  const all = texts.join('');
  await Promise.all([
    document.fonts.load(`100px ${DISPLAY}`, all).catch(() => undefined),
    document.fonts.load(`700 40px ${BODY}`, all).catch(() => undefined),
  ]);
}

export async function renderReportCard(report: SessionReport): Promise<Blob> {
  const h = reportHighlights(report);
  const date = new Date(report.startedAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const headline =
    h.newPeopleRate !== null
      ? `${h.newPeopleRate}%가 새 사람과 말했어요`
      : `${h.people}명이 함께 말문을 텄어요`;
  const stats: Array<{ label: string; value: string }> = [
    {
      label: '분위기 (5점)',
      value:
        h.comfortBefore !== null && h.comfortAfter !== null
          ? `${h.comfortBefore}→${h.comfortAfter}`
          : h.comfortAfter !== null
            ? `${h.comfortAfter}`
            : '-',
    },
    { label: '얼굴 보고 말 건 횟수', value: `${h.faceToFace}번` },
    { label: '끝까지 함께', value: `${h.retention}%` },
    { label: '함께한 사람', value: `${h.people}명` },
  ];
  const quote = report.quotes?.[0] ?? null;
  await loadFonts([
    '말문',
    '오늘 말문이 트였나요?',
    headline,
    report.packName,
    date,
    quote ?? '',
    ...stats.flatMap((s) => [s.label, s.value]),
    'QR 하나로 들어와서, 폰을 들고 같이 노는 20분',
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이 브라우저는 이미지를 만들 수 없어요');

  ctx.fillStyle = C.sun;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // 머리: 워드마크, 모임 이름, 날짜
  ctx.fillStyle = C.ink;
  ctx.font = `88px ${DISPLAY}`;
  ctx.fillText('말문', 72, 150);
  ctx.font = `700 34px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.fillText(fit(ctx, report.packName, 520), W - 72, 112);
  ctx.fillStyle = C.ink3;
  ctx.font = `600 30px ${BODY}`;
  ctx.fillText(date, W - 72, 154);
  ctx.textAlign = 'left';

  // 제목과 핵심 한 줄
  ctx.fillStyle = C.ink;
  ctx.font = `600 40px ${BODY}`;
  ctx.fillText('오늘 말문이 트였나요?', 72, 290);
  ctx.font = `96px ${DISPLAY}`;
  const words = headline.split(' ');
  // 두 줄로 나눈다 (폭 936px 안)
  let line1 = '';
  let line2 = '';
  for (const w of words) {
    const next = line1 ? `${line1} ${w}` : w;
    if (!line2 && ctx.measureText(next).width <= W - 144) line1 = next;
    else line2 = line2 ? `${line2} ${w}` : w;
  }
  ctx.fillText(line1, 72, 410);
  if (line2) ctx.fillText(fit(ctx, line2, W - 144), 72, 520);

  // 숫자 네 칸
  const top = 600;
  const gap = 32;
  const bw = (W - 144 - gap) / 2;
  const bh = 190;
  stats.forEach((s, i) => {
    const x = 72 + (i % 2) * (bw + gap);
    const y = top + Math.floor(i / 2) * (bh + gap + 8);
    box(ctx, x, y, bw, bh, C.paper);
    ctx.fillStyle = C.ink3;
    ctx.font = `700 30px ${BODY}`;
    ctx.fillText(fit(ctx, s.label, bw - 64), x + 32, y + 58);
    ctx.fillStyle = C.ink;
    ctx.font = `76px ${DISPLAY}`;
    ctx.fillText(fit(ctx, s.value, bw - 64), x + 32, y + 152);
  });

  // 한 줄 소감 하나
  if (quote) {
    const qy = top + 2 * (bh + gap + 8) + 12;
    box(ctx, 72, qy, W - 144, 150, C.sun2);
    ctx.fillStyle = C.gum;
    ctx.font = `90px ${DISPLAY}`;
    ctx.fillText('“', 104, qy + 108);
    ctx.fillStyle = C.ink;
    ctx.font = `700 40px ${BODY}`;
    ctx.fillText(fit(ctx, quote, W - 144 - 150), 170, qy + 92);
  }

  // 꼬리
  ctx.fillStyle = C.ink;
  ctx.font = `600 30px ${BODY}`;
  ctx.fillText('QR 하나로 들어와서, 폰을 들고 같이 노는 20분', 72, H - 72);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했어요'))), 'image/png'),
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** 폰에서는 공유 시트(카카오톡 등)로, 안 되면 파일로 내려받는다 */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
  title: string,
): Promise<'shared' | 'saved'> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return 'shared';
    }
  }
  downloadBlob(blob, filename);
  return 'saved';
}
