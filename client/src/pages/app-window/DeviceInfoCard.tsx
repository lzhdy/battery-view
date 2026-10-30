import React from 'react';

import { formatClock } from './time';
import type { BatteryDevice, DeviceLiveState } from '@client/src/utils/battery/types';

interface DeviceInfoCardProps {
  device: BatteryDevice | null;
  state?: DeviceLiveState;
  lowBatteryThreshold?: number | null;
}

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3 py-[7px] text-[13px]">
    <span className="shrink-0 text-white/65 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">{label}</span>
    <span className="min-w-0 truncate font-medium tabular-nums text-white/90">{value}</span>
  </div>
);

const DeviceInfoCard: React.FC<DeviceInfoCardProps> = ({
  device,
  state,
  lowBatteryThreshold,
}) => {
  const statusNode: React.ReactNode = state?.charging === true ? (
    <span className="text-sky-500">充电中</span>
  ) : state?.battery != null ? (
    <span className="text-emerald-600">在线</span>
  ) : state?.error ? (
    <span className="text-rose-500">读取失败</span>
  ) : (
    <span className="text-white/60">读取中…</span>
  );
  return (
    <div className="flex h-full min-w-0 flex-col rounded-2xl border border-white/35 bg-white/10 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-lg [transform:translateZ(0)]">
      <div className="text-[15px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">设备信息</div>
      <div className="mt-1.5 flex-1 divide-y divide-white/15">
        <InfoRow label="厂商 · 产品" value={device ? device.productId : '—'} />
        <InfoRow
          label="连接方式"
          value={device ? (state?.charging === true ? '有线' : device.connection) : '—'}
        />
        <InfoRow label="协议" value={device ? device.protocol : '—'} />
        <InfoRow label="数据来源" value={device ? device.source : '—'} />
        <InfoRow
          label="低电量阈值"
          value={
            lowBatteryThreshold != null ? `${lowBatteryThreshold}%` : '—'
          }
        />
        <InfoRow label="当前状态" value={statusNode} />
        <InfoRow
          label="更新时间"
          value={state && state.updatedAt > 0 ? formatClock(state.updatedAt) : '—'}
        />
      </div>
    </div>
  );
};

export default DeviceInfoCard;
