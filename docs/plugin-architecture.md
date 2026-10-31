# 外设电量坞 · 插件化架构设计

> 版本：v0.2（设计稿，评审已修订） · 状态：阶段 A + 阶段 B + 阶段 C 已实现（编译零 warning + 本机运行验证通过，待最终验收后统一提交）
> 定位：把 BatteryView 从"雷蛇优先 + 通用补充"的双通道实现，矫正为**通用外设电量平台 + 协议插件**架构。雷蛇是第一个接入的设备，不是架构的中心。

---

## 1. 背景与目标

### 1.1 程序定位（用户定义）

BatteryView 是一个**通用外设电量平台**：无论什么品牌、什么协议的外设（鼠标 / 键盘 / 手柄 / 耳机……），都以**插件**形式接入同一平台来获取电量。雷蛇鼠标只是**第一个接入**的设备。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| 平台与品牌解耦 | 平台层不认识任何品牌，只面向统一 Provider 接口与统一设备状态 |
| 新设备低成本接入 | 新增设备 = 在设备注册表登记 +（必要时）新增/扩展一个 Provider；平台代码零改动 |
| 单设备知识单点维护 | VID/PID、名称、类型、连接方式、电量协议收敛到一张注册表，消除分散映射 |
| 行为不变 | 重构以"现有已验证行为不变"为底线：键盘 94%、达尔优 `--`、托盘每设备一图标、充电弹窗等全部保持 |
| 可回归验证 | 每个迁移阶段都有可自动核对的日志断言（`%TEMP%\battery-view-debug.log`） |

---

## 2. 现状盘点（代码事实）

### 2.1 读取层（三个模块）

| 模块 | 职责 | 关键实现 |
| --- | --- | --- |
| `src-tauri/src/hid.rs` | 雷蛇外设（RAZER_VID=0x1532） | `list_razer_devices()`（HID 枚举 + 白名单）、`read_battery()`（Razer 90B Feature Report 91 字节帧）、`read_low_battery()`（阈值 5%） |
| `src-tauri/src/generic.rs` | 通用 HID 外设 | `list_generic_devices()`（SetupAPI 全 HID 枚举 + `identify()` VID:PID 白名单、按 VID:PID 去重）、`read_battery()`（BLE 键盘走 `ble.rs`；标准 HID 电池页 0x84 检测后读占位；其余返回 `(None, false)`） |
| `src-tauri/src/ble.rs` | BLE GATT 电池服务 | `read_ble_battery(vid, pid)`（WinRT 无参 `FindAllAsync` 枚举已配对设备 → 0x180F → 0x2A19 → ReadByte，实测键盘 94%） |

### 2.2 平台层（命令与轮询，`src-tauri/src/lib.rs`）

- `list_hid_devices()`（L314）：**双循环**——先 `hid::list_razer_devices()` 输出 `source:"razer"`，再 `generic::list_generic_devices()` 输出 `source:"generic"`；协议文案在循环内 `if` 判断（键盘→"BLE GATT 电池服务 (0x180F)"，其余→"无公开电量协议"）。
- `read_battery_level()`（L384）：**按路径字符串分流**——`path.contains("vid_1532")` 走雷蛇 90B，否则走 `parse_vid_pid()` + `generic::read_battery()`。
- `read_low_battery_threshold()`（L405）：同样的 `vid_1532` 字符串判断。
- 托盘轮询线程（L719 起）：`loop {` 内**先雷蛇 `poll`、后通用 `gpoll` 双循环**，各自读取后手工拼装成 `Vec<TrayDevice>`（L445），再统一更新托盘图标、菜单、充电跳变弹窗。
- 设备元数据分散三处：`generic.rs::identify()`（通用设备）、`lib.rs::pid_name()` / `kind_for_pid()`（雷蛇设备）。

### 2.3 前端（`client/src`）

