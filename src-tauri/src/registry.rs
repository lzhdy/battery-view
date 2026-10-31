//! 设备注册表：设备知识单一事实源（设计 v0.2 P0-2 / "重新录入"清单）。
//!
//! 本表替代散落在 identify() / pid_name() / kind_for_pid() 三处的设备映射；
//! 阶段 A 先建表并让 DeviceManager 消费，阶段 B 再删除旧映射。
//! 不在表中的设备不识别、不进主界面、不进托盘（白名单语义）。

/// 设备条目：注册表中一行
#[derive(Debug, Clone, Copy)]
pub struct DeviceEntry {
    pub vid: u16,
    /// None = 通配 VID（如北通 2E8C:*）
    pub pid: Option<u16>,
    pub kind: &'static str,
    pub name: &'static str,
    pub connection: &'static str,
    pub protocol: &'static str,
    pub provider_id: &'static str,
}

pub const PROVIDER_RAZER: &str = "razer";
pub const PROVIDER_HID: &str = "hid";
pub const PROVIDER_BLE: &str = "ble";
pub const PROVIDER_JM: &str = "jm";

/// 现有设备重新录入清单（与 README 设备表一致，SteelSeries 天然不在表中）。
/// 用 OnceLock 静态化，lookup_entry 可返回 &'static 引用。
fn table() -> &'static [DeviceEntry] {
    static TABLE: std::sync::OnceLock<Vec<DeviceEntry>> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        vec![
            // 雷蛇（90B 私有协议）
            DeviceEntry { vid: 0x1532, pid: Some(0x007C), kind: "mouse", name: "DeathAdder V2 Pro", connection: "有线", protocol: "Razer 90B Feature Report", provider_id: PROVIDER_RAZER },
            DeviceEntry { vid: 0x1532, pid: Some(0x007D), kind: "mouse", name: "DeathAdder V2 Pro", connection: "2.4G", protocol: "Razer 90B Feature Report", provider_id: PROVIDER_RAZER },
            // 达尔优 AE7（匠盟 JM 私有协议，经网页驱动 jmdevice.js 逆向 + 真机实测：
            // 0x08 report / cmd 0x04 → Windows raw[6]=电量%、raw[7]=状态 0x01/0x02 充电）
            // 有线直连为鼠标本体 260D:1250；2.4G 为 8K 接收器 260D:1257（电量经 dongle 转发）
            DeviceEntry { vid: 0x260D, pid: Some(0x1250), kind: "mouse", name: "达尔优 AE7", connection: "有线", protocol: "匠盟(JM) 私有协议", provider_id: PROVIDER_JM },
            DeviceEntry { vid: 0x260D, pid: Some(0x1257), kind: "mouse", name: "达尔优 AE7", connection: "2.4G", protocol: "匠盟(JM) 私有协议", provider_id: PROVIDER_JM },
            // 北通 黑武士 4 Pro（直连/2.4G 无线，VID 通配）
            DeviceEntry { vid: 0x2E8C, pid: None, kind: "gamepad", name: "黑武士 4 Pro", connection: "无线", protocol: "无公开协议", provider_id: PROVIDER_HID },
            // 北通 黑武士 4 Pro（XInput 形态）
            DeviceEntry { vid: 0x045E, pid: Some(0x028E), kind: "gamepad", name: "黑武士 4 Pro (XInput)", connection: "XInput", protocol: "无公开协议", provider_id: PROVIDER_HID },
            // 注意：37D7:1002 实为 FlyDigi BS2PRO 散热器（非键盘，用户既定不入列表），已从注册表移除；
            // 京东京造键盘（蓝牙）经实机核验为 Keychron K8（VID 05AC:PID 024F，传统蓝牙/HID-over-GATT），
            // 未暴露标准 BLE Battery Service（0x180F），无电量可读，按协议必然处理不入表。
        ]
    })
}

#[allow(dead_code)]
pub fn device_registry() -> &'static [DeviceEntry] {
    table()
}

/// 按 VID/PID 查找设备条目（pid 支持通配：先精确后通配）
pub fn lookup_entry(vid: u16, pid: u16) -> Option<&'static DeviceEntry> {
    let table = table();
    table
        .iter()
        .find(|e| e.vid == vid && e.pid == Some(pid))
        .or_else(|| table.iter().find(|e| e.vid == vid && e.pid.is_none()))
}
