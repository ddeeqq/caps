import type { GameId } from './games/types';
import type { RoomPhase } from './protocol';

/**
 * 진행 멘트 카드: 처음 진행하는 사람도 리모컨에 뜬 말을 그대로 읽으면 되게 한다.
 * say = 소리 내어 읽을 말 (짧게, 말하듯), tip = 진행자만 보는 한 줄 (언제 누를지, 무엇을 볼지).
 * 진행 단계와 게임 안의 단계(hostView.stage)만 보고 고르므로 순수 함수로 둔다.
 */
export interface HostScript {
  say: string[];
  tip: string;
}

export interface HostScriptInput {
  phase: RoomPhase;
  gameId: GameId | null;
  /** 게임 진행 중일 때 hostView의 stage */
  stage?: string | null;
  /** 지금 게임이 마지막인지 (결과 화면 멘트가 달라진다) */
  last?: boolean;
  paused?: boolean;
}

const INTRO: Record<GameId, HostScript> = {
  nunchi: {
    say: ['이번 게임은 디지털 눈치게임이에요.', '폰 화면 전체가 버튼이에요. 같은 순간에 누르면 둘 다 벌칙!'],
    tip: '규칙은 화면에 떠 있어요. 짧게 읽고 바로 시작하세요.',
  },
  soundmate: {
    say: [
      '이번엔 소리 짝꿍이에요. 폰에서 동물 소리가 나요.',
      '같은 소리를 내는 사람을 찾아가서, 그 사람 QR을 찍으면 한 팀이 돼요.',
    ],
    tip: '소리가 안 들리면 무음 모드를 꺼 달라고 한 번 더 말해 주세요.',
  },
  vault: {
    say: [
      '팀별로 금고를 열어요. 팀원마다 폰에 보이는 정보가 달라요.',
      '화면은 보여 주면 안 되고, 말로만 합쳐야 해요.',
    ],
    tip: '팀이 아직 안 모였으면 같은 팀끼리 가까이 앉게 해 주세요.',
  },
  cardsection: {
    say: ['이번엔 카드섹션이에요. 모두의 폰이 모여 하나의 전광판이 돼요.', '화면 밝기를 최대로 올려 주세요.'],
    tip: '불을 끌 수 있으면 지금 끄세요. 연출이 훨씬 잘 보여요.',
  },
  minority: {
    say: [
      '소수결 서바이벌이에요. 더 많이 고른 쪽이 탈락해요.',
      '투표 전에 작전 타임이 있어요. 옆 사람과 짜도 돼요.',
    ],
    tip: '작전 타임에 사람들이 말을 섞도록 "누구랑 같이 갈래요?" 하고 부추겨 주세요.',
  },
  tiltrace: {
    say: ['군중 조종 레이스예요. 팀원 모두의 폰 기울기로 배 한 척을 움직여요.', '소리쳐서 방향을 맞추세요!'],
    tip: '폰에서 "기울기 센서 켜기"를 먼저 눌러 달라고 하세요. 안 되는 폰은 ◀ ▶ 버튼으로 참여해요.',
  },
};