- `utils/battery/provider.ts`：`getBatteryProvider()` 统一入口（已平台化，前端改造成本低）。
- `utils/battery/desktop.ts`：桥接 invoke `list_hid_devices` / `read_battery_level`，按 path 读取。
- `utils/battery/razer.ts`：`toDevice()` 把 Rust 返回映射为 `BatteryDevice`（已优先取 Rust 的 `protocol` 字段，残留少量硬编码兜底）。
- UI（AppWindow / Sidebar / DeviceHero / BatteryGauge / PopupPage）**全部只消费 `BatteryDevice[]` 与 `DeviceLiveState`，与设备无关**。

### 2.4 现状问题清单

| # | 问题 | 影响 |
| --- | --- | --- |
| P1 | 命令层用 `path.contains("vid_1532")` 字符串判断分流 | 脆弱、不可扩展；新增品牌需改 lib.rs |
| P2 | 列表 / 轮询 / 菜单各有一份"设备拼接"逻辑 | 同一设备知识重复三处，易漏改 |
| P3 | 设备元数据分散（identify / pid_name / kind_for_pid） | 名称/类型/连接方式/协议没有单一事实源 |
| P4 | `generic.rs::read_battery` 混入 BLE 分支（调用 `ble.rs`） | provider 边界不清；BLE 应独立成 provider |
| P5 | 标准 HID 电池页（0x84）检测有实现但读取是占位 | 真实能力未落地，后续厂商设备无法直接用 |
| P6 | README 声称"插件化架构"，但实际是双通道 | 文档与代码不一致，需矫正 |

---

## 3. 目标架构

### 3.1 分层总览

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (React/Vite)                                        │
│  AppWindow / Sidebar / DeviceHero / PopupPage                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ BatteryProvider (client) → desktop.ts → Tauri invoke      │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────┬─────────────────────────────────┘
                             │ 统一命令：list_devices / read_battery_level
┌────────────────────────────▼─────────────────────────────────┐
│  平台核心（src-tauri/src）                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ DeviceManager（唯一调度者）                                │ │
│  │  · Provider 注册表：Vec<Box<dyn DeviceProvider>>           │ │
│  │  · discover() 汇总全部 provider 枚举 → 去重 → 设备目录       │ │
│  │  · 轮询线程：每 5s 刷新 DeviceState → 托盘/菜单/弹窗          │ │
│  │  · 命令层：按 deviceId(path) 路由到所属 provider            │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│  │ Razer Provider│ │ HID Provider │ │ BLE Provider │  …新插件  │
│  │ (hid.rs 90B) │ │ (generic.rs) │ │ (ble.rs GATT)│           │
│  └──────────────┘ └──────────────┘ └──────────────┘           │
└────────────────────────────┬─────────────────────────────────┘
                             │ 共享 DeviceRegistry（设备目录）
                 DeviceEntry { vid, pid, kind, name, connection, protocol, provider_id }
```

### 3.2 核心接口（Rust）

```rust
// provider.rs —— 统一设备描述（取代 RazerHidDevice / GenericHidDevice 的分立结构）
pub struct ProviderDevice {
    pub path: String,            // 设备接口路径（= 前端 deviceId）
    pub vid: u16,
    pub pid: u16,
    pub kind: &'static str,      // mouse / keyboard / gamepad / headset ...
    pub name: String,            // 展示名（来自注册表或 provider 探测）
    pub connection: &'static str,// 2.4G / 有线 / 蓝牙 / XInput ...
    pub protocol: &'static str,  // "Razer 90B Feature" / "HID 电池页 0x84" / "BLE GATT 0x180F" / "无公开协议"
    pub feature_len: u16,        // 协议私有长度（雷蛇 91；其余 0）
    pub provider_id: &'static str, // 归属 provider，命令层据此路由
}

