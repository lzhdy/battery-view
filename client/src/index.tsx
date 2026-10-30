import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import RoutesComponent from './app.tsx';
import PopupPage from './pages/PopupPage';
import './index.css';

const CLIENT_BASE_PATH = '/';
// 不 import @tauri-apps/api（vite build 会 externalize 报错），用全局 __TAURI__ 拿当前窗口 label
const isPopupWindow =
  (window as unknown as { __TAURI__?: { window?: { getCurrentWindow?: () => { label: string } } } })
    .__TAURI__?.window?.getCurrentWindow?.()?.label === 'popup';

if (isPopupWindow) {
  // 弹窗窗口：只渲染 PopupPage，不挂主路由
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary
      fallbackRender={({ error }) => (
        <div style={{ padding: 24, color: '#fff', background: '#222', fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>弹窗错误：</div>
          {(error as Error)?.message ?? String(error)}
          {'\n\nstack:\n'}
          {(error as Error)?.stack ?? ''}
        </div>
      )}
    >
      <PopupPage />
    </ErrorBoundary>,
  );
} else {
  const MainApp = () => {
    return (
      <BrowserRouter basename={CLIENT_BASE_PATH}>
        <ErrorBoundary
          fallbackRender={({ error }) => (
            <div style={{ padding: 24, color: '#fff', background: '#222', fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>前端错误：</div>
              {(error as Error)?.message ?? String(error)}
              {'\n\nstack:\n'}
              {(error as Error)?.stack ?? ''}
            </div>
          )}
        >
          <RoutesComponent />
        </ErrorBoundary>
      </BrowserRouter>
    );
  };

  createRoot(document.getElementById('root')!).render(<MainApp />);

  // 窗口初始隐藏（避免 WebView2 启动黑框）；React 挂载完成后通知 Rust 显示窗口。
  window.setTimeout(() => {
    const core = (window as unknown as {
      __TAURI__?: { core?: { invoke: (cmd: string) => Promise<unknown> } };
    }).__TAURI__?.core;
    if (core) core.invoke('show_main_after_ready').catch(() => {});
  }, 300);
}
