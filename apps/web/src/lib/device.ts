/** 폰 센서·화면 관련 권한을 한곳에서 다룬다. 모든 실패는 조용히 false로. */

type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

/** iOS는 버튼 탭 안에서 권한을 요청해야 기울기 센서가 켜진다 */
export async function requestMotion(): Promise<boolean> {
  const D = (window as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
  if (!D) return false;
  if (typeof D.requestPermission === 'function') {
    try {
      return (await D.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}

/** 좌우 기울기를 -1 ~ 1로 (세로로 들었을 때 35도면 끝까지) */
export function watchTilt(cb: (v: number) => void): () => void {
  const handler = (e: DeviceOrientationEvent) => {
    if (e.gamma === null || e.gamma === undefined) return;
    const angle = (screen.orientation?.angle ?? 0) % 180;
    const raw = angle === 0 ? e.gamma : (e.beta ?? 0) * (screen.orientation?.angle === 90 ? 1 : -1);
    cb(Math.max(-1, Math.min(1, raw / 35)));
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

const onVisibility = () => {
  if (wanted && document.visibilityState === 'visible') void acquire();
};

/** 화면 꺼짐 방지 (카드섹션 등). 탭을 다시 보면 자동으로 다시 잡는다 */
export async function keepScreenOn(): Promise<boolean> {
  wanted = true;
  document.addEventListener('visibilitychange', onVisibility);
  return acquire();
}

export function releaseScreen(): void {
  wanted = false;
  document.removeEventListener('visibilitychange', onVisibility);
  void sentinel?.release().catch(() => undefined);
  sentinel = null;
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
