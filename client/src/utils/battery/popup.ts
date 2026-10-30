/**
 * 系统弹窗：毛玻璃迷你卡片，右下角弹出、置顶。
 * 触发逻辑在 usePopupNotifier；UI 在 PopupPage。
 */
import { getDesktopBridge } from './desktop';

export interface PopupDeviceRow {
  kind: 'mouse' | 'keyboard' | 'headset' | 'gamepad';
  name: string;
  level: number; // 0-100，-1=未知
  charging: boolean;
  sub: string; // 副文案（预计可用时长 / 请连接充电线 / 预计充满时间）
}

export interface PopupPayload {
  kind: 'boot' | 'low' | 'crit' | 'charging';
  sticky: boolean; // true=需手动关闭；false=5s 自动消失
  title: string;
  devices: PopupDeviceRow[];
}

/** 弹窗窗口高度（卡片全铺窗口；行高固定 45px，与 PopupPage ROW_H 一致）：
 * 内容高 = n×45 + 行间距 (n-1)×12 + 卡片上下内边距 20；窗口 = 内容高 */
export const popupHeight = (devices: number): number =>
  devices * 45 + (devices > 1 ? (devices - 1) * 12 : 0) + 20;

export const showPopup = async (payload: PopupPayload): Promise<void> => {
  const core = getDesktopBridge();
  if (!core) return;
  const height = popupHeight(payload.devices.length);
  await core
    .invoke('show_popup', {
      payload: JSON.stringify(payload),
      height,
    })
    .catch((e: unknown) => {
      console.error('[popup] show_popup failed:', e);
    });
};

export const closePopup = async (): Promise<void> => {
  const core = getDesktopBridge();
  if (!core) return;
  await core.invoke('close_popup').catch(() => undefined);
};
