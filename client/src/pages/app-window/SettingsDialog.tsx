import React from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@client/src/components/ui/alert-dialog';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Switch } from '@client/src/components/ui/switch';
import { getDesktopBridge } from '@client/src/utils/battery/desktop';
import type { AppSettings } from '@client/src/utils/battery/store';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onClearHistory: () => void;
}

const INTERVAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '60', label: '1 分钟' },
  { value: '300', label: '5 分钟' },
  { value: '600', label: '10 分钟' },
  { value: '1800', label: '30 分钟' },
];

const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onOpenChange,
  settings,
  onUpdate,
  onClearHistory,
}) => {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [bgBusy, setBgBusy] = React.useState<boolean>(false);
  const [bgMsg, setBgMsg] = React.useState<string>('');

  const pickBackground = (): void => {
    fileRef.current?.click();
  };

  const applyBackground = async (): Promise<void> => {
    setBgBusy(true);
    setBgMsg('');
    try {
      const bridge = getDesktopBridge();
      if (!bridge) {
        setBgMsg('当前运行环境不支持自定义背景');
        return;
      }
      await bridge.invoke('remove_background');
      onUpdate({ backgroundPath: '' });
      setBgMsg('已恢复默认背景');
    } catch {
      setBgMsg('恢复失败，请稍后重试');
    } finally {
      setBgBusy(false);
    }
  };

  const onFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBgBusy(true);
    setBgMsg('');
    try {
      const bridge = getDesktopBridge();
      if (!bridge) {
        setBgMsg('当前运行环境不支持自定义背景');
        return;
      }
      const dataUrl: string = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      const path: unknown = await bridge.invoke('save_background', {
        data: dataUrl,
      });
      onUpdate({ backgroundPath: typeof path === 'string' ? path : '' });
      setBgMsg('已应用新背景');
    } catch (err) {
      setBgMsg(err instanceof Error ? err.message : '导入失败，请稍后重试');
    } finally {
      setBgBusy(false);
      event.target.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>自动刷新、弹窗提醒、界面背景与历史记录管理</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-medium">开机自启</div>
            <div className="text-xs text-muted-foreground">登录 Windows 后自动在后台运行</div>
          </div>
          <Switch
            checked={settings.autoStart !== false}
            onCheckedChange={(checked: boolean) => onUpdate({ autoStart: checked })}
            aria-label="开机自启"
          />
        </div>
        <div className="flex items-center justify-between border-t py-3">
          <div>
            <div className="text-sm font-medium">自动刷新</div>
            <div className="text-xs text-muted-foreground">按间隔自动读取所有设备电量</div>
          </div>
          <Switch
            checked={settings.autoRefresh}
            onCheckedChange={(checked: boolean) => onUpdate({ autoRefresh: checked })}
            aria-label="自动刷新"
          />
        </div>
        <div className="flex items-center justify-between border-t py-3">
          <div>
            <div className="text-sm font-medium">刷新间隔</div>
            <div className="text-xs text-muted-foreground">两次读取之间的时间间隔</div>
          </div>
          <Select
            value={String(settings.intervalSec)}
            onValueChange={(value: string) => onUpdate({ intervalSec: Number(value) })}
            disabled={!settings.autoRefresh}
          >
            <SelectTrigger className="w-[110px]" aria-label="刷新间隔">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVAL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="border-t py-3">
          <div className="text-sm font-medium">弹窗提醒</div>
          <div className="text-xs text-muted-foreground">电量状态变化时在右下角弹出提示卡片</div>
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[13px]">开机弹窗</div>
              <div className="text-[11px] text-muted-foreground">启动时列出所有设备电量</div>
              <Switch
                checked={settings.popupBoot !== false}
                onCheckedChange={(checked: boolean) => onUpdate({ popupBoot: checked })}
                aria-label="开机弹窗"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[13px]">低电提醒</div>
              <div className="text-[11px] text-muted-foreground">{'低于 20% 提醒（含 <10% 过低）'}</div>
              <Switch
                checked={settings.popupLow !== false}
                onCheckedChange={(checked: boolean) => onUpdate({ popupLow: checked })}
                aria-label="低电提醒"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[13px]">充电提醒</div>
              <div className="text-[11px] text-muted-foreground">开始充电时弹提示</div>
              <Switch
                checked={settings.popupCharging !== false}
                onCheckedChange={(checked: boolean) => onUpdate({ popupCharging: checked })}
                aria-label="充电提醒"
              />
            </div>
          </div>
        </div>
        <div className="border-t py-3">
          <div className="text-sm font-medium">界面背景</div>
          <div className="text-xs text-muted-foreground">
            自定义毛玻璃底图，建议使用浅色、约 1920×1080 的图片
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <Button type="button" size="sm" onClick={pickBackground} disabled={bgBusy}>
              {bgBusy ? '处理中…' : settings.backgroundPath ? '更换图片' : '选择图片'}
            </Button>
            {settings.backgroundPath ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void applyBackground()}
                disabled={bgBusy}
              >
                恢复默认
              </Button>
            ) : null}
          </div>
          {bgMsg ? <div className="mt-1.5 text-xs text-emerald-600">{bgMsg}</div> : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => void onFileChange(event)}
          />
        </div>
        <div className="flex items-center justify-between border-t py-3">
          <div>
            <div className="text-sm font-medium">历史记录</div>
            <div className="text-xs text-muted-foreground">清除后趋势图将从零开始</div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                清除全部历史
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清除全部历史记录？</AlertDialogTitle>
                <AlertDialogDescription>
                  所有设备的电量趋势记录将被删除，此操作不可撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => onClearHistory()}>清除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
