//! 平台核心：DeviceManager——统一枚举、注册表过滤、按电量能力去重、按 provider 分发读取。
//!
//! 设计 v0.2 P0-1/P0-2/P0-3 落地：
//! - 发现职责上收平台：`discover()` 用统一枚举器（`generic::enumerate_all_hid`）扫全部 HID 接口，
//!   按注册表白名单过滤，再按电量能力优先级去重（BLE 有公开协议 > 标准 HID 电池页 > 无协议）。
//! - Provider 只负责读取（`read_battery` / `read_low_threshold`），不自行兜底。
//! - 全局单例：轮询线程与 Tauri 命令共用同一 DeviceManager，避免重复构造。

use std::sync::OnceLock;

use crate::provider::{parse_vid_pid, DeviceProvider, ProviderDevice};
use crate::registry;

// ── 三个薄 Provider（胶水：各自调用既有 hid/generic/ble 读取实现） ──────────────────────

/// 雷蛇 90B 协议 Provider（指派 1532:007C/007D）
struct RazerProvider;

impl DeviceProvider for RazerProvider {
    fn id(&self) -> &'static str {
        registry::PROVIDER_RAZER
    }
    fn name(&self) -> &'static str {
        "雷蛇 90B Feature"
    }
    fn read_battery(&self, dev: &ProviderDevice) -> Result<(Option<u8>, bool), String> {
        crate::hid::read_battery(&dev.path, dev.feature_len)
    }
    fn read_low_threshold(&self, dev: &ProviderDevice) -> Result<Option<u8>, String> {
        crate::hid::read_low_battery(&dev.path, dev.feature_len)
    }
}

/// 标准 HID Provider（达尔优 / 北通等通用设备，走 generic 白名单读取）
struct HidProvider;

impl DeviceProvider for HidProvider {
    fn id(&self) -> &'static str {
        registry::PROVIDER_HID
    }
    fn name(&self) -> &'static str {
        "标准 HID"
    }
    fn read_battery(&self, dev: &ProviderDevice) -> Result<(Option<u8>, bool), String> {
        crate::generic::read_battery(&dev.path)
    }
}

/// 匠盟(JM) 私有协议 Provider（达尔优 AE7 8K 接收器 260D:1257，jm.rs）
struct JmProvider;

impl DeviceProvider for JmProvider {
    fn id(&self) -> &'static str {
        registry::PROVIDER_JM
    }
    fn name(&self) -> &'static str {
        "匠盟 JM"
    }
    fn read_battery(&self, dev: &ProviderDevice) -> Result<(Option<u8>, bool), String> {
        crate::jm::read_battery(&dev.path)
    }
}

/// BLE GATT Provider（京东京造键盘 37D7:1002，Windows GATT 0x180F/0x2A19）
struct BleProvider;

impl DeviceProvider for BleProvider {
    fn id(&self) -> &'static str {
        registry::PROVIDER_BLE
    }
    fn name(&self) -> &'static str {
        "BLE GATT"
    }
    fn read_battery(&self, dev: &ProviderDevice) -> Result<(Option<u8>, bool), String> {
        match crate::ble::read_ble_battery(dev.vid, dev.pid) {
            // BLE 电池服务只有百分比、没有充电状态字段；统一返回 charging=false
            Some(b) => Ok((Some(b), false)),
            None => Ok((None, false)),
        }
    }
}

// ── DeviceManager ───────────────────────────────────────────────────────────────────

pub struct DeviceManager {
    providers: Vec<Box<dyn DeviceProvider>>,
}

impl DeviceManager {
    pub fn new() -> Self {
        let providers: Vec<Box<dyn DeviceProvider>> = vec![
            Box::new(RazerProvider),
            Box::new(HidProvider),
            Box::new(JmProvider),
            Box::new(BleProvider),
        ];
        DeviceManager { providers }
    }

    pub fn provider_by_id(&self, id: &str) -> Option<&dyn DeviceProvider> {
        self.providers.iter().find(|p| p.id() == id).map(|p| p.as_ref())
    }

