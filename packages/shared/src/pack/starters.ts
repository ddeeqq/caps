import type { GameId } from '../games/types';
import type { BalanceQuestion, PackContent, PresetId } from './types';

/**
 * 모임 종류별 시작 팩. 방 만들기에서 하나 고르면 모임 성격, 키워드, 질문, 벌칙,
 * 마지막 문구, 추천 순서가 한 번에 채워진다. 진행자는 이름 몇 개만 더하면 된다.
 */
export interface PackStarter {
  id: 'freshman-ot' | 'onboarding' | 'workshop' | 'first-class';
  label: string;
  description: string;
  preset: PresetId;
  packName: string;
  flow: GameId[];
  content: Pick<PackContent, 'keywords' | 'balanceQuestions' | 'finaleText' | 'penalties'>;
}

const q = (a: string, b: string, prompt = '하나만 고른다면?'): BalanceQuestion => ({ prompt, a, b });

export const PACK_STARTERS: readonly PackStarter[] = [
  {
    id: 'freshman-ot',
    label: '신입생 OT',
    description: '처음 보는 동기들. 학교생활 공감 질문으로',
    preset: 'class',
    packName: '신입생 OT',
    flow: ['nunchi', 'soundmate', 'vault', 'cardsection'],
    content: {
      keywords: ['학식', '도서관', '기숙사', '동아리방', '시간표', '중간고사'],
      balanceQuestions: [
        q('1교시 수업', '저녁 수업', '시간표를 짠다면?'),
        q('학식', '배달', '점심은?'),
        q('도서관', '카페', '공부는?'),
        q('조별 과제', '개인 과제'),
        q('MT 무조건 간다', '사진으로만 본다', 'MT는?'),
        q('과대 하기', '과대 돕기', '둘 중 하나만?'),
      ],
      finaleText: '우리 동기 화이팅',
      penalties: ['다음 판 첫 순서', '모두에게 박수 받기', '오늘의 눈치왕 칭호 획득'],
    },
  },
  {
    id: 'onboarding',
    label: '회사 온보딩',
    description: '새로 합류한 사람과 기존 팀원이 섞이도록',
    preset: 'work',
    packName: '신규 입사자 온보딩',
    flow: ['nunchi', 'soundmate', 'vault', 'minority', 'cardsection'],
    content: {
      keywords: ['사원증', '온보딩', '회의실', '사내 메신저', '점심 메뉴', '연차'],
      balanceQuestions: [
        q('재택', '출근', '일하기 좋은 날은?'),
        q('점심 같이', '점심 혼자'),
        q('메일', '메신저', '업무 연락은?'),
        q('오전 집중', '오후 집중'),
        q('회식 1차만', '끝까지', '회식은?'),
        q('모니터 2대', '노트북 하나', '책상은?'),
      ],
      finaleText: '합류를 환영해요',
      penalties: ['다음 판 첫 순서', '모두에게 박수 받기', '오늘의 눈치왕 칭호 획득'],
    },
  },
  {
    id: 'workshop',
    label: '워크숍·팀빌딩',
    description: '이미 아는 팀. 일하는 방식 이야기로',
    preset: 'work',
    packName: '팀 워크숍',
    flow: ['nunchi', 'soundmate', 'vault', 'tiltrace', 'cardsection'],
    content: {
      keywords: ['마감', '회고', '스프린트', '화이트보드', '아이디어', '데모'],
      balanceQuestions: [
        q('아이디어 많이', '하나를 깊게', '회의에서는?'),
        q('짧은 회의 자주', '긴 회의 한 번'),
        q('마감 일찍', '마감 직전', '일이 끝나는 때는?'),
        q('문서로 정리', '말로 정리', '결정은?'),
        q('새 도구 써 보기', '익숙한 도구', '이번 프로젝트는?'),
        q('워크숍 1박', '당일치기', '다음 워크숍은?'),
      ],
      finaleText: '우리 팀 최고',
      penalties: ['다음 판 첫 순서', '모두에게 박수 받기', '오늘의 눈치왕 칭호 획득'],
    },
  },
  {
    id: 'first-class',
    label: '수업 첫 주',
    description: '한 학기 같이 갈 수강생끼리 얼굴 익히기',
    preset: 'class',
    packName: '수업 첫 주',
    flow: ['nunchi', 'soundmate', 'minority', 'cardsection'],
    content: {
      keywords: ['출석', '과제', '강의실', '팀플', '퀴즈', '기말고사'],
      balanceQuestions: [
        q('앞자리', '뒷자리', '강의실에서는?'),
        q('손 필기', '노트북 필기'),
        q('과제 미리', '과제 몰아서'),
        q('수업 중 질문', '끝나고 질문'),
        q('팀플 리더', '팀플 자료 조사', '맡는다면?'),
        q('시험 전날 밤샘', '시험 당일 새벽', '벼락치기는?'),
      ],
      finaleText: '한 학기 잘 부탁해요',
      penalties: ['다음 판 첫 순서', '모두에게 박수 받기', '오늘의 눈치왕 칭호 획득'],
    },
  },
];
