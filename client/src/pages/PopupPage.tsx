import React from 'react';
import { X } from 'lucide-react';

import type { PopupPayload } from '@client/src/utils/battery/popup';
import type { DeviceKind } from '@client/src/utils/battery/types';
import { closePopup } from '@client/src/utils/battery/popup';
import { DEVICE_IMAGES } from '@client/src/utils/battery/demo';
import { loadCustomBackground } from '@client/src/utils/battery/desktop';

/** 电量颜色：充电蓝 / ≥50 绿 / ≥20 橙 / <20 红 */
const levelColor = (level: number, charging: boolean): string => {
  if (charging) return '#2563EB';
  if (level >= 50) return '#16A34A';
  if (level >= 20) return '#EA580C';
  return '#DC2626';
};

/** 单行固定高度 = 内容总高 45px（名称 12 + gap 7 + 电量条 9 + gap 7 + 信息 10），与 popupHeight 公式严格一致 */
const ROW_H = 45;

/**
 * 弹窗（与主界面同视觉）：
 *  背景复用主界面自定义背景图（浅色系）+ 半透明白玻璃蒙层；
 *  左列设备图标 / 右列名称 → 电量条（充电流光）→ 状态小字；
 *  行高固定 45px、外层上下内边距 10px，上下空白完全对称，无 flex 均分空隙。
 */
const Row: React.FC<{
  kind: DeviceKind;
  name: string;
  level: number;
  charging: boolean;
  sub: string;
}> = ({ kind, name, level, charging, sub }) => {
  const color = levelColor(level, charging);
  const pct = level < 0 ? '--' : `${level}%`;
  const width = level < 0 ? '0%' : `${Math.max(4, level)}%`;
  return (
    <div className="flex h-[45px] w-full shrink-0 items-stretch gap-0">
      {/* 左：设备图标（透明底，浅色背景上清晰） */}
      <div className="flex w-12 shrink-0 items-center justify-center">
        <img
          src={DEVICE_IMAGES[kind] ?? DEVICE_IMAGES.mouse}
          alt=""
          className="h-11 w-11 object-contain"
          draggable={false}
        />
      </div>
      {/* 右列：名称 / 电量条 / 信息 */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[7px] pl-2.5">
        {/* 名称（短行，完整显示不截断） */}
        <div className="text-[12px] font-bold leading-none text-[#23243A] [overflow-wrap:anywhere]">
          {name}
        </div>
        {/* 电量条（视觉中心，充电时流光动画） */}
        <div className="flex items-center gap-2">
          <div className="relative h-[9px] min-w-0 flex-1 overflow-hidden rounded-full bg-black/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]">
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width, backgroundColor: color }}
            />
            {charging ? (
              <div
                className="pointer-events-none absolute inset-y-0 left-0 rounded-full bv-shimmer"
                style={{ width }}
              />
            ) : null}
          </div>
          {/* 百分比固定宽度（预留 100% 三位数）、无闪电图标 → 各设备电量条长度一致 */}
          <span
            className="inline-block w-[38px] shrink-0 text-right text-[12px] font-extrabold leading-none tabular-nums"
            style={{ color }}
          >
            {pct}
          </span>
        </div>
        {/* 信息（小字：状态 + 预计时间） */}
        <div className="text-[10px] leading-none text-[#23243A]/60 [overflow-wrap:anywhere]">
          {sub}
        </div>
      </div>
    </div>
  );
};

const PopupPage: React.FC = () => {
  const [payload, setPayload] = React.useState<PopupPayload | null>(null);
  const [bgUrl, setBgUrl] = React.useState<string | null>(null);
  const timerRef = React.useRef<number | null>(null);

  // 加载主界面自定义背景图（data URL），弹窗与主界面同背景
  React.useEffect(() => {
    loadCustomBackground().then((v) => setBgUrl(v || null));
  }, []);

  React.useEffect(() => {
    document.documentElement.style.margin = '0';
    document.documentElement.style.padding = '0';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    // 不透明窗口 + CSS 圆角：四角露出 body 底色，设为卡片主色避免白角
    document.body.style.background = '#e2eaff';

    type WinWithPopup = Window & {
      __popupPayload?: PopupPayload;
      __showPopup?: (data: PopupPayload) => void;
    };
    const win = window as WinWithPopup;

    const apply = (data: PopupPayload) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setPayload(data);
      if (!data.sticky) {
        timerRef.current = window.setTimeout(() => {
          void closePopup();
        }, 5000);
      }
    };

    if (win.__popupPayload) {
      apply(win.__popupPayload);
      win.__popupPayload = undefined;
    }
    win.__showPopup = apply;
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<PopupPayload>).detail;
      if (detail) apply(detail);
    };
    window.addEventListener('app:popup', onEvent);

    return () => {
      window.removeEventListener('app:popup', onEvent);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const sticky = payload?.sticky === true;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[10px] bg-[linear-gradient(160deg,#f6f9ff_0%,#e2eaff_60%,#d3e0ff_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-2px_6px_rgba(255,255,255,0.35),inset_0_0_0_1px_rgba(255,255,255,0.25)]"
      style={
        bgUrl
          ? {
              backgroundImage: `url("${bgUrl}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      {/* 玻璃蒙层：保证文字可读，呈现与主界面一致的浅色玻璃质感 */}
      <div className="pointer-events-none absolute inset-0 bg-[rgba(255,255,255,0.55)]" />
      {payload ? (
        <div className="relative flex h-full w-full flex-col gap-[12px] px-2 py-[10px]">
          {sticky ? (
            <button
              type="button"
              onClick={() => void closePopup()}
              className="absolute -right-0.5 -top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/10 text-white shadow-[0_1px_4px_rgba(0,0,0,0.2)] transition-colors hover:bg-black/25"
              aria-label="关闭"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          ) : null}
          {payload.devices.map((d, i) => (
            <Row
              key={`${d.name}-${i}`}
              kind={d.kind}
              name={d.name}
              level={d.level}
              charging={d.charging}
              sub={d.sub}
            />
          ))}
        </div>
      ) : null}
      <style>{`
        .bv-shimmer {
          background: linear-gradient(
            100deg,
            rgba(255,255,255,0) 0%,
            rgba(255,255,255,0.6) 50%,
            rgba(255,255,255,0) 100%
          );
          background-size: 45% 100%;
          background-repeat: no-repeat;
          animation: bv-shimmer-move 1.5s linear infinite;
        }
        @keyframes bv-shimmer-move {
          0% { background-position: -60% 0; }
          100% { background-position: 160% 0; }
        }
      `}</style>
    </div>
  );
};

export default PopupPage;
