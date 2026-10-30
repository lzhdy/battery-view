import React from 'react';
import { RotateCw, Zap } from 'lucide-react';

import {
  BATTERY_LEVEL_HEX,
  BATTERY_LEVEL_LABELS,
  CHARGING_HEX,
  CHARGING_LABEL,
  batteryLevel,
} from '@client/src/utils/battery/types';

const RADIUS = 92;
const CIRC = 2 * Math.PI * RADIUS;

interface BatteryGaugeProps {
  battery: number | null;
  charging: boolean;
  busy: boolean;
  onRefresh: () => void;
  canRefresh: boolean;
}

const BatteryGauge: React.FC<BatteryGaugeProps> = ({
  battery,
  charging,
  busy,
  onRefresh,
  canRefresh,
}) => {
  const level = battery !== null ? batteryLevel(battery) : null;
  const ringColor = charging
    ? CHARGING_HEX
    : level !== null
      ? BATTERY_LEVEL_HEX[level]
      : '#8B84A0';
  const offset = CIRC * (1 - (battery ?? 0) / 100);
  const frac = battery !== null ? Math.max(0, Math.min(100, battery)) / 100 : 0;
  const DIGIT_HEIGHT = 33;
  const numberSizeClass = busy
    ? 'animate-pulse text-[46px] font-bold tabular-nums'
    : 'text-[46px] font-bold tabular-nums';
  const statusLabel = charging
    ? CHARGING_LABEL
    : level !== null
      ? BATTERY_LEVEL_LABELS[level]
      : busy
        ? '读取中…'
        : '等待读取';
  return (
    <div className="flex w-full flex-col items-center justify-center">
      <svg width="220" height="220" viewBox="0 0 220 220" role="img" aria-label="电量环形图">
        <circle
          cx="110"
          cy="110"
          r={RADIUS}
          fill="none"
          stroke="rgba(42,34,51,0.08)"
          strokeWidth="14"
        />
        <circle
          cx="110"
          cy="110"
          r={RADIUS}
          fill="none"
          stroke={ringColor}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          transform="rotate(-90 110 110)"
          style={{
            transition: 'stroke-dashoffset 0.7s ease-out, stroke 0.3s linear',
            filter: charging ? `drop-shadow(0 0 6px ${CHARGING_HEX}80)` : 'none',
          }}
        />
        {charging ? (
          <circle
            className="ring-sweep"
            cx="110"
            cy="110"
            r={RADIUS}
            fill="none"
            stroke="#A9C9FF"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray="30 548"
            transform="rotate(-90 110 110)"
          />
        ) : null}
        {battery !== null ? (
          <>
            <defs>
              <clipPath id="battery-number-fill">
                <rect
                  x="0"
                  y={108 - DIGIT_HEIGHT * frac}
                  width="220"
                  height={DIGIT_HEIGHT * frac}
                  style={{ transition: 'y 0.7s ease-out, height 0.7s ease-out' }}
                />
              </clipPath>
            </defs>
            <text
              x="110"
              y="108"
              textAnchor="middle"
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="1.5"
              className={numberSizeClass}
            >
              {battery}
            </text>
            <text
              x="110"
              y="108"
              textAnchor="middle"
              fill={ringColor}
              clipPath="url(#battery-number-fill)"
              className={numberSizeClass}
            >
              {battery}
            </text>
          </>
        ) : (
          <text
            x="110"
            y="108"
            textAnchor="middle"
            className="animate-pulse fill-white/60 text-[46px] font-bold tabular-nums"
          >
            --
          </text>
        )}
        <text x="110" y="136" textAnchor="middle" className="fill-white/70 text-[14px] font-medium">
          电量 %
        </text>
      </svg>
      <div className="mt-3 flex items-center gap-1.5">
        {charging ? <Zap size={15} style={{ color: CHARGING_HEX }} /> : null}
        <span
          className="text-[15px] font-medium"
          style={{ color: charging ? CHARGING_HEX : 'rgba(255,255,255,0.75)' }}
        >
          {statusLabel}
        </span>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={!canRefresh || busy}
        className="mt-4 flex items-center gap-1.5 rounded-xl border border-white/25 bg-gradient-to-b from-white/25 to-white/10 px-3.5 py-2 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(59,130,246,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] transition-colors hover:from-white/35 hover:to-white/15 disabled:opacity-50"
      >
        <RotateCw size={14} className={busy ? 'animate-spin' : ''} />
        立即刷新
      </button>
    </div>
  );
};

export default BatteryGauge;
