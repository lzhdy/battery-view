# 妙搭 → Tauri 桌面程序迁移指南

本应用（外设电量坞）是**纯前端**实现：全部界面在 `client/src` 内，数据层通过 `BatteryProvider` 接口注入，现阶段挂的是演示数据源。迁移到 Tauri 时界面代码几乎原样搬走，主要工作是：剥离平台依赖、把 `BatteryProvider` 换成调用 Rust 的真实 HID 读取。图片已经是本地 `client/src/assets/*.jpg`，无需再下载。

## 1. 迁移总览

| 部分 | 处理方式 |
| --- | --- |
| `client/src/pages/`、`hooks/useBatteryApp.ts`、`utils/battery/*` | 原样复制（零平台依赖） |
| `components/ui/*`（dialog、alert-dialog、select、switch、input、button） | 复制，连同 `lib/utils.ts` 与 radix 依赖 |
| `components/ui/image.tsx`（平台图片优化包装） | **不复制**，把 `DeviceHero.tsx` / `Sidebar.tsx` 里的 `<Image>` 换成原生 `<img src={...} className={...} alt={...} />` |
| 图片资产（`assets/mouse.jpg`、`assets/headset.jpg`） | 已是本地文件，随 `assets/` 目录直接复制，ES import 保持不变 |
| `display-font.css` + `assets/fonts/*.woff2` | 原样复制 |
| react-router | 单页应用可直接去掉，或保留后安装 |
| `@lark-apaas/*` 全部依赖 | **全部删除**，本项目内没有直接 import（已保持零依赖） |
| `client/src/index.tsx`、`app.tsx`、`components/Layout.tsx`、Welcome、NotFound | 不迁移；用 Tauri 模板的 `main.tsx` 直接渲染 `AppWindow` |

## 2. 环境与依赖

Tauri 2.x + Vite + React + TypeScript 模板即可。需要保留的前端依赖：

```bash
npm i react react-dom framer-motion dayjs echarts echarts-for-react lucide-react clsx tailwind-merge
npm i @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-switch @radix-ui/react-label
npm i -D tailwindcss @tailwindcss/vite
```

样式文件迁移：

- `index.css` → 去掉 `@lark-apaas/client-toolkit/lib/index.css` 与 `typography.css`，保留 tailwind 与主题
- `tailwind-theme.css` / `tailwind.config.ts` → 原样复制（主题变量被 shadcn 组件引用）
- `display-font.css` 与字体文件 → 原样复制（`@font-face` 的相对路径不变即可）

## 3. 图片与背景

设备产品图已经是仓库内的本地资产，直接随目录复制，`utils/battery/demo.ts` 的 `DEVICE_IMAGES` 用 ES import 引用，无需改动。唯一要改的是：`DeviceHero.tsx` 与 `Sidebar.tsx` 当前用的是平台 `Image` 组件，迁移时换成原生 `<img>`（属性可直接搬）。

| 用途 | 路径 |
| --- | --- |
| 鼠标产品图（白，VXE MAD R） | `client/src/assets/mouse.jpg` |
| 耳机产品图（黑） | `client/src/assets/headset.jpg` |

背景不用图片：`AppWindow.tsx` 用 CSS 线性渐变 + 三个 `radial-gradient` 光斑模拟极光壁纸。想在桌面端加分可以用 Tauri 的 `setWindowEffects` 做真毛玻璃，初版保持 `backdrop-blur` 即可。

## 4. 数据接口：BatteryProvider

迁移后唯一要改的接线就是这里。前端已经按接口编程：

```ts
// utils/battery/types.ts（迁移后保持不变）
export interface BatteryReadResult {
  level: number | null;
  charging: boolean;
}

export interface BatteryProvider {
  readonly name: string;
  listDevices(): Promise<BatteryDevice[]>;
  readBattery(deviceId: string): Promise<BatteryReadResult>;
}
```

`charging` 决定电量环配色与动效：充电中为蓝色 `#3B82F6` + 环形扫光；否则按电量阈值（≥50 绿 / 20~49 橙 / <20 红）。协议里没有充电位的数据源一律返回 `false`。

演示实现 `demo.ts` 可以保留作为无设备时的兜底展示。新增 Tauri 实现：

```ts
// utils/battery/tauri-provider.ts
import { invoke } from '@tauri-apps/api/core';
import type { BatteryDevice, BatteryProvider, BatteryReadResult } from './types';

export const tauriProvider: BatteryProvider = {
  name: 'tauri',
  listDevices: () => invoke<BatteryDevice[]>('list_battery_devices'),
  readBattery: (deviceId: string) => invoke<BatteryReadResult>('read_battery', { deviceId }),
};
```

`getBatteryProvider()` 工厂改返回 `tauriProvider`。`useBatteryApp` 与所有 UI 不用动。

