import type { BalanceQuestion, PresetId } from './types';

export interface PresetDef {
  id: PresetId;
  label: string;
  description: string;
  /** 인물 비교 질문 기본값 */
  personCompare: boolean;
  /** 인물 이름을 어디에 쓸지: 질문과 금고 모두 / 금고만 / 안 씀 */
  namesUsage: 'all' | 'vault' | 'none';
  finaleText: string;
  penalties: string[];
  questions: BalanceQuestion[];
}

const q = (a: string, b: string, prompt = '하나만 고른다면?'): BalanceQuestion => ({ prompt, a, b });

/** 누구에게 물어도 무난한 기본 밸런스 질문 */
export const COMMON_QUESTIONS: BalanceQuestion[] = [
  q('부먹', '찍먹', '탕수육은?'),
  q('짜장', '짬뽕'),
  q('여름', '겨울'),
  q('산', '바다', '휴가는?'),
  q('아침형 인간', '저녁형 인간'),
  q('카톡', '전화', '급한 연락은?'),
  q('강아지', '고양이'),
  q('민트초코 좋아', '민트초코 싫어'),
  q('계획형 여행', '즉흥 여행'),
  q('밀떡', '쌀떡', '떡볶이는?'),
  q('팥붕', '슈붕', '붕어빵은?'),
  q('영화관', '집에서 OTT'),
  q('아이스 아메리카노', '따뜻한 라떼'),
  q('답장 바로', '답장 몰아서'),
  q('평생 라면 끊기', '평생 치킨 끊기'),
  q('엘리베이터', '계단', '3층까지라면?'),
  q('창가 자리', '통로 자리', '비행기에서는?'),
  q('불꽃놀이', '별 보기', '밤 데이트는?'),
];

export const PRESETS: Record<PresetId, PresetDef> = {
  friends: {
    id: 'friends',
    label: '친구',
    description: '장난스럽게, 내부 밈과 이름까지 다 쓰는 모임',
    personCompare: true,
    namesUsage: 'all',
    finaleText: '우리 우정 영원히',
    penalties: ['다음 모임 장소 정하기', '단체 사진 찍사 당첨', '다음 판 첫 순서', '오늘의 눈치왕 칭호 획득'],
    questions: [
      ...COMMON_QUESTIONS,
      q('1년 동안 연락 끊기', '1년 동안 매일 만나기', '우리끼리라면?'),
      q('노래방 2시간', 'PC방 2시간', '2차는?'),
    ],
  },
  work: {
    id: 'work',
    label: '직장·워크숍',
    description: '무난하게, 사생활 질문 없이. 이름은 금고 기호에만',
    personCompare: false,
    namesUsage: 'vault',
    finaleText: '오늘도 수고했어요',
    penalties: ['다음 판 첫 순서', '모두에게 박수 받기', '오늘의 눈치왕 칭호 획득'],
    questions: [
      ...COMMON_QUESTIONS,
      q('회의 30분 일찍 시작', '회의 30분 늦게 끝', '차라리?'),
      q('메신저', '대면 보고', '선호하는 소통은?'),
    ],
  },
  class: {
    id: 'class',
    label: '수업·동아리',
    description: '처음 보는 사이 기준. 공통점 찾기 위주',
    personCompare: false,
    namesUsage: 'none',
    finaleText: '반가웠어요',
    penalties: ['다음 판 첫 순서', '모두에게 박수 받기', '오늘의 눈치왕 칭호 획득'],
    questions: [...COMMON_QUESTIONS, q('조별 과제 리더', '조별 과제 자료 조사', '맡는다면?')],
  },
};

/** 인물 비교 질문 (친구 프리셋 전용). 놀림으로 번지지 않게 긍정·중립 문장만 둔다. */
export const PERSON_COMPARE_PROMPTS = [
  '먼저 연락할 것 같은 사람은?',
  '여행 계획을 짤 것 같은 사람은?',
  '맛집을 더 많이 알 것 같은 사람은?',
  '노래방에서 마이크를 먼저 잡을 것 같은 사람은?',
  '길을 잃어도 웃고 있을 것 같은 사람은?',
  '선물을 더 잘 고를 것 같은 사람은?',
  '사진을 더 잘 찍어줄 것 같은 사람은?',
];

/** 한 사람의 취향을 맞히는 템플릿 (친구 프리셋 전용) */
export const PERSON_TASTE_PROMPT = '{name:이/가} 더 좋아할 것 같은 쪽은?';

/** 키워드 두 개로 만드는 템플릿 */
export const KEYWORD_PROMPTS = ['하나만 고른다면?', '오늘 더 끌리는 쪽은?', '평생 하나만 남긴다면?'];

/** 이름·키워드가 부족할 때 금고 기호를 채우는 기본 단어 */
export const DEFAULT_VAULT_SYMBOLS = [
  '빨간 별',
  '파란 달',
  '노란 해',
  '초록 나무',
  '보라 구름',
  '주황 번개',
  '하늘 물방울',
  '분홍 하트',
  '하얀 눈송이',
  '검은 고양이',
  '금색 열쇠',
  '은색 종',
  '갈색 곰',
  '회색 바위',
];
