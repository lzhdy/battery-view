import { useCallback, useEffect, useRef, useState } from 'react';

import {
  loadNameOverrides,
  loadReadings,
  loadSettings,
  MAX_READINGS_PER_DEVICE,
  saveNameOverrides,
  saveReadings,
  saveSettings,
  type AppSettings,
  type NameOverrides,
} from '@client/src/utils/battery/store';
import { getBatteryProvider } from '@client/src/utils/battery/provider';
import { getDesktopBridge } from '@client/src/utils/battery/desktop';
import type {
  BatteryDevice,
  BatteryReadResult,
  BatteryReading,
  DeviceLiveState,
} from '@client/src/utils/battery/types';

export interface UseBatteryAppResult {
  devices: BatteryDevice[];
  states: Record<string, DeviceLiveState>;
  thresholds: Record<string, number>;
  readings: BatteryReading[];
  settings: AppSettings;
  selectedId: string | null;
  busy: Record<string, boolean>;
  displayName: (device: BatteryDevice) => string;
  select: (id: string) => void;
  refresh: (id: string) => void;
  refreshAll: () => void;
  rename: (id: string, name: string) => void;
  clearHistory: (deviceId?: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

const capReadingsPerDevice = (readings: BatteryReading[]): BatteryReading[] => {
  const safe: BatteryReading[] = (Array.isArray(readings) ? readings : []).filter(
    (r): r is BatteryReading =>
      !!r && typeof r === 'object' && typeof r.at === 'number' && typeof r.deviceId === 'string',
  );
  const sorted: BatteryReading[] = [...safe].sort(
    (a: BatteryReading, b: BatteryReading) => a.at - b.at,
  );
  const byDevice: Map<string, BatteryReading[]> = new Map();
  sorted.forEach((r: BatteryReading) => {
    const list: BatteryReading[] = byDevice.get(r.deviceId) ?? [];
    list.push(r);
    byDevice.set(r.deviceId, list);
  });
  const capped: BatteryReading[] = [];
  byDevice.forEach((list: BatteryReading[]) => {
    capped.push(...list.slice(-MAX_READINGS_PER_DEVICE));
  });
  return capped;
};

export const useBatteryApp = (): UseBatteryAppResult => {
  const [devices, setDevices] = useState<BatteryDevice[]>([]);
  const [states, setStates] = useState<Record<string, DeviceLiveState>>({});
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [readings, setReadings] = useState<BatteryReading[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    autoRefresh: true,
    intervalSec: 300,
    backgroundPath: '',
  });
  const [names, setNames] = useState<NameOverrides>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 是否已人工选择设备：人工选择后不再做默认选中校准
  const [autoSelected, setAutoSelected] = useState<boolean>(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const readingsRef = useRef<BatteryReading[]>([]);

  const doRefresh = useCallback(async (id: string) => {
    setBusy((prev: Record<string, boolean>) => ({ ...prev, [id]: true }));
    try {
      const result: BatteryReadResult = await getBatteryProvider().readBattery(id);
      const at: number = Date.now();
      if (result.level !== null) {
        const reading: BatteryReading = {
          id: `${id}-${at}`,
          deviceId: id,
          level: result.level,
          charging: result.charging,
          at,
        };
        const updated: BatteryReading[] = capReadingsPerDevice(
          readingsRef.current.concat(reading),
        );
        readingsRef.current = updated;
        setReadings(updated);
        saveReadings(updated);
      }
      setStates((prev: Record<string, DeviceLiveState>) => ({
        ...prev,
        [id]: {
          battery: result.level,
          charging: result.charging,
          updatedAt: at,
          error: '',
        },
      }));
    } catch (err) {
      const message: string =
        err instanceof Error ? err.message : '读取失败，请稍后重试';
      setStates((prev: Record<string, DeviceLiveState>) => {
        const before: DeviceLiveState = prev[id] ?? {
          battery: null,
          charging: false,
          updatedAt: 0,
          error: '',
        };
        return { ...prev, [id]: { ...before, error: message } };
      });
    } finally {
      setBusy((prev: Record<string, boolean>) => ({ ...prev, [id]: false }));
    }
  }, []);

  const refreshRef = useRef(doRefresh);
  useEffect(() => {
    refreshRef.current = doRefresh;
  }, [doRefresh]);

  const devicesRef = useRef<BatteryDevice[]>([]);
  devicesRef.current = devices;

  const refreshAllRef = useRef<() => void>(() => {});
  refreshAllRef.current = () => {
    const list: BatteryDevice[] = devicesRef.current;
    list.forEach((d: BatteryDevice) => {
      void refreshRef.current(d.id);
    });
  };

  useEffect(() => {
    const loaded: BatteryReading[] = loadReadings();
    readingsRef.current = loaded;
    setReadings(loaded);
    setSettings(loadSettings());
    setNames(loadNameOverrides());
    // 开机自启 / 充电弹窗开关：Rust 侧为权威持久化源，启动时拉取并合并
    const bridge = getDesktopBridge();
    if (bridge) {
      Promise.all([
        bridge.invoke('get_auto_start').catch(() => undefined),
        bridge.invoke('get_popup_charging').catch(() => undefined),
      ]).then(([asv, pcv]) => {
        setSettings((prev: AppSettings) => {
          const next: AppSettings = { ...prev };
          let changed = false;
          if (typeof asv === 'boolean') {
            next.autoStart = asv;
            changed = true;
          }
          if (typeof pcv === 'boolean') {
            next.popupCharging = pcv;
            changed = true;
          }
          if (changed) saveSettings(next);
          return next;
        });
      });
    }
    void getBatteryProvider()
      .listDevices()
      .then((list: BatteryDevice[]) => {
        setDevices(list);
        if (list.length > 0) setSelectedId(list[0].id);
        list.forEach((d: BatteryDevice) => {
          void refreshRef.current(d.id);
          const provider = getBatteryProvider();
          if (provider.readLowBatteryThreshold) {
            void provider
              .readLowBatteryThreshold(d.id)
              .then((t: number | null) => {
                if (t !== null) {
                  setThresholds((prev: Record<string, number>) => ({
                    ...prev,
                    [d.id]: t,
                  }));
                }
              })
              .catch(() => undefined);
          }
        });
      });
  }, []);

  useEffect(() => {
    if (!settings.autoRefresh) return undefined;
    const timer: number = window.setInterval(() => {
      devicesRef.current.forEach((d: BatteryDevice) => {
        void refreshRef.current(d.id);
      });
    }, settings.intervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [settings.autoRefresh, settings.intervalSec]);

  // 启动校准：默认选中跳转到第一个"有电量读数"的设备。
  // 读不到电量的外设（如达尔优 AE7 2.4G）会停在"等待读取"，不该占据默认主区视图；
  // 用户手动选择设备后不再干预。
  useEffect(() => {
    if (autoSelected) return;
    if (selectedId === null || devices.length === 0) return;
    const current = devices.find((d: BatteryDevice) => d.id === selectedId);
    if (!current) return;
    const curBattery = states[current.id]?.battery;
    if (curBattery == null && devices.some((d) => states[d.id]?.battery != null)) {
      const firstLive = devices.find((d) => states[d.id]?.battery != null);
      if (firstLive) setSelectedId(firstLive.id);
    }
  }, [autoSelected, devices, states, selectedId]);

  const displayName = useCallback(
    (device: BatteryDevice): string => names[device.id] ?? device.name,
    [names],
  );

  const select = useCallback((id: string) => {
    setAutoSelected(true);
    setSelectedId(id);
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setNames((prev: NameOverrides) => {
      const next: NameOverrides = { ...prev, [id]: name };
      saveNameOverrides(next);
      return next;
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev: AppSettings) => {
      const next: AppSettings = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
    // 同步到 Rust 侧：充电弹窗开关（轮询线程生效）+ 开机自启（注册表 Run 键）
    const bridge = getDesktopBridge();
    if (!bridge) return;
    if (typeof patch.popupCharging === 'boolean') {
      void bridge
        .invoke('set_popup_charging', { enabled: patch.popupCharging })
        .catch(() => undefined);
    }
    if (typeof patch.autoStart === 'boolean') {
      void bridge
        .invoke('set_auto_start', { enabled: patch.autoStart })
        .catch(() => undefined);
    }
  }, []);

  const clearHistory = useCallback((deviceId?: string) => {
    const next: BatteryReading[] = deviceId
      ? readingsRef.current.filter((r: BatteryReading) => r.deviceId !== deviceId)
      : [];
    readingsRef.current = next;
    setReadings(next);
    saveReadings(next);
  }, []);

  return {
    devices,
    states,
    thresholds,
    readings,
    settings,
    selectedId,
    busy,
    displayName,
    select,
    refresh: (id: string) => void refreshRef.current(id),
    refreshAll: () => refreshAllRef.current(),
    rename,
    clearHistory,
    updateSettings,
  };
};
