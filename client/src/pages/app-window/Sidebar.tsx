import React from 'react';
import { History, Settings, Wifi } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@client/src/lib/utils';
import { DEVICE_IMAGES } from '@client/src/utils/battery/demo';
import {
  BATTERY_LEVEL_HEX,
  BATTERY_LEVEL_LABELS,
  CHARGING_HEX,
  CHARGING_LABEL,
  batteryLevel,
  type BatteryDevice,
  type DeviceLiveState,
} from '@client/src/utils/battery/types';
import { Image } from '@client/src/components/ui/image';

type SidebarTab = 'live' | 'past';

interface SidebarProps {
  devices: BatteryDevice[];
  states: Record<string, DeviceLiveState>;
  busy: Record<string, boolean>;
  selectedId: string | null;
  displayName: (device: BatteryDevice) => string;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
}

const TABS: Array<{ key: SidebarTab; label: string; icon: LucideIcon }> = [
  { key: 'live', label: '连接中的设备', icon: Wifi },
  { key: 'past', label: '历史设备', icon: History },
];

const EMPTY_TEXT: Record<SidebarTab, { title: string; hint: string }> = {
  live: { title: '暂无连接中的设备', hint: '设备接入后会显示在这里' },
  past: { title: '暂无历史设备', hint: '曾经连接过的设备会显示在这里' },
};

const Sidebar: React.FC<SidebarProps> = ({
  devices,
  states,
  busy,
  selectedId,
  displayName,
  onSelect,
  onOpenSettings,
}) => {
  const [tab, setTab] = React.useState<SidebarTab>('live');

  const isOffline = (id: string): boolean => {
    const state: DeviceLiveState | undefined = states[id];
    if (state === undefined) return false;
    if (state.error !== '') return true;
    return state.battery === null;
  };

  const pastDevices: BatteryDevice[] = devices.filter((device: BatteryDevice) =>
    isOffline(device.id),
  );
  const pastIds: Set<string> = new Set(pastDevices.map((device: BatteryDevice) => device.id));
  const liveDevices: BatteryDevice[] = devices.filter(
    (device: BatteryDevice) => !pastIds.has(device.id),
  );
  const onlineCount: number = devices.filter(
    (device: BatteryDevice) => (states[device.id]?.battery ?? null) !== null,
  ).length;
  const visible: BatteryDevice[] = tab === 'live' ? liveDevices : pastDevices;
  const empty = EMPTY_TEXT[tab];

  return (
    <aside className="glass-scroll flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-white/30 bg-white/10 backdrop-blur-lg [transform:translateZ(0)] max-lg:w-[76px]">
      <div className="px-5 pt-5 max-lg:px-2 max-lg:pt-4">
        <div className="flex gap-1.5 max-lg:flex-col">
          {TABS.map((item) => {
            const active: boolean = tab === item.key;
            const count: number = item.key === 'live' ? liveDevices.length : pastDevices.length;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                aria-label={item.label}
                title={item.label}
                onClick={() => setTab(item.key)}
                className={cn(
                  'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[12px] font-medium transition-colors max-lg:px-0 max-lg:py-2',
                  active
                    ? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'
                    : 'bg-white/10 text-white/65 hover:bg-white/15',
                )}
              >
                <Icon size={15} className="hidden shrink-0 max-lg:block" />
                <span className="truncate max-lg:hidden">{item.label}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 text-[10px] tabular-nums',
                    active ? 'bg-white/25 text-white/90' : 'bg-white/15 text-white/60',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 px-5 max-lg:px-2">
        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 bg-white/10 px-4 py-5 text-center max-lg:px-1 max-lg:py-3">
            <div className="text-[13px] font-medium text-white/75 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)] max-lg:hidden">
              {empty.title}
            </div>
            <div className="hidden text-[10px] text-white/60 max-lg:block">暂无</div>
            <div className="mt-1 text-xs leading-relaxed text-white/55 max-lg:hidden">
              {empty.hint}
            </div>
          </div>
        ) : (
          visible.map((device: BatteryDevice) => {
            const state: DeviceLiveState | undefined = states[device.id];
            const level = state?.battery != null ? batteryLevel(state.battery) : null;
            const charging = state?.charging === true;
            const batteryText = state?.battery != null ? `${state.battery}%` : '--';
            const sub = busy[device.id]
              ? '读取中…'
              : state?.error
                ? '未连接 · 仅供查看'
                : charging
                  ? CHARGING_LABEL
                  : level !== null
                    ? BATTERY_LEVEL_LABELS[level]
                    : '等待读取';
            const valueColor = charging
              ? CHARGING_HEX
              : level !== null
                ? BATTERY_LEVEL_HEX[level]
                : '#8B84A0';
            return (
              <button
                key={device.id}
                type="button"
                aria-label={`${displayName(device)} ${batteryText}`}
                title={displayName(device)}
                onClick={() => onSelect(device.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors max-lg:flex-col max-lg:gap-1 max-lg:px-1 max-lg:py-2',
                  selectedId === device.id
                    ? 'border-white/35 bg-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'
                    : 'border-transparent bg-white/10 hover:bg-white/15',
                )}
              >
                <Image
                  src={DEVICE_IMAGES[device.kind]}
                  alt={`${device.name} 缩略图`}
                  className="h-[46px] w-[46px] rounded-[10px] border border-white/40 bg-transparent object-contain max-lg:h-10 max-lg:w-10"
                />
                <span className="min-w-0 flex-1 max-lg:hidden">
                  <span className="block break-words text-[13px] font-semibold leading-snug text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">
                    {displayName(device)}
                  </span>
                  <span className="block text-[11px] text-white/65 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">{sub}</span>
                </span>
                <span
                  className="text-[15px] font-bold tabular-nums max-lg:text-[11px]"
                  style={{ color: valueColor }}
                >
                  {batteryText}
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="mt-auto p-5 max-lg:p-2">
        <div className="rounded-xl border border-white/30 bg-white/10 px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] max-lg:px-1.5 max-lg:py-2">
          <div className="flex items-center justify-between gap-2 max-lg:flex-col max-lg:gap-1.5">
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 max-lg:px-2 max-lg:py-1">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  onlineCount > 0 ? 'bg-emerald-500' : 'bg-slate-400',
                )}
              />
              <span className="max-lg:hidden">
                {onlineCount > 0 ? `${onlineCount} 台在线` : '无设备在线'}
              </span>
            </span>
            <button
              type="button"
              aria-label="设置"
              onClick={onOpenSettings}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              <Settings size={15} />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/60 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)] max-lg:hidden">
            <span className="truncate">
              {(() => {
                const current: BatteryDevice | undefined = devices.find(
                  (device: BatteryDevice) => device.id === selectedId,
                );
                if (current === undefined) return '暂无选中设备';
                const brand: string = current.model || current.name;
                const live = states[current.id];
                const conn: string = live?.charging === true ? '有线' : current.connection;
                return `${brand} · ${conn}`;
              })()}
            </span>
            <span className="shrink-0 rounded-full bg-white/60 px-1.5 py-px text-[10px] font-medium">v1.0</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
