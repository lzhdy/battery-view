import type { BatteryProvider } from './types';
import { demoProvider } from './demo';
import { razerProvider } from './razer';
import { getDesktopBridge } from './desktop';

/**
 * Provider 分流：
 * - Tauri 桌面环境（有 __TAURI__.core）→ 真机 Razer HID Provider
 * - 纯浏览器（妙搭预览等）→ 模拟数据 Provider
 */
export const getBatteryProvider = (): BatteryProvider =>
  getDesktopBridge() ? razerProvider : demoProvider;
