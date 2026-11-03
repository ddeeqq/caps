/** 폰 센서·화면 관련 권한을 한곳에서 다룬다. 모든 실패는 조용히 false로. */

type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

let motionGranted = false;

/** iOS는 버튼 탭 안에서 권한을 요청해야 기울기 센서가 켜진다 */
export async function requestMotion(): Promise<boolean> {
  const D = (window as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
  if (!D) return false;
  if (typeof D.requestPermission === 'function') {
    try {
      motionGranted = (await D.requestPermission()) === 'granted';
    } catch {
      motionGranted = false;
    }
    return motionGranted;
  }
  motionGranted = true;
  return true;
}

/**
 * 버튼을 다시 누르지 않아도 센서를 켤 수 있는지.
 * 소개 화면에서 이미 허락받았거나(iOS), 권한 요청이 필요 없는 브라우저(안드로이드 등)면 true.
 */
export function motionReady(): boolean {
  if (motionGranted) return true;
  const D = (window as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
  return !!D && typeof D.requestPermission !== 'function' && isTouchDevice();
}

/** 지금 화면이 폰 기본(세로) 방향에서 몇 도 돌아가 있는지: 0, 90, 180, 270 */
export function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

/**
 * 화면 기준 좌우 기울기를 -1 ~ 1로 (35도면 끝까지).
 * 센서 값은 폰 몸체 기준이라, 가로로 눕히면 좌우 기울기가 gamma가 아니라 beta에 담긴다.
 * 이벤트마다 화면 방향을 다시 읽으므로 게임 도중 폰을 돌려도 그대로 맞는다.
 * (iOS 16.4 미만처럼 screen.orientation이 없으면 window.orientation을 쓴다)
 */
export function tiltFromSensor(gamma: number, beta: number, angle: number): number {
  let raw: number;
  if (angle === 90) raw = beta;
  else if (angle === 270) raw = -beta;
  else if (angle === 180) raw = -gamma;
  else raw = gamma;
  return Math.max(-1, Math.min(1, raw / 35));
}

export function watchTilt(cb: (v: number) => void): () => void {
  const handler = (e: DeviceOrientationEvent) => {
    if (e.gamma === null || e.gamma === undefined) return;
    cb(tiltFromSensor(e.gamma, e.beta ?? 0, screenAngle()));
  };
  window.addEventListener('deviceorientation', handler);
  return () => window.removeEventListener('deviceorientation', handler);
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
let sentinel: WakeLockSentinelLike | null = null;
let wanted = false;

async function acquire(): Promise<boolean> {
  try {
    const wl = (
      navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }
    ).wakeLock;
    if (!wl) return false;
    sentinel = await wl.request('screen');
    return true;
  } catch {
    return false;
  }
}

/**
 * Wake Lock이 없는 곳(iOS 16.3 이하, 카카오톡 등 안드로이드 앱 안 브라우저)의 대책:
 * 보이지 않는 2초짜리 무음 영상을 반복 재생하면 폰이 "영상 보는 중"으로 알고 화면을 끄지 않는다.
 */
let awakeVideo: HTMLVideoElement | null = null;

async function playAwakeVideo(): Promise<boolean> {
  try {
    if (!awakeVideo) {
      const v = document.createElement('video');
      v.src = '/awake.mp4';
      v.muted = true;
      v.loop = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.setAttribute('aria-hidden', 'true');
      v.style.cssText =
        'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(v);
      awakeVideo = v;
    }
    await awakeVideo.play();
    return true;
  } catch {
    return false;
  }
}

const onVisibility = () => {
  if (!wanted || document.visibilityState !== 'visible') return;
  // 화면을 떠났다 오면 Wake Lock은 풀린다. 다시 잡고, 영상 대책도 다시 튼다
  void acquire().then((ok) => {
    if (!ok || awakeVideo) void playAwakeVideo();
  });
};

/** 화면 꺼짐 방지 (카드섹션 등). 탭을 다시 보면 자동으로 다시 잡는다 */
export async function keepScreenOn(): Promise<boolean> {
  wanted = true;
  document.addEventListener('visibilitychange', onVisibility);
  if (await acquire()) return true;
  return playAwakeVideo();
}

export function releaseScreen(): void {
  wanted = false;
  document.removeEventListener('visibilitychange', onVisibility);
  void sentinel?.release().catch(() => undefined);
  sentinel = null;
  if (awakeVideo) {
    awakeVideo.pause();
    awakeVideo.remove();
    awakeVideo = null;
  }
}

export async function enterFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  } catch {
    /* iOS 사파리는 지원하지 않는다 */
  }
}

export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
