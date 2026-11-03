/**
 * 앱 안 브라우저(카카오톡, 인스타그램, 네이버 등) 알아보기와 "기본 브라우저로 열기" 주소.
 * QR을 카메라로 찍으면 기본 브라우저가 열리지만, 링크를 단톡방에 공유하면 카카오톡 안에서 열린다.
 * 앱 안 브라우저는 카메라·기울기 센서·화면 꺼짐 방지가 막혀 있는 경우가 많아서 밖으로 안내한다.
 */
export type InAppBrowser =
  'kakaotalk' | 'instagram' | 'facebook' | 'naver' | 'line' | 'daum' | 'band' | 'everytime' | 'webview';

export type MobileOs = 'ios' | 'android' | 'other';

export const IN_APP_NAMES: Record<InAppBrowser, string> = {
  kakaotalk: '카카오톡',
  instagram: '인스타그램',
  facebook: '페이스북',
  naver: '네이버 앱',
  line: '라인',
  daum: '다음 앱',
  band: '밴드',
  everytime: '에브리타임',
  webview: '앱',
};

export function mobileOs(ua: string, maxTouchPoints = 0, platform = ''): MobileOs {
  if (/android/i.test(ua)) return 'android';
  if (/iP(hone|ad|od)/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
  return 'other';
}

export function detectInApp(ua: string): InAppBrowser | null {
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook';
  if (/NAVER\(inapp|NAVER\//i.test(ua)) return 'naver';
  if (/\bLine\//i.test(ua)) return 'line';
  if (/DaumApps/i.test(ua)) return 'daum';
  if (/BAND\//i.test(ua)) return 'band';
  if (/everytime/i.test(ua)) return 'everytime';
  // 안드로이드 웹뷰 표시 (크롬·삼성 인터넷 자체에는 없다)
  if (/Android/i.test(ua) && /; wv\)/.test(ua)) return 'webview';
  return null;
}

/**
 * 기본 브라우저로 여는 주소. 만들 수 없으면 null (아이폰의 인스타그램·네이버 등은 메뉴로 안내).
 * - 카카오톡: 아이폰·안드로이드 모두 kakaotalk://web/openExternal
 * - 라인: openExternalBrowser=1 쿼리
 * - 그 밖의 안드로이드 앱: intent:// 로 기본 브라우저, 실패하면 같은 주소로
 */
export function externalOpenUrl(url: string, app: InAppBrowser, os: MobileOs): string | null {
  if (app === 'kakaotalk') return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  if (app === 'line') {
    const u = new URL(url);
    u.searchParams.set('openExternalBrowser', '1');
    return u.toString();
  }
  if (os === 'android') {
    const u = new URL(url);
    const scheme = u.protocol.replace(':', '');
    return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${scheme};S.browser_fallback_url=${encodeURIComponent(url)};end`;
  }
  return null;
}
