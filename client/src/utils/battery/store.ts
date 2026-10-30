import type { BatteryReading } from './types';
import { seedReadings } from './demo';

export interface AppSettings {
  autoRefresh: boolean;
  intervalSec: number;
  /** 自定义背景图片的本地绝对路径；空字符串表示使用默认背景 */
  backgroundPath?: string;
  /** 开机自启（默认开；由 Rust 侧写注册表 Run 键持久化） */
  autoStart?: boolean;
  /** 开机电量弹窗（默认开） */
  popupBoot?: boolean;
  /** 低电提醒弹窗（默认开） */
  popupLow?: boolean;
  /** 充电插入提醒弹窗（默认开；由 Rust 侧轮询线程生效） */
  popupCharging?: boolean;
}

export interface NameOverrides {
  [deviceId: string]: string;
}

const READINGS_KEY = 'battery-view/readings/v3';
const SETTINGS_KEY = 'battery-view/settings';
const NAMES_KEY = 'battery-view/names';
export const MAX_READINGS_PER_DEVICE = 500;

const DEFAULT_SETTINGS: AppSettings = {
  autoRefresh: true,
  intervalSec: 300,
  backgroundPath: '',
  autoStart: true,
  popupBoot: true,
  popupLow: true,
  popupCharging: true,
};

const parse = <T>(raw: string | null, fallback: T): T => {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** 旧版本（v2，无 charging 字段）数据迁移：按设备补齐 charging=false 并去重 */
const migrateV2 = (raw: BatteryReading[]): BatteryReading[] => {
  const seen: Set<string> = new Set();
  const out: BatteryReading[] = [];
  raw.forEach((r: BatteryReading) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({
      id: r.id,
      deviceId: r.deviceId,
      level: r.level,
      charging: typeof (r as { charging?: unknown }).charging === 'boolean'
        ? (r as { charging: boolean }).charging
        : false,
      at: r.at,
    });
  });
  return out;
};

export const loadReadings = (): BatteryReading[] => {
  if (typeof window === 'undefined') return [];
  const sanitize = (list: unknown): BatteryReading[] =>
    Array.isArray(list)
      ? (list as BatteryReading[]).filter(
          (r): r is BatteryReading =>
            !!r &&
            typeof r === 'object' &&
            typeof (r as BatteryReading).at === 'number' &&
            typeof (r as BatteryReading).deviceId === 'string',
        )
      : [];
  const raw: string | null = window.localStorage.getItem(READINGS_KEY);
  if (raw !== null) return sanitize(parse<unknown>(raw, []));
  const legacy: string | null = window.localStorage.getItem('battery-view/readings/v2');
  if (legacy !== null) {
    const migrated: BatteryReading[] = migrateV2(parse<BatteryReading[]>(legacy, []));
    window.localStorage.setItem(READINGS_KEY, JSON.stringify(migrated));
    return migrated;
  }
  const seeded: BatteryReading[] = seedReadings();
  window.localStorage.setItem(READINGS_KEY, JSON.stringify(seeded));
  return seeded;
};

export const saveReadings = (readings: BatteryReading[]): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(READINGS_KEY, JSON.stringify(readings));
};

export const loadSettings = (): AppSettings => {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const raw: string | null = window.localStorage.getItem(SETTINGS_KEY);
  if (raw === null) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
    return DEFAULT_SETTINGS;
  }
  const parsed: AppSettings = parse<AppSettings>(raw, DEFAULT_SETTINGS);
  return {
    autoRefresh: typeof parsed.autoRefresh === 'boolean' ? parsed.autoRefresh : true,
    intervalSec:
      typeof parsed.intervalSec === 'number' && parsed.intervalSec >= 10
        ? parsed.intervalSec
        : 300,
    backgroundPath: typeof parsed.backgroundPath === 'string' ? parsed.backgroundPath : '',
    autoStart: parsed.autoStart !== false,
    popupBoot: parsed.popupBoot !== false,
    popupLow: parsed.popupLow !== false,
    popupCharging: parsed.popupCharging !== false,
  };
};

export const saveSettings = (settings: AppSettings): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

export const loadNameOverrides = (): NameOverrides => {
  if (typeof window === 'undefined') return {};
  return parse<NameOverrides>(window.localStorage.getItem(NAMES_KEY), {});
};

export const saveNameOverrides = (names: NameOverrides): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NAMES_KEY, JSON.stringify(names));
};
