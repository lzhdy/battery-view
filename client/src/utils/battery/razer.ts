/**
 * Razer HID 真机 Provider：通过 Tauri 桥接调用 Rust 命令读取真实设备电量。
 * 设备列表来自枚举（VID 1532 → 雷蛇外设），kind / 型号名由 Rust 按 PID 映射，
 * 前端直接使用，不再硬编码（多设备种类时图标/名称自动正确）。
 */

import { getDesktopBridge } from './desktop';
import type {
  BatteryDevice,
  BatteryProvider,
  BatteryReadResult,
  DeviceKind,
} from './types';

interface RazerHidEntry {
  id: string;
  productId: string;
  kind?: string;
  name?: string;
  connection: string;
  featureLen: number;
}

/** 缓存设备接口的 Feature Report 长度（读取时需按真实长度构造缓冲） */
const featureLenByPath: Record<string, number> = {};

const toDevice = (e: RazerHidEntry): BatteryDevice => {
  featureLenByPath[e.id] = e.featureLen;
  const kind: DeviceKind =
    e.kind === 'keyboard' ||
    e.kind === 'headset' ||
    e.kind === 'speaker' ||
    e.kind === 'gamepad' ||
    e.kind === 'webcam' ||
    e.kind === 'microphone' ||
    e.kind === 'tablet'
      ? e.kind
      : 'mouse';
  const name: string = e.name && e.name !== 'Razer 设备' ? e.name : 'DeathAdder V2 Pro';
  return {
    id: e.id,
    kind,
    name,
    model: name,
    productId: `1532:${e.productId}`,
    connection: e.connection,
    protocol: 'Razer 90B Feature Report',
    source: 'Razer HID',
  };
};

export const razerProvider: BatteryProvider = {
  name: 'razer-hid',
  listDevices: async (): Promise<BatteryDevice[]> => {
    const core = getDesktopBridge();
    if (!core) throw new Error('非桌面环境');
    const list: unknown = await core.invoke('list_hid_devices');
    const entries: RazerHidEntry[] = Array.isArray(list)
      ? (list as RazerHidEntry[])
      : [];
    return entries.map(toDevice);
  },
  readBattery: async (deviceId: string): Promise<BatteryReadResult> => {
    const core = getDesktopBridge();
    if (!core) throw new Error('非桌面环境');
    const r: unknown = await core.invoke('read_battery_level', {
      path: deviceId,
      featureLen: featureLenByPath[deviceId] ?? 91,
    });
    const v = r as { level?: number | null; charging?: boolean };
    return {
      level: typeof v.level === 'number' ? v.level : null,
      charging: v.charging === true,
    };
  },
  readLowBatteryThreshold: async (deviceId: string): Promise<number | null> => {
    const core = getDesktopBridge();
    if (!core) throw new Error('非桌面环境');
    const r: unknown = await core.invoke('read_low_battery_threshold', {
      path: deviceId,
      featureLen: featureLenByPath[deviceId] ?? 91,
    });
    return typeof r === 'number' ? r : null;
  },
};
