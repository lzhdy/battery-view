//! BLE GATT 电池读取（Windows WinRT / GenericAttributeProfile）
//!
//! 用于支持 BLE 电池服务（0x180F / Battery Service、特征 0x2A19 Battery Level）的
//! 蓝牙外设（如京东京造键盘）。走 Windows 系统 GATT API 读取**已配对设备**的电池
//! 百分比，不主动发起新连接（BLE 外设通常只允许一个连接，系统已占用的设备无法二次连接）。
//!
//! 实现说明：windows 0.62 的 WinRT 异步投影（windows-future）不提供公开的同步等待
//! trait，这里用 `futures::executor::block_on` 消费其 `IntoFuture`（await）实现阻塞等待。

use std::future::IntoFuture;

use windows::Devices::Bluetooth::BluetoothCacheMode;
use windows::Devices::Bluetooth::BluetoothLEDevice;
use windows::Devices::Enumeration::DeviceInformation;
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

const BATT_SERVICE: u128 = 0x0000_180f_0000_1000_8000_0080_5f9b_34fb;
const BATT_LEVEL: u128 = 0x0000_2a19_0000_1000_8000_0080_5f9b_34fb;

/// 读取指定 VID/PID 的已配对 BLE 外设电池百分比。
///
/// 枚举系统 BLE 设备，按设备实例 ID 中出现的 `VID&xxxx_PID&xxxx` 匹配目标；
/// 打开后遍历 GATT 服务，命中 Battery Service（0x180F）后读取 Battery Level 特征
/// （0x2A19）。设备未配对 / 已断开 / 固件未实现电池服务时返回 `None`。
pub fn read_ble_battery(vid: u16, pid: u16) -> Option<u8> {
    // COM 初始化（MTA，幂等；失败不致命，WinRT 调用可能因未初始化而异常）
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    // 1) 枚举系统已配对 BLE 设备
    let op = DeviceInformation::FindAllAsync().ok()?;
    let devs = futures::executor::block_on(op.into_future()).ok()?;

    let vid_hex = format!("{:04X}", vid);
    let pid_hex = format!("{:04X}", pid);

    // 2) 按设备 ID 中的 VID/PID 定位目标（ID 形如 \\?\BTHLEDEVICE\{...}_DEV_VID&0137D7_PID&1002_...）
    let mut target: Option<windows::core::HSTRING> = None;
    let n = devs.Size().ok()?;
    for i in 0..n {
        let d = devs.GetAt(i).ok()?;
        let id = d.Id().ok()?.to_string().to_uppercase();
        if id.contains(&vid_hex) && id.contains(&pid_hex) {
            target = Some(d.Id().ok()?);
            break;
        }
    }
    let target_id = target?;

    // 3) 打开蓝牙 LE 设备
    let op = BluetoothLEDevice::FromIdAsync(&target_id).ok()?;
    let dev = futures::executor::block_on(op.into_future()).ok()?;

    // 4) 遍历 GATT 服务，查找 Battery Service
    let sres = futures::executor::block_on(dev.GetGattServicesAsync().ok()?.into_future()).ok()?;
    let services = sres.Services().ok()?;
    let sn = services.Size().ok()?;
    for i in 0..sn {
        let svc = services.GetAt(i).ok()?;
        if u128::from(svc.Uuid().ok()?) != BATT_SERVICE {
            continue;
        }
        // 5) 读取 Battery Level 特征
        let cres = futures::executor::block_on(svc.GetCharacteristicsAsync().ok()?.into_future()).ok()?;
        let chars = cres.Characteristics().ok()?;
        let cn = chars.Size().ok()?;
        for j in 0..cn {
            let ch = chars.GetAt(j).ok()?;
            if u128::from(ch.Uuid().ok()?) != BATT_LEVEL {
                continue;
            }
            // 强制 Uncached 读取：无参 ReadValueAsync() 默认走 Windows GATT 缓存
            // （Cached），系统首次连接缓存的值可能长期不变（实测键盘 3h 电量不动）；
            // ReadValueWithCacheModeAsync(Uncached) 直接从设备读实时 Battery Level。
            let op = ch.ReadValueWithCacheModeAsync(BluetoothCacheMode::Uncached).ok()?;
            let result = futures::executor::block_on(op.into_future()).ok()?;
            let buf = result.Value().ok()?;
            let reader = DataReader::FromBuffer(&buf).ok()?;
            return Some(reader.ReadByte().ok()?);
        }
        break;
    }
    None
}
