import React from 'react';
import { BatteryFull, Minus, Square, X } from 'lucide-react';

interface TauriWindowApi {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
}

interface TauriGlobal {
  window: { getCurrentWindow: () => TauriWindowApi };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

type WindowAction = 'minimize' | 'toggleMaximize' | 'close';

const runWindowAction = (action: WindowAction): void => {
  const tauri: TauriGlobal | undefined = window.__TAURI__;
  if (!tauri) return;
  const currentWindow = tauri.window.getCurrentWindow();
  void currentWindow[action]()
    .catch((error: unknown) => {
      console.error('窗口操作失败', error);
    });
};

const TitleBar: React.FC = () => {
  return (
    <header
      data-tauri-drag-region
      className="flex h-[42px] shrink-0 items-center justify-between border-b border-white/15 bg-white/10 px-5 backdrop-blur-md [transform:translateZ(0)]"
    >
      <div data-tauri-drag-region className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-sky-500 to-violet-500 text-white shadow-sm">
          <BatteryFull size={17} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.35)]">外设电量坞</div>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
            2.4G Battery View
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="最小化"
          onClick={() => runWindowAction('minimize')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/20"
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          aria-label="最大化"
          onClick={() => runWindowAction('toggleMaximize')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/20"
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => runWindowAction('close')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-rose-500/80 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
};

export default TitleBar;
