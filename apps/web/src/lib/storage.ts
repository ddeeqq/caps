/** localStorage는 사생활 보호 모드에서 예외를 던질 수 있어 항상 감싼다 */
export const local = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* 저장 못 해도 진행에는 문제없다 */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
};

export const keys = {
  player: (code: string) => `malmun:player:${code}`,
  host: (code: string) => `malmun:host:${code}`,
  packEdit: (code: string) => `malmun:pack:${code}`,
  nickname: 'malmun:nickname',
  lastPreset: 'malmun:preset',
  scriptHidden: 'malmun:script-hidden',
};
