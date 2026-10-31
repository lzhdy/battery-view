/**
 * 弹窗提醒触发器：监听设备电量状态变化，按 4 场景弹出毛玻璃小卡片。
 * 1) 开机弹窗：首次读到电量即弹；任一设备 <20% 时不自动消失（sticky）
 * 2) 低电提醒：电量 <20%（红色区），每设备 24h 一次，手动关闭
 * 3) 过低提醒：电量 <10%，每 30 分钟一次，手动关闭
 * 4) 充电插入：未充电 → 充电中跳变，5 秒自动消失
 */
import React from 'react';

import type {
  BatteryDevice,
  BatteryReading,
  DeviceLiveState,
} from '@client/src/utils/battery/types';
import { estimateTrend } from '@client/src/utils/battery/predict';
import { loadGearProfiles, updateGearProfile } from '@client/src/utils/battery/store';
import {
  showPopup,
  type PopupDeviceRow,
} from '@client/src/utils/battery/popup';

const DAY_MS = 24 * 3600 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

interface Args {
  devices: BatteryDevice[];
  states: Record<string, DeviceLiveState>;
  readings: BatteryReading[];
  enabled: { boot: boolean; low: boolean; charging: boolean };
}

/** 预计可读文案：放电→可用约 X 小时；充电→约 X 分钟充满
 *  上限钳制：斜率接近 0（如 2.4G 鼠标几乎不掉电）时 tteMinutes/ttfMinutes 会放大到
 *  数十万小时，与主界面 TrendCard 的 formatDurationZh 口径对齐（>7 天只显示"7 天以上"）。
 */
const MAX_EST_MINUTES = 7 * 24 * 60;
const estText = (
  deviceId: string,
  readings: BatteryReading[],
  charging: boolean,
): string => {
  const list = readings
    .filter((r) => r.deviceId === deviceId)
    .sort((a, b) => a.at - b.at);
  if (list.length < 3) return charging ? '充电中' : '放电中';
  const knownGear = loadGearProfiles()[deviceId] ?? null;
  const est = estimateTrend(list, charging, knownGear);
  if (est.learnedGear) updateGearProfile(deviceId, est.learnedGear);
  if (charging && est.ttfMinutes != null) {
    if (est.ttfMinutes > MAX_EST_MINUTES) return '充电中 · 预计 7 天以上充满';
    return `充电中 · 预计约 ${Math.max(1, Math.round(est.ttfMinutes))} 分钟充满`;
  }
  if (!charging && est.tteMinutes != null) {
    if (est.tteMinutes > MAX_EST_MINUTES) return '预计可用约 7 天以上';
    const mins = est.tteMinutes;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `预计可用约 ${h} 小时 ${m} 分` : `预计可用约 ${m} 分钟`;
  }
  return charging ? '充电中' : '放电中';
};

export const usePopupNotifier = ({ devices, states, readings, enabled }: Args): void => {
  const bootDone = React.useRef<boolean>(false);
  const lastLowAt = React.useRef<Record<string, number>>({});
  const lastCritAt = React.useRef<Record<string, number>>({});
  const prevCharging = React.useRef<Record<string, boolean>>({});

  React.useEffect(() => {
    if (devices.length === 0) return;
    const now = Date.now();

    // ── 1) 开机弹窗：首次拿到任何在线电量后弹一次 ──
    if (!bootDone.current && enabled.boot) {
      const online = devices.filter((d) => states[d.id]?.battery != null);
      if (online.length > 0) {
        bootDone.current = true;
        const rows: PopupDeviceRow[] = online.map((d) => {
          const st = states[d.id];
          return {
            kind: d.kind,
            name: d.name,
            level: st?.battery ?? -1,
            charging: st?.charging === true,
            sub: estText(d.id, readings, st?.charging === true),
          };
        });
        const anyLow = rows.some((r) => r.level >= 0 && r.level < 20);
        void showPopup({
          kind: 'boot',
          sticky: anyLow, // 任一设备 <20% → 不自动消失，手动关闭
          title: anyLow ? '外设电量 · 有设备需要充电' : '外设电量状态',
          devices: rows,
        });
      }
    }

    // ── 2/3/4) 逐设备判断 ──
    for (const d of devices) {
      const st = states[d.id];
      if (!st || st.battery == null) continue;
      const level = st.battery;
      const wasCharging = prevCharging.current[d.id] === true;

      // 4) 充电插入跳变
      if (!wasCharging && st.charging && enabled.charging) {
        // 去重：Rust 托盘轮询（5 秒）已优先检测到充电跳变并弹窗，30 秒内前端不再重复弹
        const rustAt = Number(window.localStorage.getItem('bv_last_popup_charging_at') ?? '0');
        if (Date.now() - rustAt > 30_000) {
          void showPopup({
            kind: 'charging',
            sticky: false,
            title: '开始充电',
            devices: [
              {
                kind: d.kind,
                name: d.name,
                level,
                charging: true,
                sub: estText(d.id, readings, true),
              },
            ],
          });
        }
      }
      prevCharging.current[d.id] = st.charging === true;

      if (st.charging) continue; // 充电中不触发低电/过低提醒

      // 3) 过低提醒 <10%（每 30 分钟）
      if (level < 10) {
        const last = lastCritAt.current[d.id] ?? 0;
        if (now - last >= HALF_HOUR_MS) {
          lastCritAt.current[d.id] = now;
          void showPopup({
            kind: 'crit',
            sticky: true,
            title: '电量过低，请立即充电',
            devices: [
              { kind: d.kind, name: d.name, level, charging: false, sub: '电量不足 10%，请连接充电线' },
            ],
          });
        }
        continue; // 已触发过低，不再重复低电提醒
      }
      // 2) 低电提醒 <20%（每 24 小时）
      if (level < 20 && enabled.low) {
        const last = lastLowAt.current[d.id] ?? 0;
        if (now - last >= DAY_MS) {
          lastLowAt.current[d.id] = now;
          void showPopup({
            kind: 'low',
            sticky: true,
            title: '电量不足',
            devices: [
              { kind: d.kind, name: d.name, level, charging: false, sub: '电量低于 20%，建议连接充电线' },
            ],
          });
        }
      }
    }
  }, [devices, states, readings, enabled]);
};