// provider.rs —— 插件统一接口
pub trait DeviceProvider: Send + Sync {
    fn id(&self) -> &'static str;                                   // "razer" / "hid" / "ble"
    fn name(&self) -> &'static str;                                 // "雷蛇 90B" / "标准 HID" / "BLE GATT"
    /// 枚举当前连接、且命中本 provider 白名单/注册表的设备
    fn discover(&self) -> Vec<ProviderDevice>;
    /// 读取电量与充电状态
    fn read_battery(&self, dev: &ProviderDevice) -> Result<(Option<u8>, bool), String>;
    /// 低电量阈值（默认无）
    fn read_low_threshold(&self, dev: &ProviderDevice) -> Result<Option<u8>, String> {
        let _ = dev;
        Ok(None)
    }
}
```

**Trait 实现约定**：

- 枚举与读取中的 HID/SetupAPI/WinRT 细节全部留在 provider 内部，平台层不 import 任何 Windows API。
- 每个 provider 只负责自己声明的设备；跨协议同设备（键盘有线=HID / 蓝牙=BLE 两个接口）由 **DeviceManager 去重**规则处理（同一 VID:PID 取第一个接口；蓝牙节点按 path 前缀 `vid&` 与 `VID_` 归并）。

### 3.3 设备注册表（单一事实源，含"重新录入"）

`src-tauri/src/registry.rs`：一张静态表，替代 `identify()` / `pid_name()` / `kind_for_pid()` 三处映射。

```rust
pub struct DeviceEntry {
    pub vid: u16, pub pid: Option<u16>,  // pid=None 表示通配 VID（如北通 2E8C:*）
    pub kind: &'static str,
    pub name: &'static str,
    pub connection: &'static str,
    pub protocol: &'static str,
    pub provider_id: &'static str,
}

pub fn device_registry() -> Vec<DeviceEntry>;
```

**新程序重新录入清单**（现有设备登记为注册表条目）：

| VID | PID | kind | 名称 | 连接 | protocol | provider |
| --- | --- | --- | --- | --- | --- | --- |
| 0x1532 | 0x007C / 0x007D | mouse | Razer DeathAdder V2 Pro | 有线 / 2.4G | Razer 90B Feature | razer |
| 0x260D | 0x1257 | mouse | 达尔优 AE7 | 2.4G | 无公开协议 | hid |
| 0x2E8C | * | gamepad | 北通 黑武士 4 Pro | 无线 | 预留（私有） | hid |
| 0x045E | 0x028E | gamepad | 黑武士 4 Pro (XInput) | XInput | 无公开协议 | hid |
| 0x37D7 | 0x1002 | keyboard | 京东京造键盘 | 蓝牙 | BLE GATT 电池服务 (0x180F) | ble |

> 设备表是**白名单**：不在表中的设备不识别、不进主界面、不进托盘（SteelSeries 等明确排除项天然满足）。

### 3.4 平台核心（DeviceManager）

`src-tauri/src/manager.rs`：

```rust
pub struct DeviceManager {
    providers: Vec<Box<dyn DeviceProvider>>,
    registry: Vec<DeviceEntry>,
}

