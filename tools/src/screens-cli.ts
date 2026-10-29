/**
 * 화면 캡처 도구: 봇들이 게임 전체를 하는 동안 큰 화면과 폰 화면을 단계별로 찍는다.
 * 발표 자료용 스크린샷과 화면 점검(시각 회귀 확인)에 쓴다.
 *
 *   pnpm build && pnpm start          # 서버가 빌드된 웹 앱을 함께 제공
 *   pnpm screens --out screenshots    # 다른 터미널에서
 *
 * 옵션: --url 서버(기본 http://localhost:3001), --web 웹 주소(기본 = url), --bots 봇 수(기본 9),
 *       --phone 폰 화면 크기(기본 390x844). 가로 모드는 844x390, 갤럭시 폴드 겉화면 344x882, 펼친 화면 690x830
 * 크롬: CHROME_PATH 환경 변수, 없으면 playwright 기본 경로
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  CardsectionHostView,
  GameId,
  MinorityHostView,
  NunchiHostView,
  RoomState,
  SoundmateHostView,
  TiltraceHostView,
  VaultHostView,
} from '@caps/shared';
import { chromium, type Page } from 'playwright-core';
import { arg } from './args';
import { AutoHost, Bot, BotHub, sleep } from './bot';

const url = arg('url', 'http://localhost:3001');
const web = arg('web', url);
const out = path.resolve(arg('out', 'screenshots'));
const botCount = Number(arg('bots', '9'));
const [phoneW, phoneH] = arg('phone', '390x844').split('x').map(Number) as [number, number];
const executablePath = process.env.CHROME_PATH || undefined;

let shot = 0;
async function snap(page: Page, name: string): Promise<void> {
  shot += 1;
  const file = path.join(out, `${String(shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.basename(file)}`);
}

async function until(label: string, pred: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (pred()) return;
    await sleep(100);
  }
  throw new Error(`기다리다 시간 초과: ${label}`);
}

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const desktop = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
  });
  const mobile = await browser.newContext({
    viewport: { width: phoneW, height: phoneH },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
  });
  const screen = await desktop.newPage();
  const phone = await mobile.newPage();
  for (const p of [screen, phone]) p.on('pageerror', (e) => console.error(`  ⚠️ 페이지 오류: ${e.message}`));

  console.log('정적 화면');
  await screen.goto(`${web}/`);
  await sleep(800);
  await snap(screen, 'home-desktop');
  await phone.goto(`${web}/`);
  await sleep(800);
  await snap(phone, 'home-phone');
  await screen.goto(`${web}/host/new`);
  await sleep(600);
  await snap(screen, 'host-new');
  await screen.goto(`${web}/pack/new`);
  await screen.fill('.chips__input >> nth=0', '지훈,민수,수빈,');
  await screen.fill('.chips__input >> nth=1', '단골집,제주도,노래방,야식,');
  await sleep(1_200);
  await snap(screen, 'pack-editor');
  await phone.goto(`${web}/sync`);
  await sleep(1_800);
  await snap(phone, 'sync-test');

  console.log('방 만들기');
  const flow: GameId[] = ['nunchi', 'soundmate', 'vault', 'cardsection', 'minority', 'tiltrace'];
  const host = new AutoHost({
    url,
    create: {
      preset: 'friends',
      flow,
      packName: '3팀 회식',
      inlinePack: {
        names: ['지훈', '민수', '수빈', '하나'],
        keywords: ['단골집', '제주도', '노래방', '야식'],
        finaleText: '3팀 화이팅',
      },
      settings: {
        nunchiRounds: 1,
        soundmateSeconds: 30,
        missionSeconds: 8,
        vaultSafes: 1,
        seatRows: 3,
        seatCols: 5,
        cardsectionMs: 16_000,
        minorityRounds: 1,
        minorityTalkSeconds: 6,
        minorityVoteSeconds: 4,
        tiltraceLength: 12,
      },
    },
    waitForPlayers: 9999,
  });
  const { code, hostToken } = await host.create();
  console.log(`  방 ${code}`);
  await screen.goto(`${web}/host/${code}#t=${hostToken}`);
  await phone.goto(`${web}/play/${code}`);
  await phone.fill('input.input', '캡처폰');
  await snap(phone, 'join');
  await phone.click('button.btn--primary');
  await phone.waitForSelector('.p-lobby');

  const hub = new BotHub();
  const bots: Bot[] = [];
  for (let i = 0; i < botCount; i++) {
    const bot = new Bot({ url, code, hub, speed: 0.6, chatty: true });
    await bot.join();
    bots.push(bot);
    await sleep(120);
  }
  await phone.click('.scale__item >> nth=3');
  await sleep(1_500);
  await snap(screen, 'lobby');
  await snap(phone, 'phone-lobby');

  const room = () => host.room as RoomState;
  const view = <T>() => host.view?.view as T;
  const step = async (label: string, phase: RoomState['phase'], gameId?: GameId) => {
    await host.command({ type: 'next' });
    await until(label, () => room().phase === phase && (!gameId || room().gameId === gameId));
    await sleep(700);
  };

  // ① 눈치게임
  console.log('눈치게임');
  await host.command({ type: 'start' });
  await until('눈치 소개', () => room().phase === 'intro');
  await sleep(800);
  await snap(screen, 'nunchi-intro');
  await snap(phone, 'phone-nunchi-intro');
  await step('눈치 시작', 'playing', 'nunchi');
  await snap(screen, 'nunchi-countdown');
  await snap(phone, 'phone-nunchi-countdown');
  await until('버튼 열림', () => view<NunchiHostView>()?.stage === 'open');
  await sleep(400);
  await phone.locator('.big-tap').dispatchEvent('pointerdown');
  await sleep(1_300);
  await snap(screen, 'nunchi-open');
  await snap(phone, 'phone-nunchi-tapped');
  await until('라운드 끝', () => view<NunchiHostView>()?.stage === 'roundEnd', 25_000);
  await sleep(700);
  await snap(screen, 'nunchi-outcome');
  await snap(phone, 'phone-nunchi-verdict');
  await until('눈치 결과', () => room().phase === 'result', 15_000);
  await sleep(800);
  await snap(screen, 'nunchi-result');

  // ② 소리 짝꿍
  console.log('소리 짝꿍');
  await step('소리 소개', 'intro', 'soundmate');
  await snap(phone, 'phone-soundmate-intro');
  await step('소리 시작', 'playing', 'soundmate');
  await sleep(1_500);
  await snap(phone, 'phone-soundmate');
  await phone.click('text=내 QR 보여주기');
  await sleep(600);
  await snap(phone, 'phone-soundmate-qr');
  await phone.click('.sheet .btn--small');
  await until(
    '팀 완성',
    () => (view<SoundmateHostView>()?.teams.filter((t) => t.complete).length ?? 0) >= 1,
    20_000,
  );
  await sleep(2_500);
  await snap(screen, 'soundmate-search');
  await host.command({ type: 'game', action: 'end-search' });
  await sleep(1_500);
  await snap(phone, 'phone-soundmate-team');
  await phone.locator('.choice').first().click();
  await sleep(2_500);
  await snap(screen, 'soundmate-missions');
  await until('소리 결과', () => room().phase === 'result', 20_000);

  // ③ 금고
  console.log('금고 따기');
  await step('금고 소개', 'intro', 'vault');
  await step('금고 시작', 'playing', 'vault');
  await sleep(2_000);
  const peek = phone.locator('.peek');
  if (await peek.count()) {
    const box = await peek.boundingBox();
    if (box) {
      await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await phone.mouse.down();
      await sleep(300);
      await snap(phone, 'phone-vault-peek');
      await phone.mouse.up();
    }
  } else {
    await snap(phone, 'phone-vault-input');
  }
  await sleep(2_500);
  await snap(screen, 'vault');
  await host.command({ type: 'game', action: 'finish-now' });
  await until('금고 결과', () => room().phase === 'result', 10_000);
  await sleep(700);
  await snap(screen, 'vault-result');

  // ④ 카드섹션
  console.log('카드섹션');
  await step('카드 소개', 'intro', 'cardsection');
  await step('카드 시작', 'playing', 'cardsection');
  await phone.locator('.seat:not(.is-taken)').first().click();
  await sleep(3_000);
  await snap(phone, 'phone-seat');
  await snap(screen, 'cardsection-seat');
  await host.command({ type: 'game', action: 'start-show' });
  await until('연출 예약', () => !!view<CardsectionHostView>()?.show);
  const startAt = view<CardsectionHostView>().show!.startAt;
  const waitShow = async (ms: number) => {
    const target = startAt + ms;
    while (host.clock.serverNow() - host.room!.timeBase < target) await sleep(30);
  };
  await waitShow(2_600);
  await snap(screen, 'cardsection-wave');
  await snap(phone, 'phone-show-wave');
  await waitShow(7_600);
  await snap(screen, 'cardsection-teams');
  await waitShow(10_500);
  await snap(screen, 'cardsection-message');
  await snap(phone, 'phone-show-message');
  await until('카드 결과', () => room().phase === 'result', 20_000);

  // 추가: 소수결
  console.log('소수결 서바이벌');
  await step('소수결 소개', 'intro', 'minority');
  await step('소수결 시작', 'playing', 'minority');
  await phone.locator('.choice').first().click();
  await sleep(1_200);
  await snap(screen, 'minority-talk');
  await snap(phone, 'phone-minority');
  await until('소수결 공개', () => view<MinorityHostView>()?.stage === 'reveal', 20_000);
  await sleep(900);
  await snap(screen, 'minority-reveal');
  await until('소수결 결과', () => room().phase === 'result', 20_000);

  // 추가: 레이스
  console.log('군중 조종 레이스');
  await step('레이스 소개', 'intro', 'tiltrace');
  await snap(phone, 'phone-race-intro');
  await step('레이스 시작', 'playing', 'tiltrace');
  await until('레이스 출발', () => view<TiltraceHostView>()?.stage === 'race', 10_000);
  await sleep(3_000);
  await snap(screen, 'race');
  await snap(phone, 'phone-race');
  await until('레이스 결과', () => room().phase === 'result', 40_000);

  // 마무리
  console.log('마무리');
  await host.command({ type: 'next' });
  await until('종료', () => room().phase === 'finished');
  await sleep(1_000);
  await snap(phone, 'phone-end-survey');
  await phone.locator('.scale--wide .scale__item').nth(2).click();
  await phone.locator('.scale:not(.scale--wide) .scale__item').nth(4).click();
  await phone.click('text=보내기');
  await sleep(3_500);
  await snap(screen, 'final-report');
  await snap(phone, 'phone-thanks');
  const reportId = host.room?.report?.id;
  if (reportId) {
    await screen.goto(`${web}/report/${reportId}`);
    await sleep(1_200);
    await snap(screen, 'report-page');
  }

  for (const b of bots) b.stop();
  host.stop();
  await browser.close();
  console.log(`\n완료: ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
