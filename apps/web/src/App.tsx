import { lazy, Suspense, type ReactNode } from 'react';
import { Spinner, Wordmark } from './components/ui';
import { useLocation, Link } from './lib/router';
import { Home } from './pages/Home';
import { Play } from './pages/Play';

// 참가자 폰은 QR로 /play 에 바로 들어온다. 진행자 쪽 화면은 필요할 때만 내려받아 폰의 첫 로딩을 줄인다.
const HostNew = lazy(() => import('./pages/HostNew').then((m) => ({ default: m.HostNew })));
const HostScreen = lazy(() => import('./pages/HostScreen').then((m) => ({ default: m.HostScreen })));
const PackEditor = lazy(() => import('./pages/PackEditor').then((m) => ({ default: m.PackEditor })));
const Remote = lazy(() => import('./pages/Remote').then((m) => ({ default: m.Remote })));
const Report = lazy(() => import('./pages/Report').then((m) => ({ default: m.Report })));
const SyncTest = lazy(() => import('./pages/SyncTest').then((m) => ({ default: m.SyncTest })));

function Page({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="center-page">
          <Spinner label="화면을 불러오는 중" />
        </main>
      }
    >
      {children}
    </Suspense>
  );
}

export function App() {
  const { path } = useLocation();
  let m: RegExpMatchArray | null;

  if (path === '/') return <Home />;
  if ((m = path.match(/^\/play(?:\/([a-z]{4}))?\/?$/i))) return <Play key={m[1] ?? 'join'} code={m[1]} />;
  if (path === '/host/new')
    return (
      <Page>
        <HostNew />
      </Page>
    );
  if ((m = path.match(/^\/host\/([a-z]{4})\/?$/i)))
    return (
      <Page>
        <HostScreen key={m[1]} code={m[1]!.toUpperCase()} />
      </Page>
    );
  if ((m = path.match(/^\/remote(?:\/([a-z]{4}))?\/?$/i)))
    return (
      <Page>
        <Remote key={m[1] ?? 'remote'} code={m[1]} />
      </Page>
    );
  if (path === '/pack/new')
    return (
      <Page>
        <PackEditor key="new" />
      </Page>
    );
  if ((m = path.match(/^\/pack\/([a-z0-9]{6})\/?$/i)))
    return (
      <Page>
        <PackEditor key={m[1]} code={m[1]} />
      </Page>
    );
  if (path === '/sync')
    return (
      <Page>
        <SyncTest />
      </Page>
    );
  if ((m = path.match(/^\/report\/([\w-]+)\/?$/)))
    return (
      <Page>
        <Report id={m[1]!} />
      </Page>
    );

  return (
    <main className="center-page">
      <Wordmark />
      <h1>없는 페이지예요</h1>
      <p>주소를 다시 확인하거나 처음 화면에서 시작해 주세요.</p>
      <Link to="/" className="btn btn--sun">
        처음으로
      </Link>
    </main>
  );
}
