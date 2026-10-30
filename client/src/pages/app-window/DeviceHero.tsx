import React from 'react';
import { Plug } from 'lucide-react';

import { formatClock } from './time';
import {
  CONNECTION_MODES,
  CONNECTION_READ_TEXT,
  DEVICE_IMAGES,
  DEVICE_KIND_LABELS,
} from '@client/src/utils/battery/demo';
import type { BatteryDevice, DeviceLiveState } from '@client/src/utils/battery/types';
import { Image } from '@client/src/components/ui/image';

interface DeviceHeroProps {
  device: BatteryDevice | null;
  state?: DeviceLiveState;
  busy: boolean;
  name: string;
  onOpenRename: () => void;
}

const DeviceHero: React.FC<DeviceHeroProps> = ({
  device,
  state,
  busy,
  name,
  onOpenRename,
}) => {
  if (device === null) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
          Device / 设备
        </div>
        <div className="mt-3 flex items-center gap-2 text-[28px] font-semibold leading-tight text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.35)]">
          <Plug size={26} className="text-white/70" />
          未选择设备
        </div>
        <div className="mt-1 text-sm text-white/65">在左侧设备列表中选择一台设备</div>
        <div className="mt-auto text-xs leading-relaxed text-white/60">
          数据源：BatteryProvider
          <br />
          更新于 --:--:--
        </div>
      </div>
    );
  }
  const typeLabel = DEVICE_KIND_LABELS[device.kind];
  // 充电必插线：充电中时连接方式动态覆盖为"有线"（HID 枚举节点可能仍是接收器）
  const effectiveConn = state?.charging === true ? '有线' : device.connection;
  const connectionText =
    CONNECTION_READ_TEXT[effectiveConn] ?? `${effectiveConn} · 本地读取`;
  const updatedAt = state?.updatedAt ?? 0;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
          {typeLabel}
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="min-w-0 truncate text-left text-[30px] font-bold leading-tight text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.35)] max-lg:whitespace-normal max-lg:break-words max-lg:text-[24px]">
            {name}
          </h1>
          <button
            type="button"
            onClick={onOpenRename}
            className="shrink-0 rounded-md text-xs font-medium text-sky-300 hover:underline hover:text-sky-200"
          >
            编辑
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center py-3 max-lg:min-h-[180px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side,_rgba(255_255_255_0.35),_transparent)]" />
        <Image
          src={DEVICE_IMAGES[device.kind]}
          alt={`${device.name} 设备图`}
          className="relative max-h-[300px] w-full bg-transparent object-contain"
        />
      </div>
      <div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {CONNECTION_MODES.map((mode) => {
            const active = effectiveConn === mode && !state?.error;
            return (
              <span
                key={mode}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-sky-300/80 bg-white/30 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
                    : 'border-white/20 bg-white/5 text-white/55'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-sky-400' : 'bg-white/30'}`}
                />
                {mode}
              </span>
            );
          })}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-white/65 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
          <span>{connectionText}</span>
          <span className="h-1 w-1 rounded-full bg-white/30" />
          <span>更新于 {updatedAt > 0 ? formatClock(updatedAt) : '--:--:--'}</span>
          {busy ? (
            <>
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span>读取中…</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default DeviceHero;
