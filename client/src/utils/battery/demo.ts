
import mouseIcon from '@client/src/assets/peripherals/mouse.png';
import keyboardIcon from '@client/src/assets/peripherals/keyboard.png';
import headsetIcon from '@client/src/assets/peripherals/headset.png';
import speakerIcon from '@client/src/assets/peripherals/speaker.png';
import gamepadIcon from '@client/src/assets/peripherals/gamepad.png';
import webcamIcon from '@client/src/assets/peripherals/webcam.png';
import microphoneIcon from '@client/src/assets/peripherals/microphone.png';
import tabletIcon from '@client/src/assets/peripherals/tablet.png';

import type {
  BatteryDevice,
  BatteryProvider,
  BatteryReadResult,
  BatteryReading,
  DeviceKind,
} from './types';

export const DEVICE_IMAGES: Record<DeviceKind, string> = {
  mouse: mouseIcon,
  keyboard: keyboardIcon,
  headset: headsetIcon,
  speaker: speakerIcon,
  gamepad: gamepadIcon,
  webcam: webcamIcon,
  microphone: microphoneIcon,
  tablet: tabletIcon,
};

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  mouse: 'MOUSE / 鼠标',
  keyboard: 'KEYBOARD / 键盘',
  headset: 'HEADSET / 耳机',
  speaker: 'SPEAKER / 音箱',
  gamepad: 'GAMEPAD / 手柄',
  webcam: 'WEBCAM / 摄像头',
  microphone: 'MICROPHONE / 麦克风',
  tablet: 'TABLET / 数位板',
};

export const CONNECTION_MODES = ['蓝牙', '有线', '2.4G'] as const;

export const CONNECTION_READ_TEXT: Record<string, string> = {
  '2.4G': '2.4G 接收器 · 本地读取',
  蓝牙: '蓝牙连接 · 本地读取',
  有线: '有线连接 · 本地读取',
};

export const DEMO_DEVICES: BatteryDevice[] = [
  {
    id: 'demo-mouse',
    kind: 'mouse',
    name: 'ATK 2.4G 鼠标',
    model: 'ATK 无线游戏鼠标',
    productId: '373B:FF05',
    connection: '2.4G',
    protocol: 'ATK 私有协议（协议 2）',
    source: '模拟数据',
  },
  {
    id: 'demo-headset',
    kind: 'headset',
    name: 'DARKRIM SHADOW',
    model: 'DARKRIM 2.4G 耳机',
    productId: '3654:FF02',
    connection: '2.4G',
    protocol: 'JL RCSP（TLV over HID）',
    source: '模拟数据',
  },
  {
    id: 'demo-keyboard',
    kind: 'keyboard',
    name: 'K68 机械键盘',
    model: 'K68 三模机械键盘',
    productId: '372A:FF03',
    connection: '蓝牙',
    protocol: 'ATK 私有协议（协议 1）',
    source: '模拟数据',
  },
];

const OFFLINE_DEVICES: Set<string> = new Set(['demo-keyboard']);

const lastByDevice: Map<string, number> = new Map([
  ['demo-mouse', 75],
  ['demo-headset', 16],
]);
const lastAtByDevice: Map<string, number> = new Map();
const DRIFT_PER_HOUR: Record<string, number> = {
  'demo-mouse': 6,
  'demo-headset': -4.5,
};

const CHARGING_DEVICES: Set<string> = new Set(['demo-mouse']);

export const demoReadBattery = (deviceId: string): BatteryReadResult => {
  const now: number = Date.now();
  const prevAt: number = lastAtByDevice.get(deviceId) ?? now;
  const hours: number = Math.max(0, (now - prevAt) / 3600000);
  const current: number = lastByDevice.get(deviceId) ?? 75;
  const next: number = Math.min(
    100,
    Math.max(3, current + (DRIFT_PER_HOUR[deviceId] ?? 0) * hours),
  );
  lastAtByDevice.set(deviceId, now);
  lastByDevice.set(deviceId, next);
  return { level: Math.round(next), charging: CHARGING_DEVICES.has(deviceId) };
};

export const seedReadings = (): BatteryReading[] => {
  const now: number = Date.now();
  const mouseLevels: number[] = [67, 68, 69, 70, 71, 73, 74, 75];
  const headsetLevels: number[] = [19, 18, 18, 17, 17, 16, 16, 16];
  const out: BatteryReading[] = [];
  mouseLevels.forEach((level: number, i: number) => {
    out.push({
      id: `seed-mouse-${i}`,
      deviceId: 'demo-mouse',
      level,
      charging: true,
      at: now - (mouseLevels.length - 1 - i) * 10 * 60 * 1000,
    });
  });
  headsetLevels.forEach((level: number, i: number) => {
    out.push({
      id: `seed-headset-${i}`,
      deviceId: 'demo-headset',
      level,
      charging: false,
      at: now - (headsetLevels.length - 1 - i) * 10 * 60 * 1000,
    });
  });
  const keyboardLevels: number[] = [46, 45, 44, 42, 41, 39, 38];
  const keyboardBase: number = now - 2 * 24 * 60 * 60 * 1000;
  keyboardLevels.forEach((level: number, i: number) => {
    out.push({
      id: `seed-keyboard-${i}`,
      deviceId: 'demo-keyboard',
      level,
      charging: false,
      at: keyboardBase + i * 10 * 60 * 1000,
    });
  });
  return out;
};

export const demoProvider: BatteryProvider = {
  name: 'demo',
  listDevices: async (): Promise<BatteryDevice[]> => DEMO_DEVICES,
  readBattery: async (deviceId: string): Promise<BatteryReadResult> =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        if (OFFLINE_DEVICES.has(deviceId)) {
          reject(new Error('设备未连接'));
          return;
        }
        resolve(demoReadBattery(deviceId));
      }, 350);
    }),
  readLowBatteryThreshold: async (): Promise<number | null> => null,
};
