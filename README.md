# BatteryView · 外设电量坞

> 2.4G 无线外设电量管理桌面应用 · Tauri 2.0 + Rust + React + Vite

直接在系统托盘实时显示鼠标 / 键盘 / 耳机等 2.4G 无线外设的剩余电量：图标 + 电量条一眼可读，弹窗在低电 / 充电完成等时刻自动提醒，主窗口提供毛玻璃卡片式电量仪表盘与趋势预测。

![主窗口](docs/screenshots/main-window-web.png)

![低电/多设备弹窗](docs/screenshots/popup-stacked-web.png)

## Features

- **托盘实时电量**：每台设备一个托盘图标（Lucide 开源线条剪影 + 右侧电量竖条），电量颜色随阈值变化（充电蓝 / ≥50 绿 / ≥20 橙 / <20 红），自动适配深浅色任务栏与 DPI 缩放
- **毛玻璃主窗口**：1180×880 无边框窗口，渐变极光背景 + 毛玻璃卡片，圆环仪表盘展示当前电量
- **电量趋势预测**：本地持久化每台设备最近 500 条历史采样，基于历史数据做初步估算与稳定预测，显示"预计还能用 X"（初步估算与刷新频率联动，采样越多越准）
- **智能弹窗提醒**：充电跳变、低电量（<20%）、电量不足（20%~50%）、充满完成等场景自动弹窗（可开关）
- **多设备管理**：同时监控多台外设，设备重命名、连接方式（有线/无线）自动识别
- **开机自启**：默认开启，注册表 HKCU Run 一键管理（可关闭）
- **数据本地保存**：所有设置与历史采样仅存于本地（WebView localStorage），不联网、不上传
- **插件化架构**：新设备通过标准化 `BatteryProvider` 接口 + PID→kind 映射接入，无需改动主界面

## Supported Devices

当前基于 **Razer Synapse 3.5 的 90B feature report** 协议读取电量，实测设备：

| 设备 | PID | 协议 | 状态 |
| --- | --- | --- | --- |
| Razer DeathAdder V2 Pro（有线 / 2.4G） | `0x007C` / `0x007D` | Razer 90B 电池 feature | ✅ 实测可用 |
| 其他 Razer 2.4G 外设（键盘/耳机/鼠标垫） | 同族 | Razer 90B 电池 feature | ⚠️ 理论支持（需真机验证） |

> 标准 HID 电池设备（Windows 系统自带 Battery 报告，如部分第三方外设）也在设备列表逻辑中预留，可通过 `hid.rs` 的 PID→kind 映射表扩展。

## Architecture（为什么加新设备很容易）

```
┌──────────────────────────────────────────────────────┐
│  Frontend (React/Vite)                                │
│  AppWindow / PopupPage / tray polling                 │
│  ┌──────────────────────────────────────────────────┐ │
│  │ BatteryProvider (client/src/utils/battery/types.ts)│ │
│  │   getBatteryProvider() → razerProvider / demo      │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────────┘
                       │ Tauri invoke
┌──────────────────────▼───────────────────────────────┐
│  Rust (src-tauri/src)                                 │
│  list_battery_devices / read_battery 命令              │
│  hid.rs: HID 枚举 + Razer 90B 协议 + PID→kind 分流     │
│  tray.rs: 托盘图标渲染（Lucide PNG 嵌入 + 电量条）       │
│  lib.rs: 单实例/开机自启/设置持久化/弹窗调度             │
└──────────────────────────────────────────────────────┘
```

### 添加一台新设备（三步）

1. **协议层**（`src-tauri/src/hid.rs`）：若新设备走标准 HID 电池报告（`Usage Page 0x0085`），直接复用现有枚举逻辑；若走私有协议，仿照 `read_razer_battery` 加一个按 VID/PID 分发的读取函数。
2. **映射表**（`src-tauri/src/hid.rs` 的 PID→kind 表）：新增一行 `(vendor, product) => DeviceKind`，并在 `client/src/utils/battery/types.ts` 的 `DeviceKind` 联合类型与 `assets/peripherals/*.png` 插画中加入对应设备图。
3. **托盘图标**：把设备线条图标 PNG（Lucide 风格，128×128）放入 `src-tauri/src/assets/lucide/`，`tray.rs` 的 `draw_lucide_icon` 自动按 `kind` 找到并渲染。

前端所有 UI、趋势预测、弹窗逻辑与设备无关——它们只消费 `BatteryProvider` 返回的 `BatteryDevice[]` / `BatteryReadResult`。

## Download / Install

- 正式安装版（NSIS）：`BatteryView_1.0.0_x64-setup.exe`
- MSI 包：`BatteryView_1.0.0_x64_en-US.msi`
- 绿色免安装：`battery-view.exe`（release 构建产物）

> 安装包位于 Release 页面或 `src-tauri/target/release/bundle/`。要求 Windows 10/11（WebView2 系统自带）。

## Build（本地构建）

### 环境要求

- **Node.js ≥ 22**（含 npm）
- **Rust stable**（rustup 安装，Windows 建议默认 toolchain）
- **Windows**：VS Build Tools（C++ 桌面负载）或 MSVC；本机使用 MinGW 链路时需配置 `lld` 链接器（见下）

### 构建步骤

```bash
# 1. 安装前端依赖
npm install

# 2. 构建前端产物（vite build → flatten index.html → sanitize）
npm run build

# 3. 编译 + 打包（NSIS / MSI）
cd src-tauri
npx @tauri-apps/cli@latest build
```

产物：
- 可执行文件：`src-tauri/target/release/battery-view.exe`
- 安装包：`src-tauri/target/release/bundle/nsis/*.exe`、`bundle/msi/*.msi`

> **Windows/MinGW 链接器配置**（如使用 `x86_64-pc-windows-gnu`）：需 `llvm` 的 `lld`，并设置
> `DLLTOOL=<llvm>/dlltool.exe`、`RUSTFLAGS="-C link-arg=-fuse-ld=lld"`。
> 前端构建请勿直接 `npx vite build`（会跳过 `dist/index.html` 的 flatten 与占位符清理），统一走 `npm run build`。

## Repository layout

```
battery-view/
├── client/               # 前端（React + Vite + Tailwind v4）
│   ├── src/pages/        # AppWindow（主窗口）/ PopupPage（弹窗）
│   ├── src/utils/battery/# BatteryProvider / 趋势预测 / 历史存储
│   └── src/components/ui/ # 毛玻璃 UI 组件（Radix + Tailwind）
├── src-tauri/            # Tauri 壳（Rust）
│   ├── src/hid.rs        # HID 枚举 + Razer 90B 协议 + PID→kind
│   ├── src/tray.rs       # 托盘图标渲染（Lucide PNG + 电量条）
│   ├── src/lib.rs        # 命令注册 / 单实例 / 设置 / 弹窗调度
│   └── scripts/          # 前端构建脚本（build-desktop.mjs）
├── assets/lucide/        # 托盘图标素材（lucide.dev, ISC 协议）
└── docs/                 # 迁移指南与截图
```

## License

[MIT](LICENSE)

托盘图标素材来自 [Lucide](https://lucide.dev)（ISC 许可证）；前端设备插画与主题均为项目自有素材。
