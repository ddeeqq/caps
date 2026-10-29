import type {
  CardsectionHostView,
  HostCommand,
  MinorityHostView,
  RoomState,
  SoundmateHostView,
  ViewEnvelope,
} from '@caps/shared';
import type { RoomClient } from '../lib/roomClient';

export interface HostAction {
  id: string;
  label: string;
  tone: 'primary' | 'sun' | 'plain';
  cmd: HostCommand;
  confirm?: string;
}

/** 지금 단계에서 진행자가 누를 수 있는 버튼들. 큰 화면 독과 폰 리모컨이 같이 쓴다 */
export function hostActions(
  room: RoomState | null,
  env: ViewEnvelope | null,
): { primary: HostAction | null; extra: HostAction[] } {
  if (!room) return { primary: null, extra: [] };
  const last = room.index + 1 >= room.flow.length;
  const extra: HostAction[] = [];
  let primary: HostAction | null = null;

  switch (room.phase) {
    case 'lobby':
      primary = { id: 'start', label: '시작하기', tone: 'primary', cmd: { type: 'start' } };
      // 혼자 시연하거나 사람이 모자랄 때: 서버 안의 가상 참가자로 빈자리를 채운다
      extra.push({ id: 'add-bots', label: '봇 5명 넣기', tone: 'plain', cmd: { type: 'addBots', count: 5 } });
      if (room.botCount > 0) {
        extra.push({
          id: 'clear-bots',
          label: `봇 빼기 (${room.botCount})`,
          tone: 'plain',
          cmd: { type: 'clearBots' },
        });
      }
      break;
    case 'intro':
      primary = { id: 'go', label: '게임 시작', tone: 'primary', cmd: { type: 'next' } };
      break;
    case 'playing': {
      if (env?.gameId === 'cardsection') {
        const v = env.view as CardsectionHostView;
        if (v.stage === 'seat') {
          primary = {
            id: 'show',
            label: '연출 시작',
            tone: 'primary',
            cmd: { type: 'game', action: 'start-show' },
          };
        }
      } else if (env?.gameId === 'soundmate') {
        const v = env.view as SoundmateHostView;
        if (v.stage === 'search') {
          extra.push({
            id: 'end-search',
            label: '찾기 마감',
            tone: 'sun',
            cmd: { type: 'game', action: 'end-search' },
            confirm: '아직 못 모인 팀도 지금 팀으로 합류시킬까요?',
          });
        } else if (v.stage === 'mission') {
          extra.push({
            id: 'end-missions',
            label: '미션 마감',
            tone: 'sun',
            cmd: { type: 'game', action: 'end-missions' },
          });
        }
      } else if (env?.gameId === 'minority') {
        const v = env.view as MinorityHostView;
        if (v.stage === 'talk')
          extra.push({
            id: 'skip-talk',
            label: '작전 타임 끝',
            tone: 'sun',
            cmd: { type: 'game', action: 'skip-talk' },
          });
      } else if (env?.gameId === 'vault') {
        extra.push({
          id: 'finish-vault',
          label: '금고 끝내기',
          tone: 'plain',
          cmd: { type: 'game', action: 'finish-now' },
          confirm: '진행 중인 금고를 모두 끝낼까요?',
        });
      }
      extra.push({
        id: 'end-game',
        label: '이 게임 끝내기',
        tone: 'plain',
        cmd: { type: 'next' },
        confirm: '지금 게임을 끝내고 결과를 보여줄까요?',
      });
      break;
    }
    case 'result':
      primary = {
        id: 'next',
        label: last ? '마무리하기' : '다음 게임',
        tone: 'primary',
        cmd: { type: 'next' },
      };
      break;
    case 'finished':
      break;
  }

  if (room.phase !== 'lobby' && room.phase !== 'finished') {
    if (room.paused) {
      // 멈춘 동안에는 "다시 진행"이 큰 버튼(Space)이 된다. 원래 큰 버튼은 옆으로 비킨다
      if (primary) extra.unshift({ ...primary, tone: 'plain' });
      primary = { id: 'resume', label: '다시 진행', tone: 'primary', cmd: { type: 'resume' } };
    } else {
      extra.push({ id: 'pause', label: '일시정지', tone: 'plain', cmd: { type: 'pause' } });
    }
    extra.push({
      id: 'skip',
      label: '건너뛰기',
      tone: 'plain',
      cmd: { type: 'skip' },
      confirm: '이 게임을 건너뛸까요?',
    });
    extra.push({
      id: 'end',
      label: '모두 끝내기',
      tone: 'plain',
      cmd: { type: 'end' },
      confirm: '세션을 끝내고 마지막 설문으로 넘어갈까요?',
    });
  }
  return { primary, extra };
}

export type ConfirmFn = (message: string) => Promise<boolean>;

/** 폰(리모컨)은 브라우저 기본 확인 창을 쓴다 */
export const nativeConfirm: ConfirmFn = (message) => Promise.resolve(window.confirm(message));

/**
 * 버튼 동작을 실행한다. 확인이 필요한 동작은 confirm으로 먼저 묻는다.
 * 큰 화면은 기본 확인 창을 쓰면 전체 화면이 풀리므로 화면 안의 확인 창을 넘겨준다.
 */
export async function runAction(
  client: RoomClient,
  action: HostAction,
  confirm: ConfirmFn = nativeConfirm,
): Promise<string | null> {
  if (action.confirm && !(await confirm(action.confirm))) return null;
  const res = await client.command(action.cmd);
  return res.ok ? null : res.message;
}
