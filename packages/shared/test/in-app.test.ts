import { describe, expect, it } from 'vitest';
import { detectInApp, externalOpenUrl, mobileOs } from '../src/util/inApp';

const UA = {
  kakaoIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0',
  kakaoAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36;KAKAOTALK 2410800',
  instaIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0',
  naverAndroid:
    'Mozilla/5.0 (Linux; Android 13; SM-F946N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.4.0)',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-F956N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

describe('앱 안 브라우저 알아보기', () => {
  it('카카오톡·인스타그램·네이버는 앱 안, 사파리·크롬·삼성 인터넷은 아니다', () => {
    expect(detectInApp(UA.kakaoIos)).toBe('kakaotalk');
    expect(detectInApp(UA.kakaoAndroid)).toBe('kakaotalk');
    expect(detectInApp(UA.instaIos)).toBe('instagram');
    expect(detectInApp(UA.naverAndroid)).toBe('naver');
    expect(detectInApp(UA.samsung)).toBeNull();
    expect(detectInApp(UA.chromeAndroid)).toBeNull();
    expect(detectInApp(UA.safari)).toBeNull();
  });

  it('운영체제: 갤럭시는 안드로이드, 아이패드는 맥처럼 보여도 iOS', () => {
    expect(mobileOs(UA.samsung)).toBe('android');
    expect(mobileOs(UA.safari)).toBe('ios');
    expect(mobileOs(UA.ipad, 5, 'MacIntel')).toBe('ios');
    expect(mobileOs(UA.ipad, 0, 'MacIntel')).toBe('other');
  });

  it('기본 브라우저로 여는 주소', () => {
    const url = 'https://malmun.example/play/ABCD?x=1';
    expect(externalOpenUrl(url, 'kakaotalk', 'ios')).toBe(
      `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`,
    );
    expect(externalOpenUrl(url, 'naver', 'android')).toBe(
      `intent://malmun.example/play/ABCD?x=1#Intent;scheme=https;S.browser_fallback_url=${encodeURIComponent(url)};end`,
    );
    expect(externalOpenUrl(url, 'line', 'ios')).toContain('openExternalBrowser=1');
    expect(externalOpenUrl(url, 'instagram', 'ios')).toBeNull();
  });
});
