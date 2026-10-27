import QRCode from 'qrcode';

export function qrDataUrl(text: string, dark = '#1B1A3A'): Promise<string> {
  return QRCode.toDataURL(text, {
    margin: 1,
    width: 640,
    errorCorrectionLevel: 'M',
    color: { dark, light: '#FFFFFF' },
  });
}

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = {
  new (opts: { formats: string[] }): DetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

export interface Scanner {
  stop(): void;
}

type JsQR = typeof import('jsqr').default;

/**
 * 카메라로 QR을 읽는다. 브라우저 내장 BarcodeDetector가 있으면 쓰고, 없으면 jsQR로 직접 디코딩한다.
 * jsQR(약 120KB)은 스캐너를 처음 열 때만 내려받는다. 참가자 폰의 첫 로딩을 가볍게 하려는 것.
 * 카메라를 못 쓰면 onError로 알리고, 화면은 숫자 코드 입력으로 대신한다.
 */
export async function startScanner(
  video: HTMLVideoElement,
  onResult: (text: string) => void,
  onError: (message: string) => void,
): Promise<Scanner> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch {
    onError('카메라를 쓸 수 없어요. 상대 화면의 숫자 코드를 입력해 주세요');
    return { stop() {} };
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play().catch(() => undefined);

  let detector: DetectorLike | null = null;
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Ctor) {
    try {
      const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
      if (formats.includes('qr_code')) detector = new Ctor({ formats: ['qr_code'] });
    } catch {
      detector = null;
    }
  }
  let jsQR: JsQR | null = null;
  if (!detector) {
    try {
      jsQR = (await import('jsqr')).default;
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      onError('스캐너를 불러오지 못했어요. 상대 화면의 숫자 코드를 입력해 주세요');
      return { stop() {} };
    }
  }
  const canvas = document.createElement('canvas');
  const c2d = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let timer = 0;

  const loop = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (detector) {
          const codes = await detector.detect(video);
          const value = codes[0]?.rawValue;
          if (value && !stopped) onResult(value);
        } else if (c2d && jsQR) {
          const scale = Math.min(1, 480 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          c2d.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = c2d.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
          if (code?.data && !stopped) onResult(code.data);
        }
      }
    } catch {
      /* 한 프레임 실패는 무시하고 다음 프레임 */
    }
    timer = window.setTimeout(loop, 160);
  };
  void loop();

  return {
    stop() {
      stopped = true;
      window.clearTimeout(timer);
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
