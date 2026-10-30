import type { BatteryReading } from './types';

export const MAX_TREND_POINTS = 24;

/** 充电段预测所需最少点数 */
const MIN_CHARGING_POINTS = 5;
/** 放电段预测所需最少点数（放电变化慢，需要更多点） */
const MIN_DISCHARGING_POINTS = 8;
/** 充电段预测所需最少时间跨度（分钟） */
const MIN_CHARGING_SPAN_MIN = 15;
/** 放电段预测所需最少时间跨度（分钟） */
const MIN_DISCHARGING_SPAN_MIN = 60;
/** 初步估算所需最少点数（历史数据不足以通过严格门槛时，先给出方向性预估） */
const MIN_PRELIMINARY_POINTS = 3;
/** 初步估算所需最少时间跨度（分钟） */
const MIN_PRELIMINARY_SPAN_MIN = 10;
/** 判为"平稳"的最小斜率（%/时） */
const MIN_SLOPE = 0.5;
/** 相邻采样最大间隔（分钟）：超过视为数据断档（关机/长时间停止采样），回归时断段 */
const MAX_GAP_MIN = 60;

export type TrendMode = 'charging' | 'discharging' | 'flat' | 'insufficient';

export interface TrendEstimate {
  mode: TrendMode;
  /** 每小时变化率（%/h），正值上升、负值下降 */
  slope: number | null;
  /** 参与回归的数据段起点时间戳 */
  segmentStart: number;
  /** 参与回归的数据段终点时间戳（最新采样） */
  segmentEnd: number;
  /** 数据段时间跨度（毫秒） */
  spanMs: number;
  /** 参与回归的采样点数 */
  sampleCount: number;
  /** 是否为"初步估算"：历史数据未达稳定门槛，但已有足够点给出方向性预估（会随采样持续更新） */
  preliminary: boolean;
  /** 预测充满剩余分钟（mode=charging 时） */
  ttfMinutes: number | null;
  /** 预测续航剩余分钟（mode=discharging 时） */
  tteMinutes: number | null;
  /** 还差多少分钟才满足门槛（mode=insufficient 时提示用） */
  needMoreMinutes: number;
}

/** 3 点移动平均，抑制 ±1-2% 抖动；不足 3 点返回原序列 */
const smooth = (levels: number[]): number[] => {
  if (levels.length < 3) return [...levels];
  const out: number[] = [levels[0]];
  for (let i = 1; i < levels.length - 1; i += 1) {
    out.push((levels[i - 1] + levels[i] + levels[i + 1]) / 3);
  }
  out.push(levels[levels.length - 1]);
  return out;
};

/** 线性回归，返回每小时斜率（%/h） */
const regressSlope = (pts: { at: number; level: number }[]): number | null => {
  const t0: number = pts[0].at;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  pts.forEach((p) => {
    const x: number = (p.at - t0) / 3600000;
    sx += x;
    sy += p.level;
    sxx += x * x;
    sxy += x * p.level;
  });
  const n: number = pts.length;
  const denom: number = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  return (n * sxy - sx * sy) / denom;
};

