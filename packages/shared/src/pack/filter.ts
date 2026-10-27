/**
 * 닉네임과 팩 입력에 거는 최소한의 금칙어 필터.
 * 완벽한 필터가 목적이 아니라, 큰 화면에 그대로 뜨는 사고를 막는 1차 방어선이다.
 */
const BANNED = [
  '시발',
  '씨발',
  '씨바',
  'ㅅㅂ',
  'ㅆㅂ',
  '병신',
  'ㅂㅅ',
  '개새',
  '좆',
  '존나',
  'ㅈㄴ',
  '지랄',
  '닥쳐',
  '꺼져',
  'fuck',
  'shit',
  'bitch',
  'asshole',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\s\p{P}\p{S}0-9_]+/gu, '');
}

export function containsProfanity(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  return BANNED.some((w) => n.includes(w));
}

/** 공백 정리 + 길이 제한 */
export function cleanText(text: string, maxLength: number): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, maxLength).join('');
}
