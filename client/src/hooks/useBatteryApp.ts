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

const capReadingsPerDevice = (readings: BatteryReading[]): BatteryReading[] => {  const safe: BatteryReading[] = (Array.isArray(readings) ? readings : []).filter(
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
        setStates((prev: Record<string, DeviceLiveState>) => ({
          ...prev,
          [id]: {
            battery: result.level,
            charging: result.charging,
            updatedAt: at,
            error: '',
          },
        }));
      }
      // level==null（协议间歇读取失败）：保留上次有效电量/充电状态，避免 UI 闪烁成"未知"；
      // 设备真正拔出由 syncDevices 统一清除其状态。
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

  // 设备热插拔同步：周期重枚举设备列表，新增设备立即读取，消失设备连同其状态一并移除。
  // 原实现只在挂载时 listDevices 一次，插拔后前端仍持有旧设备且刷新失败时保留旧状态
  // （例：有线 AE7 1250 拔下后 UI 仍显示"充电中"）。此函数修复该遗漏。
  const syncDevicesRef = useRef<() => void>(() => {});
  syncDevicesRef.current = () => {
    getBatteryProvider()
      .listDevices()
      .then((list: BatteryDevice[]) => {
        // 枚举瞬态失败可能返回空列表（SetupDiGetClassDevsW 偶发失败）：
        // 不视为"全部设备拔出"，避免 15s 周期内 UI 误删全部设备导致闪烁/掉线假象；
        // 真实拔出时系统仍有其他 HID 接口，列表非空，正常按增量处理。
        if (list.length === 0) return;
        const prev = devicesRef.current;
        const prevIds = new Set(prev.map((d: BatteryDevice) => d.id));
        const nextIds = new Set(list.map((d: BatteryDevice) => d.id));
        const gone: BatteryDevice[] = prev.filter(
          (d: BatteryDevice) => !nextIds.has(d.id),
        );
        const added: BatteryDevice[] = list.filter(
          (d: BatteryDevice) => !prevIds.has(d.id),
        );
        if (gone.length > 0 || added.length > 0 || prev.length !== list.length) {
          setDevices(list);
        }
        if (gone.length > 0) {
          // 设备已拔出：清除其残留实时状态与阈值，避免 UI 显示陈旧电量/充电状态
          setStates((s: Record<string, DeviceLiveState>) => {
            const next: Record<string, DeviceLiveState> = { ...s };
            gone.forEach((g: BatteryDevice) => delete next[g.id]);
            return next;
          });
          setThresholds((t: Record<string, number>) => {
            const next: Record<string, number> = { ...t };
            gone.forEach((g: BatteryDevice) => delete next[g.id]);
            return next;
          });
        }
        setSelectedId((prevId: string | null) => {
          if (prevId === null || nextIds.has(prevId)) return prevId;
          // 当前选中的设备已消失 → 跳回第一个设备
          return list[0]?.id ?? null;
        });
        added.forEach((d: BatteryDevice) => {
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
    // 首次枚举设备并读取（后续由下方周期任务持续同步，支持热插拔）
    syncDevicesRef.current();
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

  // 设备热插拔重枚举 + 电量全量刷新（15s 周期，独立于 autoRefresh）：
  // - 重枚举：设备插入/拔出即增删列表并清除残留状态；
  // - 全量刷新：JM 等无线协议读取存在间歇失败（level=None），挂载后单次读取失败
  //   会导致主界面长期"无电量显示"，此周期保证 UI 最多 15s 内拿到电量。
  useEffect(() => {
    const timer: number = window.setInterval(() => {
      syncDevicesRef.current();
      devicesRef.current.forEach((d: BatteryDevice) => {
        void refreshRef.current(d.id);
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  // 启动校准：默认选中第一个连接中的设备（用户明确要求）。
  // 启动/未选中（selectedId===null）时直接选中 devices[0]，不等电量读数；
  // 已选中但当前设备读不到电量、且列表中存在有电量的设备时，跳转到第一台有电量的设备；
  // 用户手动选择设备后不再干预。
  useEffect(() => {
    if (autoSelected) return;
    if (devices.length === 0) return;
    if (selectedId === null) {
      setSelectedId(devices[0].id);
      return;
    }
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
