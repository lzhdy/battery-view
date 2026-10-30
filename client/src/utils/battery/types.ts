export type DeviceKind =
  | 'mouse'
  | 'keyboard'
  | 'headset'
  | 'speaker'
  | 'gamepad'
  | 'webcam'
  | 'microphone'
  | 'tablet';

export interface BatteryDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  model: string;
  productId: string;
  connection: string;
  protocol: string;
  source: string;
}

export interface BatteryReadResult {
  level: number | null;
  charging: boolean;
}

export interface DeviceLiveState {
  battery: number | null;
  charging: boolean;
  updatedAt: number;
  error: string;
}

export interface BatteryReading {
  id: string;
  deviceId: string;
  level: number;
  /** 采样时刻的充电状态（true=充电中，false=放电/待机） */
  charging: boolean;
  at: number;
}

export interface BatteryProvider {
  readonly name: string;
  listDevices(): Promise<BatteryDevice[]>;
  readBattery(deviceId: string): Promise<BatteryReadResult>;
  /** 可选：读取设备固件的低电量阈值（百分比；Razer 真机实测 DeathAdder V2 Pro = 5%） */
  readLowBatteryThreshold?(deviceId: string): Promise<number | null>;
}

export type BatteryLevel = 'ok' | 'low' | 'critical';

export const batteryLevel = (level: number): BatteryLevel => {
  if (level < 20) return 'critical';
  if (level < 50) return 'low';
  return 'ok';
};

export const BATTERY_LEVEL_HEX: Record<BatteryLevel, string> = {
  ok: '#10B981',
  low: '#F59E0B',
  critical: '#EF4444',
};

export const CHARGING_HEX = '#3B82F6';

export const BATTERY_LEVEL_LABELS: Record<BatteryLevel, string> = {
  ok: '电量充足',
  low: '电量偏低',
  critical: '电量告急',
};

export const CHARGING_LABEL = '充电中';
