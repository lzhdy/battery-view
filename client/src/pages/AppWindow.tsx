import React from 'react';
import { motion } from 'framer-motion';

import { useBatteryApp } from '@client/src/hooks/useBatteryApp';
import { usePopupNotifier } from '@client/src/hooks/usePopupNotifier';
import { loadCustomBackground } from '@client/src/utils/battery/desktop';

import BatteryGauge from './app-window/BatteryGauge';
import DeviceHero from './app-window/DeviceHero';
import DeviceInfoCard from './app-window/DeviceInfoCard';
import RenameDialog from './app-window/RenameDialog';
import SettingsDialog from './app-window/SettingsDialog';
import Sidebar from './app-window/Sidebar';
import TitleBar from './app-window/TitleBar';
import TrendCard from './app-window/TrendCard';

const AppWindow: React.FC = () => {
  const app = useBatteryApp();
  const [settingsOpen, setSettingsOpen] = React.useState<boolean>(false);
  const [renameOpen, setRenameOpen] = React.useState<boolean>(false);

  const selected = React.useMemo(
    () => app.devices.find((device) => device.id === app.selectedId) ?? null,
    [app.devices, app.selectedId],
  );
  const selectedState = selected !== null ? app.states[selected.id] : undefined;
  const selectedBusy = selected !== null && app.busy[selected.id] === true;
  const selectedReadings = React.useMemo(
    () =>
      selected !== null
        ? app.readings
            .filter((reading) => !!reading && reading.deviceId === selected.id)
            .sort((a, b) => a.at - b.at)
        : [],
    [app.readings, selected],
  );
  // 弹窗提醒触发器（4 场景，默认全开；设置开关见 SettingsDialog）
  usePopupNotifier({
    devices: app.devices,
    states: app.states,
    readings: app.readings,
    enabled: {
      boot: app.settings.popupBoot !== false,
      low: app.settings.popupLow !== false,
      charging: app.settings.popupCharging !== false,
    },
  });
  const [backgroundUrl, setBackgroundUrl] = React.useState<string>('');
  React.useEffect(() => {
    let cancelled = false;
    void loadCustomBackground().then((url: string) => {
      if (!cancelled) setBackgroundUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [app.settings.backgroundPath]);
  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[#191a26]">
      {/* ===== 背景层：毛玻璃底图（默认渐变 / 用户导入图片，均可随时更换） ===== */}
      <div className="pointer-events-none absolute inset-0 z-0">
        {/* 最底深色兜底：窗口不透明 + 前端自绘背景，失焦/图片加载失败都不会出现刺眼纯白 */}
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#23243A_0%,#1B1C30_60%,#14141F_100%)]" />
        {backgroundUrl ? (
          <img
            src={backgroundUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-[1.03] object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(160deg,#7C8FD9_0%,#A98FE0_30%,#E7A8D0_62%,#F6D8EC_100%)]" />
        )}
        {/* 深蓝调遮罩：压暗背景凸显前景，保留原图蓝色清新感（不闷不灰） */}
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(10_25_50_0.25)_0%,rgba(0_0_0_0.3)_100%)]" />
        {/* 装饰光斑：深背景下提亮层次 */}
        <div className="absolute -left-[10%] -top-[22%] h-[70vh] w-[62vw] rounded-full bg-[radial-gradient(closest-side,_rgba(120_140_255_0.35),_transparent)] blur-3xl" />
        <div className="absolute -bottom-[26%] -right-[10%] h-[72vh] w-[58vw] rounded-full bg-[radial-gradient(closest-side,_rgba(90_110_220_0.3),_transparent)] blur-3xl" />
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex h-full w-full flex-col overflow-hidden"
      >
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            devices={app.devices}
            states={app.states}
            busy={app.busy}
            selectedId={app.selectedId}
            displayName={app.displayName}
            onSelect={app.select}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <main className="glass-scroll min-w-0 flex-1 overflow-y-auto px-6 pt-[42px] max-lg:px-4 max-lg:pt-[42px]">
            <section className="mb-4 flex shrink-0 gap-4 max-lg:flex-col">
              <div className="flex aspect-square min-w-0 flex-1 rounded-2xl border border-white/35 bg-white/10 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-lg [transform:translateZ(0)] max-lg:aspect-auto max-lg:p-5">
                <DeviceHero
                  device={selected}
                  state={selectedState}
                  busy={selectedBusy}
                  name={selected !== null ? app.displayName(selected) : ''}
                  onOpenRename={() => setRenameOpen(true)}
                />
              </div>
              <div className="flex aspect-square min-w-0 flex-1 rounded-2xl border border-white/35 bg-white/10 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-lg [transform:translateZ(0)] max-lg:aspect-auto max-lg:p-5">
                <BatteryGauge
                  battery={selectedState?.battery ?? null}
                  charging={selectedState?.charging === true}
                  busy={selectedBusy}
                  onRefresh={() => {
                    if (selected !== null) app.refresh(selected.id);
                  }}
                  canRefresh={selected !== null}
                />
              </div>
            </section>
            <section className="mb-4 grid min-h-[268px] grid-cols-[1fr_320px] gap-4 max-lg:grid-cols-1">
              <TrendCard readings={selectedReadings} charging={selectedState?.charging === true} gearKey={selected?.productId} />
              <DeviceInfoCard
                device={selected}
                state={selectedState}
                lowBatteryThreshold={
                  selected !== null ? (app.thresholds[selected.id] ?? null) : null
                }
              />
            </section>
            {/* 底部 spacer：block 布局滚动容器的滚动高度计算正常，底部余量可靠 */}
            <div className="h-24" />
          </main>
        </div>
      </motion.div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={app.settings}
        onUpdate={app.updateSettings}
        onClearHistory={() => app.clearHistory()}
      />
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        device={selected}
        currentName={selected !== null ? app.displayName(selected) : ''}
        onRename={(name) => {
          if (selected !== null) app.rename(selected.id, name);
        }}
      />
    </div>
  );
};

export default AppWindow;
