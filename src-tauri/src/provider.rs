//! 插件化设备接口：统一设备描述 `ProviderDevice` + 插件 trait `DeviceProvider`。
//!
//! 平台原则（设计 v0.2 P0-1）：
//! - **发现职责上收平台**：Provider 不负责枚举设备，统一由 `DeviceManager` 的
//!   统一枚举器（SetupAPI 全 HID 扫描，见 `generic::enumerate_all_hid`）发现，
//!   按注册表 `provider_id` 分发到对应 Provider 读取。
//! - **Provider 只处理注册表指派给它的设备**，不自行兜底（P1-2）。
//! - **行为不变底线**：命令名、JSON 字段、托盘形态、弹窗逻辑均不因重构而改变。

/// 统一设备描述（取代 RazerHidDevice / GenericHidDevice 的分立结构）
#[derive(Clone)]
pub struct ProviderDevice {
    /// 设备接口路径（= 前端 deviceId，invoke 读取时原样回传）
    pub path: String,
    pub vid: u16,
    pub pid: u16,
    /// 设备类型（前端大图 / 托盘剪影 / 弹窗图标共用）：mouse / keyboard / gamepad ...
    pub kind: &'static str,
    /// 展示名（托盘 tooltip、主界面设备名）
    pub name: String,
    /// 连接方式：2.4G / 有线 / 蓝牙 / XInput ...
    pub connection: &'static str,
    /// 电量协议描述（主界面"设备识别"文案）
    pub protocol: &'static str,
    /// 协议私有长度（雷蛇 90B = 91；其余 0）
    pub feature_len: u16,
    /// 归属 provider（注册表指定；命令层/轮询据此路由）
    pub provider_id: &'static str,
}

/// 插件统一接口：只负责读取，发现由 DeviceManager 承担。
pub trait DeviceProvider: Send + Sync {
    /// provider 唯一标识（"razer" / "hid" / "ble"），注册表 `provider_id` 与之对应
    fn id(&self) -> &'static str;
    /// provider 展示名（诊断/日志用；当前日志以 provider_id 为准）
    #[allow(dead_code)]
    fn name(&self) -> &'static str;
    /// 读取电量与充电状态
    fn read_battery(&self, dev: &ProviderDevice) -> Result<(Option<u8>, bool), String>;
    /// 读取固件低电量阈值（百分比）；默认无（通用外设无公开协议返回 None）
    fn read_low_threshold(&self, dev: &ProviderDevice) -> Result<Option<u8>, String> {
        let _ = dev;
        Ok(None)
    }
}

/// 从 HID 设备路径提取 VID/PID，兼容两种格式：
/// - SetupDi HID 标准：\\?\HID#VID_XXXX&PID_XXXX#...（4 位 hex）
/// - HID over GATT / BTHLEDEVICE：..._dev_vid&0137d7_pid&1002_...（24 位厂商 ID，取后 16 位）
pub fn parse_vid_pid(path: &str) -> (u16, u16) {
    let up = path.to_uppercase();
    let mut vid = 0u16;
    let mut pid = 0u16;
    if let Some(i) = up.find("VID_") {
        if let Some(hex) = up.get(i + 4..i + 8) {
            vid = u16::from_str_radix(hex, 16).unwrap_or(0);
        }
    }
    if let Some(i) = up.find("PID_") {
        if let Some(hex) = up.get(i + 4..i + 8) {
            pid = u16::from_str_radix(hex, 16).unwrap_or(0);
        }
    }
    if vid == 0 {
        if let Some(i) = up.find("VID&") {
            if let Some(hex) = up.get(i + 6..i + 10) {
                vid = u16::from_str_radix(hex, 16).unwrap_or(0);
            }
        }
    }
    if pid == 0 {
        if let Some(i) = up.find("PID&") {
            if let Some(hex) = up.get(i + 4..i + 8) {
                pid = u16::from_str_radix(hex, 16).unwrap_or(0);
            }
        }
    }
    (vid, pid)
}
