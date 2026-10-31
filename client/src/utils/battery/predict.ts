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

/** 档位粒度（%）：如 5、10、20 */
interface GearMode {
  granularity: number;
  /** 每掉/涨一档的平均耗时（分钟） */
  perGearMinutes: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * 检测"档位式"电量：读数按离散档位跳变（5%/10%/20%…，不固定粒度），
 * 而非 1% 连续变化。判断依据：段内不同档位的相邻差值全部是同一公约数的倍数，
 * 且粒度 ∈ [2, 25]。阶梯数据对线性回归极不友好（档位切换瞬间 15s 掉 5%
 * → 虚大斜率、TTE 几分钟；档位内 → 判平稳无预测），故此类设备改用每档耗时估算。
 *
 * 关键边界：
 * 1. 必须 ≥2 次有效档位跳变才承认粒度；
 * 2. 关机跳变剔除——程序关闭一段时间后重启、电量一下跨档，该次跳变前的
 *    采样间隔远大于正常轮询间隔，属于关机空窗的累积跳变，不计入粒度证据
 *    （否则真实 5% 设备会被关机 10% 跳变污染，perGear 严重偏短）。
 */
const detectGearMode = (segment: BatteryReading[]): GearMode | null => {
  if (segment.length < 2) return null;
  const levels: number[] = [...new Set(segment.map((r) => Math.round(r.level)))].sort(
    (a, b) => a - b,
  );
  if (levels.length < 3) return null; // 至少 3 个档位值 = ≥2 次独立跳变
  const diffs: number[] = [];
  for (let i = 1; i < levels.length; i += 1) {
    const d: number = levels[i] - levels[i - 1];
    if (d >= 1) diffs.push(d);
  }
  if (diffs.length === 0) return null;
  const g: number = diffs.reduce(gcd, diffs[0]);
  if (g < 2 || g > 25) return null;
  // 正常采样间隔（段内相邻样本间隔的中位数），用于识别关机空窗跳变
  const sampleGaps: number[] = [];
  for (let i = 1; i < segment.length; i += 1) {
    sampleGaps.push(segment[i].at - segment[i - 1].at);
  }
  sampleGaps.sort((a, b) => a - b);
  const medianSampleGap: number = sampleGaps[Math.floor(sampleGaps.length / 2)] || 15000;
  // 切换前 gap 超过 max(中位间隔×20, 5 分钟) → 判定为关机累积跳变，剔除。
  // 一天内多次开关程序的场景下，每次重启跳变都落在此区间，不会混入粒度证据。
  const staleGapThreshold: number = Math.max(medianSampleGap * 20, 5 * 60000);
  const switchTimes: number[] = [];
  let prevAt: number = segment[0].at;
  let lastSeen: number = Math.round(segment[0].level);
  for (let i = 1; i < segment.length; i += 1) {
    const lv: number = Math.round(segment[i].level);
    if (lv !== lastSeen) {
      if (segment[i].at - prevAt <= staleGapThreshold) switchTimes.push(segment[i].at);
      lastSeen = lv;
    }
    prevAt = segment[i].at;
  }
  if (switchTimes.length < 2) return null; // 剔除关机跳变后证据不足
  // 每档耗时：取"两段相邻有效切换之间全程连续采样"的间隔中位数。
  // 关机空窗所在切换已被剔除，但若两次切换之间隔着一次关机（切换本身合法、
  // 间隔里混入空窗时长），该间隔丢弃——宁可回退回归，不给被污染的档位预测。
  const intervals: number[] = [];
  for (let i = 1; i < switchTimes.length; i += 1) {
    const tA: number = switchTimes[i - 1];
    const tB: number = switchTimes[i];
    let maxGapInBetween: number = 0;
    for (let j = 1; j < segment.length; j += 1) {
      if (segment[j].at >= tA && segment[j].at <= tB) {
        maxGapInBetween = Math.max(maxGapInBetween, segment[j].at - segment[j - 1].at);
      }
    }
    if (maxGapInBetween <= staleGapThreshold) intervals.push(tB - tA);
  }
  if (intervals.length === 0) return null;
  intervals.sort((a, b) => a - b);
  const perGearMs: number = intervals[Math.floor(intervals.length / 2)];
  if (perGearMs < 10 * 60000) return null; // 每档不足 10 分钟：异常快，视为数据污染
  return { granularity: g, perGearMinutes: perGearMs / 60000 };
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

  // 2.5 档位式设备（电量按 5%/10%/20% 离散跳变）：回归斜率会被阶梯数据搅出
  // 虚大值（档位切换瞬间）或判平稳（档位内），改用"每档耗时"直接估算 TTF/TTE，
  // 等效斜率仍返回，供趋势图显示与预测线绘制。
  const gear: GearMode | null = detectGearMode(segment);
  if (gear !== null) {
    const lastLevel: number = last.level;
    if (nowCharging) {
      const remainingGears: number = Math.floor((100 - lastLevel) / gear.granularity);
      const ttfMinutes: number = remainingGears * gear.perGearMinutes;
      const equivSlope: number = (gear.granularity * 60) / gear.perGearMinutes;
      return {
        mode: 'charging',
        slope: equivSlope,
        segmentStart: pts[0].at,
        segmentEnd: last.at,
        spanMs,
        sampleCount: pts.length,
        preliminary: false,
        ttfMinutes,
        tteMinutes: null,
        needMoreMinutes: 0,
      };
    }
    const remainingGears: number = Math.floor(lastLevel / gear.granularity);
    const tteMinutes: number = remainingGears * gear.perGearMinutes;
    const equivSlope: number = -(gear.granularity * 60) / gear.perGearMinutes;
    return {
      mode: 'discharging',
      slope: equivSlope,
      segmentStart: pts[0].at,
      segmentEnd: last.at,
      spanMs,
      sampleCount: pts.length,
      preliminary: false,
      ttfMinutes: null,
      tteMinutes,
      needMoreMinutes: 0,
    };
  }

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
