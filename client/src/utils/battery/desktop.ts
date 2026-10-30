/**
 * Tauri 桌面桥接工具：封装 withGlobalTauri 暴露的 window.__TAURI__.core.invoke，
 * 供前端调用 Rust 命令。在纯浏览器环境（如妙搭预览）下返回 null，调用方自行降级。
 */

export interface DesktopBridge {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

const getCore = (): DesktopBridge | null => {
  const w = window as unknown as { __TAURI__?: { core?: DesktopBridge } };
  return w.__TAURI__?.core ?? null;
};

/** 获取桌面桥接（浏览器环境返回 null） */
export const getDesktopBridge = (): DesktopBridge | null => getCore();

/** 加载自定义背景（data URL 或空串），无自定义背景或桥接不可用时返回空串 */
export const loadCustomBackground = async (): Promise<string> => {
  const core = getCore();
  if (!core) return '';
  try {
    const value: unknown = await core.invoke('load_background');
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
};
