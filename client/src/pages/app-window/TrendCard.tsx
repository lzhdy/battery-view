import React from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { BatteryCharging, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import dayjs from 'dayjs';

import {
  estimateTrend,
  formatDurationZh,
  formatSpanZh,
  MAX_TREND_POINTS,
  type TrendEstimate,
} from '@client/src/utils/battery/predict';
import {
  BATTERY_LEVEL_HEX,
  batteryLevel,
  CHARGING_HEX,
  type BatteryReading,
} from '@client/src/utils/battery/types';

interface TrendCardProps {
  readings: BatteryReading[];
  charging: boolean;
}

const TrendCard: React.FC<TrendCardProps> = ({ readings, charging }) => {
  const safe: BatteryReading[] = (Array.isArray(readings) ? readings : []).filter(
    (r) => !!r && typeof r === 'object' && typeof r.at === 'number' && typeof r.level === 'number',
  );
  const est: TrendEstimate = estimateTrend(safe, charging);
  const points: [number, number][] = safe
    .slice(-MAX_TREND_POINTS)
    .map((r: BatteryReading): [number, number] => [r.at, r.level]);
  const last = points.length > 0 ? points[points.length - 1] : null;

  const forecastLabel: string | null = (() => {
    if (est.mode === 'charging' && est.ttfMinutes !== null) {
      return `预计 ${formatDurationZh(est.ttfMinutes)} 后充满`;
    }
    if (est.mode === 'discharging' && est.tteMinutes !== null) {
      const prefix = est.preliminary ? '初步预计还能用' : '预计还能用';
      return `${prefix} ${formatDurationZh(est.tteMinutes)}`;
    }
    return null;
  })();

  const detailLabel: string | null = (() => {
    if (est.mode === 'charging' || est.mode === 'discharging') {
      const dir = est.mode === 'charging' ? '升' : '降';
      const base = `最近 ${formatSpanZh(est.spanMs)} · 约${dir}${Math.abs(est.slope ?? 0).toFixed(1)}%/时 · ${est.sampleCount} 个采样`;
      return est.preliminary ? `${base} · 初步估算，持续采样更准` : base;
    }
    if (est.mode === 'flat') return '电量平稳 · 暂无预测需求';
    if (est.mode === 'insufficient') {
      if (est.sampleCount === 0) return '读取电量后自动生成趋势';
      const needHours = Math.ceil(est.needMoreMinutes / 60);
      const unit = needHours > 1 ? '小时' : '分钟';
      const num = needHours > 1 ? needHours : Math.max(1, Math.ceil(est.needMoreMinutes));
      return charging
        ? `收集充电数据中（还需约 ${num} ${unit}出初步估算）`
        : `收集使用数据中（还需约 ${num} ${unit}出初步估算）`;
    }
    return null;
  })();

  const FORECAST_MS = 60 * 60 * 1000;
  const forecastPoints: [number, number][] = (() => {
    if (!last || est.slope === null) return [];
    if (est.mode === 'charging' && est.ttfMinutes !== null) {
      const capAt: number = last[0] + est.ttfMinutes * 60000;
      return [
        [last[0], last[1]],
        [capAt, 100],
      ];
    }
    if (est.mode === 'discharging' && est.tteMinutes !== null) {
      const emptyAt: number = last[0] + est.tteMinutes * 60000;
      return [
        [last[0], last[1]],
        [emptyAt, 0],
      ];
    }
    return [];
  })();

  // 只有无 forecast 时才用 1 小时线性外推虚线作为提示
  const hintPoints: [number, number][] =
    forecastPoints.length === 0 && last && est.slope !== null
      ? [
          [last[0], last[1]],
          [last[0] + FORECAST_MS, Math.min(100, Math.max(0, last[1] + (est.slope as number)))],
        ]
      : [];

  const currentLevel: number | null = last !== null ? last[1] : null;
  const levelHex: string | null =
    currentLevel !== null ? BATTERY_LEVEL_HEX[batteryLevel(currentLevel)] : null;
  /** 联动色：充电中恒用充电蓝；放电按电量等级（高绿 / 中橙黄 / 低红） */
  const lineColor: string = charging || levelHex === null ? CHARGING_HEX : levelHex;
  const statusColor: string =
    forecastLabel !== null && levelHex !== null ? levelHex : 'rgba(255,255,255,0.75)';
  const statusText = forecastLabel ?? detailLabel ?? '暂无记录';

  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const value: [number, number] = first.value as [number, number];
        return `${dayjs(value[0]).format('MM-DD HH:mm')}<br/>电量 ${value[1]}%`;
      },
    },
    legend: { show: false, bottom: 0 },
    grid: { left: 8, right: 16, top: 16, bottom: 28, containLabel: true },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.35)' } },
      axisLabel: {
        color: 'rgba(255,255,255,0.75)',
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowBlur: 3,
        textShadowOffsetY: 1,
        formatter: (value: number) => dayjs(value).format('HH:mm'),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 25,
      axisLabel: {
        color: 'rgba(255,255,255,0.75)',
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowBlur: 3,
        textShadowOffsetY: 1,
      },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.18)', type: 'dashed' } },
    },
    series: [
      {
        type: 'line',
        name: '电量',
        data: points,
        // ECharts 6 起 line 默认 symbol 为空心圆（白底描边），显式指定实心 circle 保持旧视觉
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2.5, color: lineColor },
        itemStyle: { color: lineColor },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${lineColor}66` },
              { offset: 1, color: `${lineColor}00` },
            ],
          },
        },
      },
      ...(forecastPoints.length > 0
        ? [
            {
              type: 'line' as const,
              name: '预测',
              data: forecastPoints,
              symbol: 'none',
              lineStyle: {
                width: 2,
                type: 'dashed' as const,
                color: `${lineColor}8C`,
              },
              itemStyle: {
                color: `${lineColor}8C`,
              },
            },
          ]
        : []),
      ...(hintPoints.length > 0
        ? [
            {
              type: 'line' as const,
              name: '趋势',
              data: hintPoints,
              symbol: 'none',
              lineStyle: {
                width: 1.5,
                type: 'dotted' as const,
                color: 'rgba(255,255,255,0.35)',
              },
              itemStyle: { color: 'rgba(255,255,255,0.35)' },
            },
          ]
        : []),
    ],
  };

  const statusIcon = charging
    ? est.mode === 'charging'
      ? TrendingUp
      : BatteryCharging
    : est.mode === 'discharging'
      ? TrendingDown
      : Minus;
  const StatusIcon = statusIcon;

  return (
    <div className="flex h-full min-w-0 flex-col rounded-2xl border border-white/35 bg-white/10 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-lg [transform:translateZ(0)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">电量趋势</div>
        <div className="flex items-center gap-1.5">
          <StatusIcon size={14} style={{ color: statusColor }} />
          <span className="text-[13px] font-medium" style={{ color: statusColor }}>
            {statusText}
          </span>
        </div>
      </div>
      {forecastLabel !== null && detailLabel !== null ? (
        <div
          className="mt-0.5 text-right text-[11px] [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]"
          style={{ color: statusColor }}
        >
          {detailLabel}
        </div>
      ) : null}
      {points.length === 0 ? (
        <div className="mt-2 flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/10 text-xs text-white/60">
          {detailLabel ?? '读取电量后自动生成趋势'}
        </div>
      ) : (
        <ReactECharts option={option} theme="ud" className="mt-3 min-h-0 w-full flex-1" />
      )}
    </div>
  );
};

export default TrendCard;