impl DeviceManager {
    /// 所有 provider 枚举汇总 → 注册表过滤 → 按 VID:PID 去重 → 排序
    pub fn discover(&self) -> Vec<ProviderDevice>;
    /// 按 deviceId（path）定位所属 provider 并读取
    pub fn read_battery(&self, device_id: &str) -> Result<(Option<u8>, bool), String>;
    pub fn read_low_threshold(&self, device_id: &str) -> Result<Option<u8>, String>;
}
```

- **命令层改造**：保留 `list_hid_devices` / `read_battery_level` / `read_low_battery_threshold` 命令名与现有字段，内部换为 DeviceManager 路由，**删除** `path.contains("vid_1532")` 字符串判断；新增 `providerId` 字段（P0-3 定案）。
- **轮询线程改造**：`discover()` 一次拿到全部设备，逐个 `read_battery()`；`TrayDevice` 直接由 `ProviderDevice + 读结果` 生成；poll/gpoll 日志前缀改为 `provider=razer` / `provider=hid` / `provider=ble`（日志格式变更，便于回归核对）。
- **托盘图标 / 菜单 / 充电弹窗**：消费统一 `Vec<TrayDevice>`，逻辑不变。

### 3.5 前端改造（最小）

- `desktop.ts` / `razer.ts` 继续 invoke 现有命令名，**前端零改动**；`protocol` 字段统一来自 Rust 注册表。
- 设备图（`DEVICE_IMAGES`）按 `kind` 查找，不受 provider 影响。
- 主界面"默认选中第一个有电量设备"等已验收逻辑不动。

---

## 4. 新增设备接入指南（目标形态）

**接入一台新品牌外设，三步：**

1. **登记**：`registry.rs::device_registry()` 加一行 `DeviceEntry`（VID/PID/名称/类型/连接/协议/provider_id）。
2. **读电量**：
   - 设备暴露**标准 HID 电池页（0x84）** → 完善 `HID Provider` 的 `has_battery_page` 后读取实现（当前占位补全）；
   - 设备有 **BLE 电池服务（0x180F）** → 复用 `BLE Provider`；
   - 设备是**私有协议** → 仿照 `hid.rs` 新增一个 Provider 实现 trait（或扩展既有 provider 的分支），平台层零改动。
3. **图标**：把设备剪影 PNG 放入 `src-tauri/src/assets/lucide/`（按 `kind` 命名），托盘/主界面自动生效。

平台层（命令、轮询、托盘、弹窗、UI）**在接入新设备时不改一行**。

---

## 5. 数据流对比

| 环节 | 现状 | 目标 |
| --- | --- | --- |
| 设备列表 | `list_hid_devices` 双循环手工拼接（razer + generic） | `DeviceManager::discover()` 统一汇总 |
| 读取路由 | `path.contains("vid_1532")` 字符串判断 | 注册表/Provider 反查 |
| 托盘轮询 | 双循环 `poll` + `gpoll` 手工组装 `TrayDevice` | 单循环：`discover()` → 逐个 `read_battery()` |
| 设备元数据 | `identify` / `pid_name` / `kind_for_pid` 三处 | `registry.rs` 单表 |
| 协议文案 | `list_hid_devices` 内 `if` 判断 | 注册表 `protocol` 字段直出 |

---

## 6. 分阶段迁移计划（每个阶段独立可验证）

### 阶段 A：抽出接口与 DeviceManager（不改行为）

- 新增 `provider.rs`（trait + ProviderDevice）、`manager.rs`（DeviceManager + discover 去重）。
- `hid.rs` / `generic.rs` / `ble.rs` 各自包一层 Provider 实现（内部代码不动或仅做薄封装）。
- 命令 `list_hid_devices` → 改为调用 `DeviceManager::discover()`（对外字段不变，保留 `source` 兼容、新增 `providerId`；前端零改动，P0-3 定案）。
- 轮询线程改走 DeviceManager。
- **验收**：键盘 94% / 达尔优 `--` / 托盘每设备一图标 / 充电弹窗 / 主界面列表全部与现状一致；日志断言通过。

### 阶段 B：设备知识收敛到注册表

- 新增 `registry.rs`；`identify()` / `pid_name()` / `kind_for_pid()` 三处映射由注册表替换。
- 协议文案（`protocol` 字段）全面由注册表驱动。
- **验收**：设备表增删一行即影响主界面/托盘/菜单，无其他散落映射。

### 阶段 C：补齐能力与清理

- 完善 HID Provider 标准电池页读取（0x84 Input Report）。
- 删除 `source` 双通道残留、demo 路径、过时注释；README 架构图与代码对齐。
- **验收**：`cargo build` 无 warning；`git diff` 复查；全量回归后一次 commit + push（遵守"验证通过才推送"硬约束）。

---

## 7. 风险与边界

| 风险 | 缓解 |
| --- | --- |
| 重构破坏已验证功能 | 分阶段 + 每阶段日志断言回归；行为不改的底线先行 |
| BLE 单连接占用、WinRT 异步阻塞 | 维持现状（`futures::executor::block_on` + MTA COM 幂等初始化），不引入新依赖 |
| 同一设备多个 HID 接口（去重） | DeviceManager 统一 VID:PID 去重规则，取代散落去重 |
| 托盘图标数量变化引发用户困惑 | 托盘交互保持"每设备一图标"，图标与主界面设备列表同源 |
| 通用/雷蛇日志前缀变化 | 阶段 A 起日志统一 `provider=<id>`，用新断言核对 |

---

## 8. 评审记录与修订（v0.2）

### 评审结论

方向正确、分层清晰，**有条件通过**：3 项 P0 修订后进入阶段 A 实现。

### P0-1（修订）Provider 只负责读取，发现职责上收平台

原设计把 `discover()` 放进每个 Provider，但 **BLE Provider 无法自足**：键盘蓝牙接口由 HID-over-GATT 枚举发现（`generic.rs` SetupAPI 扫描），`ble.rs` 本身没有枚举能力。

**修订后接口**：

```rust
pub trait DeviceProvider: Send + Sync {
    fn id(&self) -> &'static str;          // "razer" / "hid" / "ble"
    fn name(&self) -> &'static str;
    fn read_battery(&self, dev: &ProviderDevice) -> Result<(Option<u8>, bool), String>;
    fn read_low_threshold(&self, dev: &ProviderDevice) -> Result<Option<u8>, String> { Ok(None) }
}
// 发现由 DeviceManager 承担：统一枚举器（SetupAPI 全 HID 扫描）→ 注册表过滤 → 按 provider_id 分发读取
```

### P0-2（修订）同 VID:PID 多接口去重按电量能力优先

京东京造键盘存在蓝牙接口（HID-over-GATT，可读 94%）与可能的有线接口（同 VID 37D7）；若"先到先得"去重，插上 USB 会把蓝牙接口顶掉 → 电量变 `--`。

**修订**：去重按接口电量能力优先级：`BLE GATT 有公开协议 > 标准 HID 电池页(0x84) > 无协议接口`，同优先级保留先枚举者。保证有电量接口永远胜出。

### P0-3（定案）命令层兼容策略

保留 `list_hid_devices` / `read_battery_level` / `read_low_battery_threshold` **命令名与现有 JSON 字段**（id/productId/kind/name/connection/featureLen/protocol/source），内部实现换为 DeviceManager；新增 `providerId` 字段。前端零改动（`source !== 'generic'` 判雷蛇的逻辑保留兼容）。

### P1 记录（不阻塞阶段 A）

| # | 项 | 决定 |
| --- | --- | --- |
| P1-1 | BLE 设备列表缓存 | 阶段 A 不做，观察轮询开销后按需优化 |
| P1-2 | 注册表与 Provider 双层校验 | 约定 Provider 只处理注册表指派设备，不自行兜底 |
| P1-3 | 日志格式 | 阶段 A 起轮询日志统一 `provider=<id>` 前缀，替换 poll/gpoll，回归断言同步更新 |

### v0.2 修订后的实现边界

- 阶段 A：`provider.rs`（trait + ProviderDevice）、`registry.rs`（设备注册表）、`manager.rs`（DeviceManager + 统一枚举 + 去重 + 分发）、命令与轮询改走 DeviceManager；`generic.rs` 暴露 `enumerate_all_hid()` 作为统一枚举源（雷蛇、通用、BLE 接口全部覆盖）；日志换 `provider=` 前缀。
- 阶段 B：`identify()` / `pid_name()` / `kind_for_pid()` 三处映射删除，由注册表单表驱动。
- 阶段 C：补齐 HID 0x84 读取、清理遗留、README 对齐。

## 9. 与当前未提交修复的关系

当前工作区已有的未提交改动（charging=false、托盘合并通用设备、主界面默认选中校准、协议文案、托盘回滚）与本次插件化重构（阶段 A/B/C）**合并为同一批改动、共同验收后统一 commit + push**；重构不改变已验收的用户可见行为。阶段 C 中"0x84 读取补全"已实现：`generic.rs` 按 HID 规范用 `HidP_GetUsageValue` 读 Battery Strength（0x84:0x40）为电量、Battery Charging（0x84:0x44）为充电状态，Input Report 优先、Feature Report 兜底，读失败一律返回 `--` 防误报；编译零 warning、本机回归断言不变（本机尚无 0x84 设备）。0x84 读取路径待出现标准电池页真机后做一次实测确认。
