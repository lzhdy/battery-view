/**
 * 桌面真机 Provider：通过 Tauri 桥接调用 Rust 命令读取真实设备电量。
 * 设备列表来自枚举（雷蛇 VID 1532 → 90B 协议；其余品牌 → 通用识别层，
 * kind / 型号名由 Rust 按 VID:PID 映射，前端直接使用，不再硬编码）。
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
  source?: string;
  protocol?: string;
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
  const name: string = e.name && e.name !== 'Razer 设备' ? e.name : '外设';
  const isRazer = e.source !== 'generic';
  return {
    id: e.id,
    kind,
    name,
    model: name,
    productId: e.productId,
    connection: e.connection,
    protocol: e.protocol ?? (isRazer ? 'Razer 90B Feature Report' : '设备识别（无公开电量协议）'),
    source: isRazer ? 'Razer HID' : '通用 HID',
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
