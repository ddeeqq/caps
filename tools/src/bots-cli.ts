/**
 * 가짜 참가자 봇 실행기
 *
 *   pnpm bots --count 20                      # 방을 새로 만들고 자동 진행 (데모)
 *   pnpm bots --count 20 --fast               # 짧은 설정으로 빠르게 한 바퀴
 *   pnpm bots --room ABCD --count 15          # 이미 있는 방에 봇만 넣기 (진행은 사람이)
 *   pnpm bots --flow nunchi,minority --count 8
 *
 * 옵션: --url 서버 주소(기본 http://localhost:3001), --web 웹 주소(개발 중엔 http://localhost:5173),
 *       --preset friends|work|class, --speed 반응 속도 배율, --no-auto 자동 진행 끄기
 */
import { DEFAULT_FLOW, GAME_IDS, GAME_META, NEW_PEOPLE_BUCKETS, type GameId, type PresetId } from '@caps/shared';
import { arg, flag } from './args';
import { AutoHost, Bot, BotHub, FAST_SETTINGS, sleep } from './bot';

const url = arg('url', 'http://localhost:3001');
const web = arg('web', url);
const count = Number(arg('count', '12'));
const existingRoom = arg('room');
const fast = flag('fast');
const speed = Number(arg('speed', fast ? '0.5' : '1'));
const preset = arg('preset', 'friends') as PresetId;
const flow = arg('flow', DEFAULT_FLOW.join(','))
  .split(',')
  .filter((id): id is GameId => (GAME_IDS as readonly string[]).includes(id));
const auto = !existingRoom && !flag('no-auto');

async function main() {
  let code = existingRoom?.toUpperCase();
  let host: AutoHost | null = null;

  if (!code) {
    host = new AutoHost({
      url,
      create: {
        preset,
        flow,
        packName: '봇 데모 팩',
        inlinePack: {
          names: ['지훈', '민수', '수빈', '하나'],
          keywords: ['단골집', '제주도', '노래방', '야식'],
          finaleText: '봇들도 수고했어요',
        },
        ...(fast ? { settings: FAST_SETTINGS } : {}),
      },
      waitForPlayers: count,
      onPhase: (s) => {
        const name = s.gameId ? GAME_META[s.gameId].title : '';
        console.log(`  [${new Date().toLocaleTimeString()}] ${s.phase}${name ? ` · ${name}` : ''} (참가 ${s.playerCount}명)`);
      },
    });
    const created = await host.create();
    code = created.code;
    console.log(`\n방 코드: ${code}`);
    console.log(`큰 화면으로 보기: ${web}/host/${code}#t=${created.hostToken}`);
    console.log(`리모컨 PIN: ${created.hostPin}\n`);
    if (auto) host.run();
  }

  const hub = new BotHub();
  const bots: Bot[] = [];
  for (let i = 0; i < count; i++) {
    const bot = new Bot({ url, code, hub, speed, chatty: true });
    await bot.join();
    bots.push(bot);
    await sleep(40);
  }
  console.log(`봇 ${count}명 입장 완료: ${bots.map((b) => b.nickname).join(', ')}\n`);

  const stop = () => {
    for (const b of bots) b.stop();
    host?.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);

  if (host && auto) {
    const final = await host.untilFinished(60 * 60_000);
    await sleep(3_000); // 종료 설문이 모일 시간
    const report = host.room?.report ?? final.report;
    console.log('\n── 세션 결과 ──');
    for (const g of report?.games ?? []) console.log(`· ${g.title}: ${g.headline}`);
    if (report) {
      const s = report.survey;
      console.log(`\n참여 유지율 ${report.retention}% · 대면 연결 ${report.metrics.faceToFace}회 · 리액션 ${report.metrics.reactions}개`);
      console.log(`편안함 ${s.lobby.avg ?? '-'} → ${s.end.avg ?? '-'}`);
      console.log(
        `새로 대화한 사람: ${s.end.newPeople.map((n, i) => `${NEW_PEOPLE_BUCKETS[i]} ${n}명`).join(', ')}`,
      );
    }
    stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