    /// 统一枚举：全部 HID 接口 → 注册表白名单过滤 → 按电量能力去重。
    /// 返回的 ProviderDevice 已带注册表的 kind/name/connection/protocol/provider_id。
    pub fn discover(&self) -> Vec<ProviderDevice> {
        // (vid, pid) → 已选设备（电量能力 rank 最小者胜出；同 rank 保留先枚举者）
        let mut best: Vec<(ProviderDevice, u8)> = Vec::new();
        for (path, vid, pid, feature_len, usage_page, usage, _input_len) in crate::generic::enumerate_all_hid() {
            let Some(entry) = registry::lookup_entry(vid, pid) else {
                continue; // 白名单外不识别
            };
            let dev = ProviderDevice {
                path,
                vid,
                pid,
                kind: entry.kind,
                name: entry.name.to_string(),
                connection: entry.connection,
                protocol: entry.protocol,
                feature_len,
                provider_id: entry.provider_id,
            };
            let rank = capability_rank(&dev, usage_page, usage);
            let slot = best.iter_mut().find(|(d, _)| d.vid == vid && d.pid == pid);
            match slot {
                Some((_, cur)) if rank < *cur => {
                    *cur = rank;
                    // 替换为该 rank 更优的接口（BLE 接口顶掉无协议接口）
                    let pos = best.iter().position(|(d, _)| d.vid == vid && d.pid == pid).unwrap();
                    best[pos].0 = dev;
                }
                Some(_) => {} // 已有更优或同优接口，跳过
                None => best.push((dev, rank)),
            }
        }
        // 稳定排序：按 provider_id 再按 path，保证托盘/列表顺序稳定
        let mut out: Vec<ProviderDevice> = best.into_iter().map(|(d, _)| d).collect();
        out.sort_by(|a, b| a.provider_id.cmp(b.provider_id).then(a.path.cmp(&b.path)));
        out
    }

    /// 按设备接口路径读取（命令层入口）：parse path → 注册表定位 provider → 读取
    pub fn read_battery_by_path(&self, path: &str, feature_len_hint: Option<u16>) -> Result<(Option<u8>, bool), String> {
        let (vid, pid) = parse_vid_pid(path);
        let entry = registry::lookup_entry(vid, pid)
            .ok_or_else(|| format!("设备不在注册表: {:04X}:{:04X}", vid, pid))?;
        let provider = self
            .provider_by_id(entry.provider_id)
            .ok_or_else(|| format!("provider 未注册: {}", entry.provider_id))?;
        let dev = ProviderDevice {
            path: path.to_string(),
            vid,
            pid,
            kind: entry.kind,
            name: entry.name.to_string(),
            connection: entry.connection,
            protocol: entry.protocol,
            feature_len: feature_len_hint.unwrap_or(0),
            provider_id: entry.provider_id,
        };
        provider.read_battery(&dev)
    }

    /// 按设备接口路径读取低电量阈值（命令层入口）
    pub fn read_low_by_path(&self, path: &str, feature_len_hint: Option<u16>) -> Result<Option<u8>, String> {
        let (vid, pid) = parse_vid_pid(path);
        let entry = registry::lookup_entry(vid, pid)
            .ok_or_else(|| format!("设备不在注册表: {:04X}:{:04X}", vid, pid))?;
        let provider = self
            .provider_by_id(entry.provider_id)
            .ok_or_else(|| format!("provider 未注册: {}", entry.provider_id))?;
        let dev = ProviderDevice {
            path: path.to_string(),
            vid,
            pid,
            kind: entry.kind,
            name: entry.name.to_string(),
            connection: entry.connection,
            protocol: entry.protocol,
            feature_len: feature_len_hint.unwrap_or(0),
            provider_id: entry.provider_id,
        };
        provider.read_low_threshold(&dev)
    }
}

/// 电量能力优先级：BLE GATT 有公开协议 > 标准 HID 电池页 > 无协议接口。
/// 私有协议命令接口特判：匠盟 JM 设备仅 usagePage 0xFF02/usage 0x02 的集合可发命令，
/// 该接口 rank=0（优先选中），其余集合 rank=2（避免选中无法读电量的接口）。
fn capability_rank(dev: &ProviderDevice, usage_page: u16, usage: u16) -> u8 {
    if dev.provider_id == registry::PROVIDER_JM {
        return if usage_page == crate::jm::JM_USAGE_PAGE && usage == crate::jm::JM_USAGE {
            0
        } else {
            2
        };
    }
    if dev.provider_id == registry::PROVIDER_BLE {
        0
    } else if dev.protocol.contains("HID 电池") || dev.protocol.contains("0x84") {
        1
    } else {
        2
    }
}

// ── 全局单例 ─────────────────────────────────────────────────────────────────────────

static MANAGER: OnceLock<DeviceManager> = OnceLock::new();

/// 初始化（run() 启动时调用一次；幂等）
pub fn init() {
    let _ = MANAGER.set(DeviceManager::new());
}

/// 取全局 DeviceManager（init 之后可用）
pub fn get() -> &'static DeviceManager {
    MANAGER.get_or_init(DeviceManager::new)
}
