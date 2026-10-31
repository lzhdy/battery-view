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

设备识别采用 **双通道架构**：雷蛇外设走专用 90B Feature Report 协议读电量；其余品牌外设通过通用 HID 层按 VID:PID 白名单识别并展示（电量读取依赖设备是否暴露标准 HID 电池页，否则显示 `--`）。

### Razer（90B Feature Report，实测可用）

| 设备 | PID | 协议 | 状态 |
| --- | --- | --- | --- |
| Razer DeathAdder V2 Pro（有线 / 2.4G） | `0x007C` / `0x007D` | Razer 90B 电池 feature | ✅ 实测可用 |
| 其他 Razer 2.4G 外设（键盘/耳机/鼠标垫） | 同族 | Razer 90B 电池 feature | ⚠️ 理论支持（需真机验证） |

### 通用外设（VID:PID 白名单识别，`src-tauri/src/generic.rs`）

| 设备 | VID:PID | 类型 | 连接 | 电量 |
| --- | --- | --- | --- | --- |
| 达尔优 AE7 | `260D:1257` | 鼠标 | 2.4G | ⚠️ 无标准 HID 电池页 → `--` |
| 北通 黑武士 4 Pro（XInput） | `045E:028E` | 手柄 | XInput | ⚠️ 无公开协议 → `--` |
| 北通 黑武士 4 Pro（直连/2.4G） | `2E8C:*` | 手柄 | 无线 | ⚠️ 预留分支（需真机验证） |
| 京东京造键盘 | `37D7:1002` | 键盘 | 蓝牙 | ⚠️ 无标准 HID 电池页 → `--` |
| SteelSeries 笔记本自带键盘 | `1038:2052` | 键盘 | 有线 | — 无电池 |

> 已探测确认：以上通用设备在 Windows 下均未暴露标准 HID 电池页（Usage Page `0x0084`），且 2.4G 鼠标 / XInput 手柄 / 有线键盘不提供公开电量协议，电量显示 `--` 属预期行为；后续若厂商提供协议，在 `generic.rs` 的 `read_battery` 中按 VID:PID 增加读取分支即可。

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
│  list_hid_devices / read_battery_level 命令            │
│  hid.rs:     HID 枚举 + Razer 90B 协议 + PID→kind      │
│  generic.rs: 通用 HID 枚举 + VID:PID 白名单识别 + 读取占位 │
│  tray.rs: 托盘图标渲染（Lucide PNG 嵌入 + 电量条）       │
│  lib.rs: 单实例/开机自启/设置持久化/弹窗调度 + 设备列表合并 │
└──────────────────────────────────────────────────────┘
```

### 添加一台新设备（三步）

1. **识别白名单**（`src-tauri/src/generic.rs`）：在 `identify()` 的 `(vid, pid) => (kind, name, connection)` 匹配表加一行，如 `(VID_DAREU, 0x1257) => ("mouse", "达尔优 AE7", "2.4G")`；设备即自动出现在主窗口列表（枚举按 VID:PID 去重，全 HID 接口扫描）。
2. **电量协议**（`src-tauri/src/generic.rs` 的 `read_battery`）：设备若暴露标准 HID 电池页（Usage Page `0x0084`），在 `has_battery_page()` 命中后按输入 Report 读取；若走厂商私有协议，仿照 `hid.rs` 的 `read_razer_battery` 按 VID:PID 增加分支。无协议时保持返回 `Ok((None, false))`，前端显示 `--`，不阻塞设备识别。
3. **托盘图标**：若新设备需要托盘专属图标，把设备线条图标 PNG（Lucide 风格，128×128）放入 `src-tauri/src/assets/lucide/`，`tray.rs` 按 `kind` 自动找到并渲染（`mouse` / `keyboard` / `gamepad` 等剪影已内置）。

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
│   ├── src/generic.rs    # 通用 HID 枚举 + VID:PID 白名单识别 + 电量读取占位
│   ├── src/tray.rs       # 托盘图标渲染（Lucide PNG + 电量条）
│   ├── src/lib.rs        # 命令注册 / 单实例 / 设置 / 弹窗调度 / 设备列表合并
│   └── scripts/          # 前端构建脚本（build-desktop.mjs）
├── assets/lucide/        # 托盘图标素材（lucide.dev, ISC 协议）
└── docs/                 # 迁移指南与截图
```

## License

[MIT](LICENSE)

托盘图标素材来自 [Lucide](https://lucide.dev)（ISC 许可证）；前端设备插画与主题均为项目自有素材。