const PLAYING: Record<GameId, Record<string, HostScript>> = {
  nunchi: {
    countdown: {
      say: ['곧 열려요. 손가락 준비!'],
      tip: '열리면 아무 말 안 해도 돼요. 화면이 알아서 판정해요.',
    },
    open: {
      say: ['지금이에요! 남이 안 누를 것 같은 순간에 누르세요.'],
      tip: '15초 동안 아무도 안 누르면 남은 사람 모두 벌칙이에요.',
    },
    roundEnd: {
      say: ['방금 겹친 두 사람, 몇 초 차이였는지 큰 화면을 보세요!'],
      tip: '벌칙 문구를 소리 내어 읽어 주면 웃음이 커져요.',
    },
  },
  soundmate: {
    search: {
      say: ['일어나서 돌아다니세요. 같은 소리를 찾으면 QR을 찍어요.', '모르는 사람에게 먼저 다가가 보세요.'],
      tip: '거의 다 모였는데 몇 팀이 헤매면 "찾기 마감"으로 넘기세요.',
    },
    mission: {
      say: ['다 모인 팀은 팀 미션을 풀어 주세요. 의견을 하나로 모아야 해요.'],
      tip: '대부분 끝났으면 "미션 마감"을 누르세요.',
    },
  },
  vault: {
    play: {
      say: ['팀원끼리 말로만 합쳐 보세요. 틀리면 3초 잠겨요.'],
      tip: '시간 안에 못 연 팀이 많으면 "금고 끝내기"로 정리하세요.',
    },
  },
  cardsection: {
    seat: {
      say: ['폰에서 지금 앉은 자리를 눌러 주세요. 위쪽이 큰 화면 쪽이에요.'],
      tip: '큰 화면에 자리가 거의 다 차면 "연출 시작"을 누르세요.',
    },
    show: {
      say: ['다 같이 폰을 머리 위로 들어 주세요!'],
      tip: '연출 40초 동안은 말을 아끼고 같이 보세요.',
    },
  },
  minority: {
    talk: {
      say: ['작전 타임이에요. 어느 쪽이 적을지 주변과 상의하세요.'],
      tip: '말이 없으면 "작전 타임 끝"으로 바로 투표로 넘어가도 돼요.',
    },
    vote: { say: ['이제 투표해요. 마감 직전까지 바꿀 수 있어요.'], tip: '시간이 끝나면 저절로 공개돼요.' },
    reveal: {
      say: ['적게 고른 쪽이 살아남았어요!'],
      tip: '탈락한 사람도 예언자로 계속 참여한다고 알려 주세요.',
    },
  },
  tiltrace: {
    countdown: { say: ['곧 출발해요. 폰을 수평으로 들어 주세요.'], tip: '' },
    race: {
      say: ['왼쪽! 오른쪽! 팀원끼리 소리쳐서 맞추세요.'],
      tip: '바위에 부딪힌 팀은 잠깐 느려져요. 응원을 보내 주세요.',
    },
  },
};

export function hostScript(input: HostScriptInput): HostScript {
  const { phase, gameId, stage, last, paused } = input;
  if (paused && phase !== 'lobby' && phase !== 'finished') {
    return {
      say: ['잠깐 멈출게요.'],
      tip: '다시 진행을 누르면 남은 시간 그대로 이어져요.',
    };
  }
  switch (phase) {
    case 'lobby':
      return {
        say: [
          '큰 화면의 QR을 폰 카메라로 찍어 주세요. 앱 설치는 필요 없어요.',
          '들어오면 지금 기분을 하나 골라 주세요.',
        ],
        tip: '입장 인원이 더 늘지 않으면 시작하기를 누르세요.',
      };
    case 'intro':
      return gameId ? INTRO[gameId] : { say: [], tip: '' };
    case 'playing': {
      const byStage = gameId ? PLAYING[gameId] : undefined;
      const s = (stage && byStage?.[stage]) || null;
      return s ?? { say: ['진행 중이에요. 큰 화면을 같이 봐 주세요.'], tip: '' };
    }
    case 'result':
      return last
        ? {
            say: ['마지막 게임까지 끝났어요. 큰 박수 한 번 주세요!'],
            tip: '마무리하기를 누르면 종료 설문이 폰에 떠요.',
          }
        : { say: ['결과 나왔어요. 1등 팀에 박수!'], tip: '박수가 잦아들면 다음 게임을 누르세요.' };
    case 'finished':
      return {
        say: [
          '마지막으로 폰의 질문 두 개에 답해 주세요. 익명이에요.',
          '오늘 같은 팀이었던 사람 이름이 폰에 남아요. 나가면서 한마디 더 걸어 보세요.',
        ],
        tip: '설문 응답 수가 큰 화면에 바로 반영돼요.',
      };
  }
}
