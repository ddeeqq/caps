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
  /** 한 판 더로 옮겨 가는 새 방: 닉네임 화면 없이 바로 들어간다 */
  autoJoin: (code: string) => `malmun:auto:${code}`,
  packEdit: (code: string) => `malmun:pack:${code}`,
  nickname: 'malmun:nickname',
  lastPreset: 'malmun:preset',
  scriptHidden: 'malmun:script-hidden',
};