Rust 侧（`src-tauri/`）：

- `cargo add hidapi`（hidapi 2.x，跨平台；Windows 上底层是 hid.dll）
- `list_battery_devices`：枚举 HID 接口，按 VID + usagePage 过滤，返回前端需要的 `BatteryDevice` 数组（JSON 结构与 `types.ts` 一致即可）
- `read_battery`：按设备类型走下面的协议发查询报文，返回 `{ level, charging }`（ATK 协议 1 的 `resp[7] != 0` 即可判有线充电）

## 5. 真实协议字节（已对照原仓库核对）

原项目 <https://github.com/yszyszysz233/2.4G-battery-viewer>（`battery.py` / `darkrim_proto.py`），以下为可直接照抄进 Rust 的关键事实。

### 5.1 ATK / VXE 无线鼠标（协议 2，优先）

- 匹配：`VID = 0x373B`，`usagePage = 0xFF05`，Output Report 长度 64
- 请求：`[0x08, 0x7D, 0x72, 0x02, 0x00, 0x01, 0x07, 0x01, 0x00 ×56]`（0x08 是 Report ID）
- 读取：发 Output 后等 Input Report，`wait ≈ 100ms`，重试 3 次（第一次常被当作唤醒包丢弃）
- 校验：回复 `resp[1] == 0x72 && resp[5] == 0x07`
- 电量：`resp[7]`（>100 视为无效）

### 5.2 ATK / VXE / VGN 无线鼠标（协议 1）

- 匹配：`VID = 0x373B` 或 `0x3554`，`usagePage = 0xFF02`，Report 长 17
- 请求：`[0x08, 0x04, 0x00 ×15, 0x49]`
- 电量：`resp[6]`；`resp[7] != 0` 表示有线连接

### 5.3 DARKRIM（杰理方案）耳机 dongle

- 匹配：`VID = 0x3654`，`usagePage = 0xFF02 / usage = 0x0002`，报文 65 字节、无 Report ID（首字节固定 `0x00`）
- 帧格式（第 0 字节起）：`0x00, 0xFE, seq, ch(0x10 本机/0x11 耳机), 0x00, sub(0x02), frag, more, len_lo, len_hi, payload..., crc_hi, crc_lo`
- CRC：CRC16-CCITT-FALSE（poly 0x1021，init 0xFFFF，不反转），覆盖 `frame[1 : 10+len]`，结果大端放在载荷后
- 电量查询：payload = `0x01 0x00`（TLV type 0x01，len 0），ch 用 0x10
- 回复解析：同一帧格式，`seq` 与请求一致；载荷按 TLV 解析，`type 0x01` 的 `value[0]` 即电量（≤100）。其他 TLV：`0x02` 设备名（ASCII）、`0x04/0x05` dongle/耳机固件、`0x06` 状态码

> 注意：`hidapi` 写入时首字节是 Report ID（无 Report ID 的设备写 0），后面 64 字节才是 `frame[1:65]`；读取同理，对应关系要整体错 1 字节，这是最常见的踩坑点。

## 6. 窗口与系统集成

- `tauri.conf.json`：`windows[0]` 设 `"decorations": false`，尺寸建议 `1180×860`（本界面按此设计），`transparent: false`（初版不要求真穿透）
- 把 `TitleBar.tsx` 三个“仅装饰”按钮接到真实 API：

```ts
import { getCurrentWindow } from '@tauri-apps/api/window';
const win = getCurrentWindow();
await win.minimize();
await win.toggleMaximize();
await win.close();
```

- 设置里“刷新间隔/自动刷新”已持久化在 localStorage；Tauri WebView 的 localStorage 落在应用数据目录，可直接用。要改成文件级存储可换 `tauri-plugin-store`，把 `utils/battery/store.ts` 的四个 load/save 换成插件调用即可，调用方不用改

## 7. 迁移步骤清单

1. `npm create tauri-app@latest`（Vite + React + TS）
2. 复制 `client/src` 下的 `pages/`、`hooks/`、`utils/`、`components/ui/`（不含 image.tsx）、`lib/`、`index.css`、`tailwind-theme.css`、`display-font.css`、`assets/`
3. `main.tsx` 直接渲染 `AppWindow`；删除 router 相关
4. 按 §3 复制 `assets/`，并把两处 `<Image>` 换成原生 `<img>`
5. `npm run dev` 确认界面在 Tauri 窗口里渲染正常（此时仍是演示数据）
6. Rust 侧加 `hidapi`，实现 `list_battery_devices` / `read_battery`（§4/§5）
7. `getBatteryProvider()` 切到 `tauriProvider`，真机插接收器联调
8. 接通标题栏三按钮（§6），加应用图标，打包发布