export const estimateTrend = (readings: BatteryReading[], nowCharging: boolean): TrendEstimate => {
  const clean: BatteryReading[] = Array.isArray(readings)
    ? readings.filter(
        (r): r is BatteryReading =>
          !!r && typeof r === 'object' && typeof r.at === 'number' && typeof r.level === 'number',
      )
    : [];
  const sorted: BatteryReading[] = [...clean].sort(
    (a: BatteryReading, b: BatteryReading) => a.at - b.at,
  );
  if (sorted.length === 0) {
    return {
      mode: 'insufficient',
      slope: null,
      segmentStart: 0,
      segmentEnd: 0,
      spanMs: 0,
      sampleCount: 0,
      preliminary: false,
      ttfMinutes: null,
      tteMinutes: null,
      needMoreMinutes: 0,
    };
  }

  // 1. 取"与当前状态一致且无断档的最近连续段"：
  //    - 从尾部回溯，遇到充电状态切换即停；
  //    - 相邻采样间隔超过 MAX_GAP_MIN（关机/长时间停止采样）即断段，
  //      避免把停机空窗算进跨度而稀释斜率（高估续航）。
  let segIdx = sorted.length - 1;
  while (segIdx >= 0) {
    if (sorted[segIdx].charging !== nowCharging) break;
    if (segIdx < sorted.length - 1) {
      const gapMin: number = (sorted[segIdx + 1].at - sorted[segIdx].at) / 60000;
      if (gapMin > MAX_GAP_MIN) break;
    }
    segIdx -= 1;
  }
  const segment: BatteryReading[] = sorted.slice(segIdx + 1);
  if (segment.length === 0) {
    return {
      mode: 'insufficient',
      slope: null,
      segmentStart: 0,
      segmentEnd: 0,
      spanMs: 0,
      sampleCount: 0,
      preliminary: false,
      ttfMinutes: null,
      tteMinutes: null,
      needMoreMinutes: 0,
    };
  }
  const last: BatteryReading = segment[segment.length - 1];

  // 2. 平滑 level
  const levels: number[] = smooth(segment.map((r: BatteryReading) => r.level));
  const pts: { at: number; level: number }[] = segment.map((r, i) => ({
    at: r.at,
    level: levels[i],
  }));

  const spanMs: number = pts.length > 1 ? pts[pts.length - 1].at - pts[0].at : 0;
  const spanMin: number = spanMs / 60000;

  const minPoints = nowCharging ? MIN_CHARGING_POINTS : MIN_DISCHARGING_POINTS;
  const minSpanMin = nowCharging ? MIN_CHARGING_SPAN_MIN : MIN_DISCHARGING_SPAN_MIN;
  // 跨度差：还差多少分钟才满足门槛；点数差：缺的点数按该段平均采样间隔折算成分钟
  const avgGapMin: number = pts.length > 1 ? spanMin / (pts.length - 1) : 0;
  const spanNeed: number = minSpanMin - spanMin;
  const pointsNeed: number = (minPoints - pts.length) * avgGapMin;
  const needMoreMinutes: number = Math.max(spanNeed, pointsNeed, 0);
  // 提示口径：用户最先能看到的是"初步估算"（≥3 点且 ≥10 分钟跨度即出），
  // 所以 insufficient 提示应报"到初步估算的缺口"，而非到稳定预测的 60 分钟死门槛。
  const prelimSpanNeed: number = MIN_PRELIMINARY_SPAN_MIN - spanMin;
  const prelimPointsNeed: number =
    Math.max(0, MIN_PRELIMINARY_POINTS - pts.length) * avgGapMin;
  const needPrelimMinutes: number = Math.max(prelimSpanNeed, prelimPointsNeed, 0);

  if (pts.length < 2 || spanMs < 60 * 1000) {
    return {
      mode: 'insufficient',
      slope: null,
      segmentStart: last.at,
      segmentEnd: last.at,
      spanMs,
      sampleCount: pts.length,
      preliminary: false,
      ttfMinutes: null,
      tteMinutes: null,
      needMoreMinutes: needPrelimMinutes,
    };
  }

  const slope: number | null = regressSlope(pts);

  // 3. 门槛：点数与跨度均达标，且斜率方向与状态匹配 → 稳定预测
  const enoughPoints: boolean = pts.length >= minPoints;
  const enoughSpan: boolean = spanMin >= minSpanMin;
  const dirMatch: boolean =
    slope !== null && (nowCharging ? slope > 0 : slope < 0);

  if (!enoughPoints || !enoughSpan || !dirMatch || slope === null) {
    const flat: boolean =
      slope !== null && Math.abs(slope) < MIN_SLOPE && enoughPoints && enoughSpan;
    if (flat) {
      return {
        mode: 'flat',
        slope,
        segmentStart: pts[0].at,
        segmentEnd: last.at,
        spanMs,
        sampleCount: pts.length,
        preliminary: false,
        ttfMinutes: null,
        tteMinutes: null,
        needMoreMinutes: 0,
      };
    }
    // 4. 初步估算：未达稳定门槛，但历史数据已足够（≥3 点且 ≥10 分钟跨度）且方向明确，
    //    先给出方向性预估（preliminary=true），持续采样后自动升级为稳定预测。
    const preliminaryOk: boolean =
      slope !== null &&
      dirMatch &&
      pts.length >= MIN_PRELIMINARY_POINTS &&
      spanMin >= MIN_PRELIMINARY_SPAN_MIN;
    if (preliminaryOk && slope !== null) {
      const prelimTtf: number | null = nowCharging ? (100 - last.level) / slope * 60 : null;
      const prelimTte: number | null = !nowCharging ? last.level / -slope * 60 : null;
      return {
        mode: nowCharging ? 'charging' : 'discharging',
        slope,
        segmentStart: pts[0].at,
        segmentEnd: last.at,
        spanMs,
        sampleCount: pts.length,
        preliminary: true,
        ttfMinutes: prelimTtf,
        tteMinutes: prelimTte,
        needMoreMinutes: 0,
      };
    }
    return {
      mode: 'insufficient',
      slope: slope === null || Math.abs(slope) < MIN_SLOPE ? null : slope,
      segmentStart: pts[0].at,
      segmentEnd: last.at,
      spanMs,
      sampleCount: pts.length,
      preliminary: false,
      ttfMinutes: null,
      tteMinutes: null,
      needMoreMinutes: needPrelimMinutes,
    };
  }

  // 5. 稳定预测：TTF / TTE
  const lastLevel: number = last.level;
  const ttfMinutes: number | null = nowCharging
    ? (100 - lastLevel) / slope * 60
    : null;
  const tteMinutes: number | null = !nowCharging
    ? lastLevel / -slope * 60
    : null;

  return {
    mode: nowCharging ? 'charging' : 'discharging',
    slope,
    segmentStart: pts[0].at,
    segmentEnd: last.at,
    spanMs,
    sampleCount: pts.length,
    preliminary: false,
    ttfMinutes,
    tteMinutes,
    needMoreMinutes: 0,
  };
};

export const formatDurationZh = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes < 0) return '--';
  if (minutes > 7 * 24 * 60) return '7 天以上';
  let h: number = Math.floor(minutes / 60);
  let m: number = Math.round(minutes - h * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  if (h === 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
};

/** 供 TrendCard 展示：人类可读的数据段跨度描述 */
export const formatSpanZh = (spanMs: number): string => {
  const minutes: number = Math.round(spanMs / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`;
  const h: number = Math.floor(minutes / 60);
  const m: number = minutes - h * 60;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
};
