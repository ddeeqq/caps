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
  if (!navigator.mediaDevices?.getUserMedia) {
    // HTTP 주소이거나, 카메라를 막아 둔 앱 안 브라우저(일부 카카오톡·인스타그램 등)
    onError('이 브라우저에서는 카메라를 쓸 수 없어요. 상대 화면의 숫자 코드를 입력해 주세요');
    return { stop() {} };
  }
  try {
    // 갤럭시처럼 뒷카메라가 여럿인 폰은 초광각이 잡히면 가까운 QR에 초점이 안 맞는다.
    // 해상도를 적당히 요청하면 대개 기본(광각) 카메라가 잡힌다. 안 되면 아무 카메라로 다시 시도
    stream = await navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
  } catch (err) {
    const denied = (err as DOMException)?.name === 'NotAllowedError';
    onError(
      denied
        ? '카메라 권한이 꺼져 있어요. 주소창의 설정에서 카메라를 허용하거나, 상대 화면의 숫자 코드를 입력해 주세요'
        : '카메라를 쓸 수 없어요. 상대 화면의 숫자 코드를 입력해 주세요',
    );
    return { stop() {} };
  }
  // 계속 초점 맞추기 (안드로이드 크롬·삼성 인터넷이 지원, 아이폰은 기본으로 자동 초점)
  const track = stream.getVideoTracks()[0];
  try {
    const caps = (track?.getCapabilities?.() ?? {}) as { focusMode?: string[] };
    if (caps.focusMode?.includes('continuous')) {
      await track!.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
    }
  } catch {
    /* 지원하지 않으면 기본 초점 */
  }
  // 아이폰 사파리는 playsinline·muted가 없으면 전체 화면 재생으로 넘어가거나 재생을 거부한다
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.muted = true;
  video.srcObject = stream;
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
  const loadJsQR = async (): Promise<boolean> => {
    try {
      jsQR = (await import('jsqr')).default;
      return true;
    } catch {
      return false;
    }
  };
  if (!detector) {
    if (!(await loadJsQR())) {
      stream.getTracks().forEach((t) => t.stop());
      onError('스캐너를 불러오지 못했어요. 상대 화면의 숫자 코드를 입력해 주세요');
      return { stop() {} };
    }
  }
  const canvas = document.createElement('canvas');
  const c2d = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let timer = 0;
  let detectorFailures = 0;

  const loop = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (detector) {
          try {
            const codes = await detector.detect(video);
            detectorFailures = 0;
            const value = codes[0]?.rawValue;
            if (value && !stopped) onResult(value);
          } catch (err) {
            // 일부 안드로이드 기기는 내장 인식기가 있어도 계속 실패한다: 몇 번 실패하면 jsQR로 바꾼다
            if (++detectorFailures >= 8) {
              detector = null;
              if (!(await loadJsQR())) throw err;
            }
          }
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
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
    },
  };
}
