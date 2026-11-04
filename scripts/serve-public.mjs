#!/usr/bin/env node
/**
 * 내 노트북에서 말문을 띄우고, 폰이 들어올 수 있는 HTTPS 주소까지 한 번에 만든다.
 *
 *   pnpm serve:public            빌드 → 서버 → Cloudflare 무료 터널 (HTTPS, 가입 필요 없음)
 *   pnpm serve:public --no-build 빌드 건너뛰기 (이미 빌드했으면 빠르다)
 *   pnpm serve:public --lan      터널 없이 같은 와이파이로만 (http, 카메라·기울기 센서는 안 됨)
 *   pnpm serve:public --port 4000
 *
 * 터널은 컴퓨터에 설치된 cloudflared를 쓰고, 없으면 npx로 받아서 쓴다.
 * 기록(팩, 리포트, 진행 중인 방)은 이 컴퓨터의 apps/server/data 에 남는다.
 * Ctrl+C로 끄면 진행 중인 방을 저장하고 끝난다 (다시 켜면 이어서 할 수 있다).
 */
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const port = Number(opt('port', '3001'));
const win = process.platform === 'win32';
const children = [];

const say = (msg = '') => console.log(msg);
const line = () => say('─'.repeat(60));

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function hasCommand(cmd) {
  const r = spawnSync(win ? 'where' : 'which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

function shutdown(code = 0) {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  // 서버가 방을 저장할 시간을 준다
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on('SIGINT', () => {
  say('\n끄는 중… 진행 중인 방을 저장해요');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function printReady(base, https) {
  line();
  say(' 말문 준비 완료');
  line();
  say(` 1. 이 컴퓨터(큰 화면) 브라우저에서 열기:  ${base}/host/new`);
  say('    → 방을 만들면 큰 화면에 입장 QR이 떠요. 폰은 그 QR을 카메라로 찍으면 돼요.');
  say(` 2. 진행자 폰 리모컨:                   ${base}/remote`);
  say(` 3. 시계 동기화 점검(폰 2~3대):          ${base}/sync`);
  if (!https) {
    say('');
    say(' ⚠ http 주소라 QR 카메라·기울기 센서가 꺼져요 (숫자 입력·화면 버튼으로 대신 참여).');
    say('   카메라까지 쓰려면 --lan 없이 실행하세요 (HTTPS 터널).');
  } else {
    say('');
    say(' · 주소는 켤 때마다 바뀌어요. QR은 큰 화면이 지금 주소로 만들어 줘요.');
    say(' · 노트북 절전·화면 잠금을 꺼 두세요. 꺼지면 서버도 멈춰요.');
  }
  say(' · 끄려면 Ctrl+C');
  line();
}

async function main() {
  if (!flag('no-build')) {
    say('빌드 중… (처음 한 번, 1분 정도)');
    const b = spawnSync(win ? 'pnpm.cmd' : 'pnpm', ['build'], { cwd: root, stdio: 'inherit', shell: win });
    if (b.status !== 0) {
      say('빌드에 실패했어요. 위 오류를 확인해 주세요 (pnpm install을 먼저 했는지도).');
      process.exit(1);
    }
  }

  say(`서버 시작 (포트 ${port})`);
  const server = spawn(process.execPath, [path.join(root, 'apps/server/dist/index.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '0.0.0.0', NODE_ENV: 'production' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(server);
  server.on('exit', (code) => {
    say(`서버가 멈췄어요 (코드 ${code}).`);
    shutdown(code ?? 1);
  });
  if (!(await waitForServer())) {
    say('서버가 20초 안에 뜨지 않았어요. 포트가 이미 쓰이고 있다면 --port 4000 처럼 바꿔 보세요.');
    shutdown(1);
    return;
  }

  if (flag('lan')) {
    const ips = lanAddresses();
    printReady(`http://${ips[0] ?? 'localhost'}:${port}`, false);
    if (ips.length > 1) say(` (다른 네트워크 주소: ${ips.slice(1).join(', ')})`);
    return;
  }

  say('HTTPS 터널 여는 중… (Cloudflare 무료 터널, 가입 필요 없음)');
  const useLocal = hasCommand('cloudflared');
  const [cmd, cmdArgs] = useLocal
    ? ['cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]]
    : [
        win ? 'npx.cmd' : 'npx',
        ['--yes', 'cloudflared', 'tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`],
      ];
  const tunnel = spawn(cmd, cmdArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: win });
  children.push(tunnel);
  let found = false;
  const onData = (buf) => {
    const text = buf.toString();
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text);
    if (m && !found) {
      found = true;
      printReady(m[0], true);
    }
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  tunnel.on('exit', (code) => {
    if (!found) {
      say(
        '터널을 열지 못했어요. 인터넷 연결을 확인하거나, 같은 와이파이로만 하려면 --lan 을 붙여 실행하세요.',
      );
      say(
        '(cloudflared를 직접 설치하면 더 빨라요: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)',
      );
    } else {
      say(`터널이 닫혔어요 (코드 ${code}).`);
    }
    shutdown(code ?? 1);
  });
  setTimeout(() => {
    if (!found) say('터널 주소를 기다리는 중… (처음엔 cloudflared를 내려받느라 오래 걸릴 수 있어요)');
  }, 15_000).unref();
}

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
