import { detectInApp, externalOpenUrl, IN_APP_NAMES, mobileOs } from '@caps/shared';
import { useState } from 'react';

const KEY = 'malmun:inapp-dismissed';

function dismissed(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 카카오톡·인스타그램 같은 앱 안 브라우저로 들어왔을 때 띄우는 안내.
 * 앱 안 브라우저는 카메라(QR), 기울기 센서, 화면 꺼짐 방지가 막혀 있거나 불안정해서
 * 기본 브라우저(사파리·크롬·삼성 인터넷)로 옮기도록 권한다. 그대로 해도 참여는 된다.
 */
export function InAppNotice() {
  const [hidden, setHidden] = useState(dismissed);
  const app = detectInApp(navigator.userAgent);
  if (!app || hidden) return null;
  const os = mobileOs(navigator.userAgent, navigator.maxTouchPoints, navigator.platform);
  const target = externalOpenUrl(window.location.href, app, os);
  const name = IN_APP_NAMES[app];
  const close = () => {
    setHidden(true);
    try {
      window.sessionStorage.setItem(KEY, '1');
    } catch {
      /* 저장 못 해도 이번 화면에서는 닫힌다 */
    }
  };
  return (
    <aside className="inapp" role="note" aria-label="브라우저 안내">
      <p className="inapp__text">
        <strong>{name} 안에서 열렸어요.</strong> QR 스캔·기울기 같은 기능이 막힐 수 있어서{' '}
        {os === 'ios' ? '사파리' : '크롬이나 삼성 인터넷'}에서 여는 걸 추천해요.
      </p>
      <div className="inapp__row">
        {target ? (
          <a className="btn btn--small btn--sun" href={target}>
            기본 브라우저로 열기
          </a>
        ) : (
          <span className="inapp__how">
            오른쪽 위 <b>⋯</b> 메뉴에서 <b>{os === 'ios' ? 'Safari로 열기' : '브라우저로 열기'}</b>를 눌러
            주세요
          </span>
        )}
        <button type="button" className="btn btn--small btn--quiet" onClick={close}>
          그냥 여기서 할게요
        </button>
      </div>
    </aside>
  );
}
