import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 화면 하나가 오류로 멈춰도 하얀 화면 대신 다시 불러오기를 보여 준다.
 * 다시 불러오면 저장된 참가자·진행자 토큰으로 같은 방, 같은 사람으로 돌아온다.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('화면 오류', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="center-page" role="alert">
        <h1>화면을 그리다 문제가 생겼어요</h1>
        <p>다시 불러오면 같은 방, 같은 이름으로 이어서 할 수 있어요.</p>
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
          <a className="btn" href="/">
            처음으로
          </a>
        </div>
      </main>
    );
  }
}
