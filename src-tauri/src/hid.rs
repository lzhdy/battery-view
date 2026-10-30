//! Razer HID 电量读取层（零第三方 crate，FFI 直调系统 DLL）
//!
//! 枚举 VID=0x1532（Razer）的 HID 设备接口（接收器 0x007D / 有线 0x007C），
//! 用雷蛇全系通用的 90 字节 Feature Report 协议读取电量与充电状态。
//! 真机实测协议参数（91 字节缓冲视角）：
//! - 控制接口：FeatureReportByteLength = 91（缓冲 = ReportID[0] + 90 字节帧体）
//! - 缓冲布局：[1]=status(0x00) [2]=txid(0x3F) [6]=data_size=2 [7]=class=0x07 [8]=cmd [9]=args0 [89]=CRC(XOR 缓冲[3..88])
//! - 电量帧：Class 0x07 / Cmd 0x80 / DataSize 2；回复校验 resp[1]==0x02 && resp[7]==0x07 && resp[8]==0x80
//! - 电量 = resp[10]（0..255 量程 → 百分比 = raw*100/255）
//! - 充电帧：Class 0x07 / Cmd 0x84；resp[10]：0=未充电，1=充电中

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

#[link(name = "setupapi")]
extern "system" {
    fn SetupDiGetClassDevsW(
        class_guid: *const GUID,
        enumerator: *const u16,
        hwnd_parent: usize,
        flags: u32,
    ) -> isize;
    fn SetupDiEnumDeviceInterfaces(
        dev_info: isize,
        dev_info_data: *const u8,
        interface_class_guid: *const GUID,
        member_index: u32,
        device_interface_data: *mut SP_DEVICE_INTERFACE_DATA,
    ) -> i32;
    fn SetupDiGetDeviceInterfaceDetailW(
        dev_info: isize,
        device_interface_data: *const SP_DEVICE_INTERFACE_DATA,
        device_interface_detail_data: *mut u8,
        device_interface_detail_size: u32,
        required_size: *mut u32,
        device_info_data: *mut u8,
    ) -> i32;
    fn SetupDiDestroyDeviceInfoList(dev_info: isize) -> i32;
}

#[link(name = "hid")]
extern "system" {
    fn HidD_GetHidGuid(guid: *mut GUID);
    fn HidD_GetAttributes(device: *mut std::ffi::c_void, attributes: *mut HIDD_ATTRIBUTES) -> i32;
    fn HidD_GetPreparsedData(device: *mut std::ffi::c_void, preparsed_data: *mut *mut std::ffi::c_void) -> i32;
    fn HidD_FreePreparsedData(preparsed_data: *mut std::ffi::c_void) -> i32;
    fn HidP_GetCaps(preparsed_data: *mut std::ffi::c_void, caps: *mut HIDP_CAPS) -> i32;
    fn HidD_SetFeature(device: *mut std::ffi::c_void, report_buffer: *const u8, report_buffer_len: u32) -> i32;
    fn HidD_GetFeature(device: *mut std::ffi::c_void, report_buffer: *mut u8, report_buffer_len: u32) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        file_name: *const u16,
        desired_access: u32,
        share_mode: u32,
        security_attributes: *const u8,
        creation_disposition: u32,
        flags_and_attributes: u32,
        template_file: *mut std::ffi::c_void,
    ) -> isize;
    fn CloseHandle(handle: isize) -> i32;
    fn GetLastError() -> u32;
}

const DIGCF_PRESENT: u32 = 0x02;
const DIGCF_DEVICEINTERFACE: u32 = 0x10;
const INVALID_HANDLE_VALUE: isize = -1;
const FILE_SHARE_READ: u32 = 0x0000_0001;
const FILE_SHARE_WRITE: u32 = 0x0000_0002;
const OPEN_EXISTING: u32 = 3;

/// Razer VID；接收器与有线共用一个 VID
pub const RAZER_VID: u16 = 0x1532;
/// DeathAdder V2 Pro 2.4G HyperSpeed 接收器
pub const PID_DAV2P_24G: u16 = 0x007D;
/// DeathAdder V2 Pro 有线 / 充电线枚举
pub const PID_DAV2P_USB: u16 = 0x007C;

#[repr(C)]
#[derive(Clone, Copy)]
struct GUID {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SP_DEVICE_INTERFACE_DATA {
    cb_size: u32,
    interface_class_guid: GUID,
    flags: u32,
    reserved: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SP_DEVINFO_DATA {
    cb_size: u32,
    class_guid: GUID,
    dev_inst: u32,
    reserved: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct HIDD_ATTRIBUTES {
    size: u32,
    vendor_id: u16,
    product_id: u16,
    version_number: u16,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct HIDP_CAPS {
    usage: u16,
    usage_page: u16,
    input_report_byte_length: u16,
    output_report_byte_length: u16,
    feature_report_byte_length: u16,
    reserved: [u16; 17],
    number_link_collection_nodes: u16,
    number_input_button_caps: u16,
    number_input_value_caps: u16,
    number_input_data_indices: u16,
    number_output_button_caps: u16,
    number_output_value_caps: u16,
    number_output_data_indices: u16,
    number_feature_button_caps: u16,
    number_feature_value_caps: u16,
    number_feature_data_indices: u16,
    number_input_usage_pages: u16,
    number_output_usage_pages: u16,
    number_feature_usage_pages: u16,
    reserved1: u16,
    number_input_button_caps_extended: u16,
    number_output_button_caps_extended: u16,
    number_feature_button_caps_extended: u16,
    number_input_value_caps_extended: u16,
    number_output_value_caps_extended: u16,
    number_feature_value_caps_extended: u16,
    number_input_data_indices_extended: u16,
    number_output_data_indices_extended: u16,
    number_feature_data_indices_extended: u16,
}

/// 枚举到的雷蛇设备接口
#[derive(Clone, Debug)]
pub struct RazerHidDevice {
    /// 设备接口路径（CreateFileW 目标；同时作为前端 deviceId）
    pub path: String,
    pub product_id: u16,
    /// Feature Report 字节长度（真机 DAV2P = 91）
    pub feature_len: u16,
    /// 连接方式描述：2.4G / 有线（充电）
    pub connection: &'static str,
}

fn utf16(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// 枚举所有 Razer 无线鼠标 HID 接口（单次）
fn list_razer_devices_once() -> Result<Vec<RazerHidDevice>, String> {
    let mut guid: GUID = unsafe { std::mem::zeroed() };
    unsafe { HidD_GetHidGuid(&mut guid) };

    let dev_info = unsafe {
        SetupDiGetClassDevsW(&guid, std::ptr::null(), 0, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)
    };
    if dev_info == INVALID_HANDLE_VALUE {
        return Err(format!("SetupDiGetClassDevsW 失败 ({}), 无法访问 HID 设备", unsafe { GetLastError() }));
    }

    let mut out: Vec<RazerHidDevice> = Vec::new();
    let mut index: u32 = 0;
    loop {
        let mut if_data: SP_DEVICE_INTERFACE_DATA = unsafe { std::mem::zeroed() };
        if_data.cb_size = std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32;
        let ok = unsafe { SetupDiEnumDeviceInterfaces(dev_info, std::ptr::null(), &guid, index, &mut if_data) };
        if ok == 0 {
            break; // 枚举完毕
        }
        index += 1;

        // 第一次调用取所需缓冲大小
        let mut required: u32 = 0;
        unsafe {
            SetupDiGetDeviceInterfaceDetailW(dev_info, &if_data, std::ptr::null_mut(), 0, &mut required, std::ptr::null_mut());
        }
        if required == 0 {
            continue;
        }
        // 结构体前置 4 字节 cbSize（detail 的 devicePath 为变长，缓冲按 required 分配）
        let mut detail: Vec<u8> = vec![0u8; required as usize];
        // SP_DEVICE_INTERFACE_DETAIL_DATA_W 的 cbSize 固定写 8（x86/x64 统一按文档）
        detail[0..4].copy_from_slice(&8u32.to_le_bytes());
        // DeviceInfoData 非空（同 Python 参考实现）：部分设备/系统下传 null 会导致接口路径不稳定
        let mut devinfo: SP_DEVINFO_DATA = unsafe { std::mem::zeroed() };
        devinfo.cb_size = std::mem::size_of::<SP_DEVINFO_DATA>() as u32;
        let ok = unsafe {
            SetupDiGetDeviceInterfaceDetailW(
                dev_info,
                &if_data,
                detail.as_mut_ptr(),
                required,
                &mut required,
                &mut devinfo as *mut SP_DEVINFO_DATA as *mut u8,
            )
        };
        if ok == 0 {
            continue;
        }
        // devicePath 从偏移 4 开始（WCHAR 数组，结尾 \\0）
        let path_u16: Vec<u16> = detail[4..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|&u| u != 0)
            .collect();
        if path_u16.is_empty() {
            continue;
        }
        let path = String::from_utf16_lossy(&path_u16);

        // 打开并读取属性（dwDesiredAccess=0 即可；Synapse 占用时可能失败，跳过该接口继续枚举）
        // 注意：CreateFileW 需要以 \0 结尾的宽字符串；path_u16 由 take_while 截取不含 \0，必须补上
        let mut path_w: Vec<u16> = path_u16.clone();
        path_w.push(0);
        let handle = unsafe {
            CreateFileW(
                path_w.as_ptr(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            continue;
        }

        let mut attrs: HIDD_ATTRIBUTES = unsafe { std::mem::zeroed() };
        attrs.size = std::mem::size_of::<HIDD_ATTRIBUTES>() as u32;
        let mut product_id: u16 = 0;
        let mut feature_len: u16 = 0;
        let attrs_ok = unsafe { HidD_GetAttributes(handle as *mut std::ffi::c_void, &mut attrs) } != 0;
        if attrs_ok {
            product_id = attrs.product_id;
            let mut prep: *mut std::ffi::c_void = std::ptr::null_mut();
            let prep_ok = unsafe { HidD_GetPreparsedData(handle as *mut std::ffi::c_void, &mut prep) } != 0 && !prep.is_null();
            if prep_ok {
                let mut caps: HIDP_CAPS = HIDP_CAPS::default();
                let caps_ret = unsafe { HidP_GetCaps(prep, &mut caps) };
                if caps_ret == 0x00110000 || caps_ret == 0 {
                    feature_len = caps.feature_report_byte_length;
                }
                unsafe { HidD_FreePreparsedData(prep) };
            }
        }
        unsafe { CloseHandle(handle) };

        if attrs.vendor_id != RAZER_VID {
            continue;
        }
        let connection: &'static str = match product_id {
            PID_DAV2P_24G => "2.4G",
            PID_DAV2P_USB => "有线",
            _ => continue, // 非目标机型：预留，后续多设备注册在此扩展
        };
        out.push(RazerHidDevice {
            path,
            product_id,
            feature_len,
            connection,
        });
    }
    unsafe { SetupDiDestroyDeviceInfoList(dev_info) };

    // 过滤控制集合：真机控制接口是顶层鼠标集合（mi_00），带 91 字节 Feature Report。
    // 同一设备常枚举出多个集合（如 mi_01 col03 键盘接口无 Feature Report），
    // 只保留带 Feature Report 的集合；若全部缺失（HidP_GetCaps 异常），兜底保留 mi_00。
    let mi_of = |p: &str| -> Option<u32> {
        let bytes = p.as_bytes();
        for i in 0..bytes.len().saturating_sub(4) {
            if &bytes[i..i + 4] == b"&mi_" {
                let start = i + 4;
                let mut j = start;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if j > start {
                    let digits: String = bytes[start..j].iter().map(|b| *b as char).collect();
                    if let Ok(n) = digits.parse::<u32>() {
                        return Some(n);
                    }
                }
            }
        }
        None
    };
    let mut with_mi: Vec<(RazerHidDevice, Option<u32>)> = out
        .into_iter()
        .map(|d| (d.clone(), mi_of(&d.path)))
        .collect();
    // 排序：控制接口（mi_00 且 91 字节）最优先；同类中 Feature Report 长的优先
    with_mi.sort_by(|a, b| {
        let ak = (
            !(a.1 == Some(0) && a.0.feature_len == 91),
            a.1 != Some(0),
            std::cmp::Reverse(a.0.feature_len),
        );
        let bk = (
            !(b.1 == Some(0) && b.0.feature_len == 91),
            b.1 != Some(0),
            std::cmp::Reverse(b.0.feature_len),
        );
        ak.cmp(&bk)
    });
    // 过滤：优先保留 91 字节控制接口；否则 mi_00；否则任何带 Feature Report 的集合
    if with_mi.iter().any(|(d, mi)| *mi == Some(0) && d.feature_len == 91) {
        with_mi.retain(|(d, mi)| *mi == Some(0) && d.feature_len == 91);
    } else if with_mi.iter().any(|(_, mi)| *mi == Some(0)) {
        with_mi.retain(|(_, mi)| *mi == Some(0));
    } else if with_mi.iter().any(|(d, _)| d.feature_len > 0) {
        with_mi.retain(|(d, _)| d.feature_len > 0);
    }
    Ok(with_mi.into_iter().map(|(d, _)| d).collect())
}

/// 枚举 Razer 设备（带重试）：真机接收器的接口集合不稳定（控制接口 mi_00 常枚举不到，
/// 实测约 5% 概率可见）。快速连续重试 20 次（单次枚举 <1ms）直到命中 91 字节控制接口。
pub fn list_razer_devices() -> Result<Vec<RazerHidDevice>, String> {
    let mut last: Result<Vec<RazerHidDevice>, String> = Ok(Vec::new());
    for _attempt in 0..20 {
        last = list_razer_devices_once();
        if let Ok(devs) = &last {
            if devs.iter().any(|d| d.feature_len == 91) {
                return Ok(devs.clone());
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    last
}

/// 构造 91 字节 Feature Report 请求帧（雷蛇 90B 协议，真机实测布局）：
/// 缓冲 [0]=ReportID=0x00；帧体从 [1] 起：帧[0]=status(0x00)、帧[1]=txid、
/// 帧[5]=data_size、帧[6]=class、帧[7]=cmd、帧[8:]=args、帧[88]=crc、帧[89]=rsvd
/// 即缓冲：[1]=status=0x00 [2]=txid [6]=data_size [7]=class [8]=cmd [9]=args0
/// [89]=CRC(XOR 缓冲[3..88]) [90]=reserved
fn build_frame(command_id: u8) -> [u8; 91] {
    let mut buf = [0u8; 91];
    buf[0] = 0x00; // HID Report ID
    buf[1] = 0x00; // status = 0（请求帧固定）
    buf[2] = 0x3F; // Transaction ID（真机确认；兜底可试 0x1F）
    buf[6] = 0x02; // Data size = 2
    buf[7] = 0x07; // Command class：电源/电池
    buf[8] = command_id; // 0x80=GET_BATTERY_LEVEL, 0x84=GET_CHARGING_STATUS
    let mut crc: u8 = 0;
    for i in 3..88 {
        crc ^= buf[i];
    }
    buf[89] = crc;
    buf
}

/// 发送一帧并读回（同步；对齐 Python 金标准时序：Set 后等待 100ms 再 Get，
/// 若回复 BUSY(0x01) 表示设备仍在处理，再等 100ms 重读，最多 3 次）
fn exchange_feature(handle: isize, frame: &[u8; 91]) -> Result<[u8; 91], String> {
    let ok = unsafe { HidD_SetFeature(handle as *mut std::ffi::c_void, frame.as_ptr(), frame.len() as u32) };
    if ok == 0 {
        return Err(format!("HidD_SetFeature 失败 (GetLastError={})", unsafe { GetLastError() }));
    }
    // 无线接收器处理命令需要时间；Python 金标准 sleep(0.1)
    std::thread::sleep(std::time::Duration::from_millis(100));
    let mut resp = [0u8; 91];
    resp[0] = 0x00; // Report ID
    let ok = unsafe { HidD_GetFeature(handle as *mut std::ffi::c_void, resp.as_mut_ptr(), resp.len() as u32) };
    if ok == 0 {
        return Err(format!("HidD_GetFeature 失败 (GetLastError={})", unsafe { GetLastError() }));
    }
    // status=0x01（BUSY）：设备仍在处理上一命令，等 100ms 后重读
    let mut busy_tries = 0;
    while resp[1] == 0x01 && busy_tries < 3 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let ok = unsafe { HidD_GetFeature(handle as *mut std::ffi::c_void, resp.as_mut_ptr(), resp.len() as u32) };
        if ok == 0 {
            return Err(format!("HidD_GetFeature 重读失败 (GetLastError={})", unsafe { GetLastError() }));
        }
        busy_tries += 1;
    }
    Ok(resp)
}

/// 打开设备接口句柄（读属性/Feature Report 用；dwDesiredAccess=0 可打开）
fn open_device(path: &str) -> Result<isize, String> {
    let w = utf16(path);
    let handle = unsafe {
        CreateFileW(
            w.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err("打开设备失败：请确认已退出 Razer Synapse 且鼠标已连接".to_string());
    }
    Ok(handle)
}

/// 打开设备并探测 Feature Report 长度（不信任枚举时的缓存值）
fn open_device_caps(path: &str) -> Result<(isize, u16), String> {
    let handle = open_device(path)?;
    let mut feature: u16 = 0;
    let mut prep: *mut std::ffi::c_void = std::ptr::null_mut();
    if unsafe { HidD_GetPreparsedData(handle as *mut std::ffi::c_void, &mut prep) } != 0 && !prep.is_null() {
        let mut caps: HIDP_CAPS = HIDP_CAPS::default();
        if unsafe { HidP_GetCaps(prep, &mut caps) } != 0 {
            feature = caps.feature_report_byte_length;
        }
        unsafe { HidD_FreePreparsedData(prep) };
    }
    Ok((handle, feature))
}

/// 在指定接口上尝试读取电量（要求 91 字节控制接口）
fn try_read_one(path: &str) -> Result<(Option<u8>, bool), String> {
    let (handle, feature) = open_device_caps(path)?;
    if feature != 91 {
        unsafe { CloseHandle(handle) };
        return Err(format!(
            "该接口 Feature Report 长度 {feature} 字节，暂不支持电量协议（仅支持 91 字节控制接口）"
        ));
    }
    let result = (|| -> Result<(Option<u8>, bool), String> {
        let frame = build_frame(0x80);
        let resp = exchange_feature(handle, &frame)?;
        // 91 字节缓冲：[1]=status、[7]=class、[8]=cmd、[10]=args0（电量 0..255）
        if resp[1] != 0x02 || resp[7] != 0x07 || resp[8] != 0x80 {
            // 状态非 OK：打印完整回复供协议分析
            let full: String = resp.iter().map(|b| format!("{:02X}", b)).collect();
            return Err(format!(
                "设备无响应（完整回复={full}，状态非 0x02，可能协议帧需调整）"
            ));
        }
        let raw: u8 = resp[10];
        // 0..255 量程换算百分比（真机 raw=0x1A=26 → 10%）
        let level: u8 = ((raw as u32) * 100 / 255) as u8;

        // 充电状态帧（无线设备命令间隔 40ms，防串帧）
        std::thread::sleep(std::time::Duration::from_millis(40));
        let frame_c = build_frame(0x84);
        let mut charging: bool = false;
        match exchange_feature(handle, &frame_c) {
            Ok(r) if r[1] == 0x02 && r[7] == 0x07 && r[8] == 0x84 => {
                charging = r[10] == 1;
            }
            _ => { /* 充电状态帧失败不致命，保持 false */ }
        }
        Ok((Some(level), charging))
    })();
    unsafe { CloseHandle(handle) };
    result
}

/// 读取电量与充电状态
/// - 电量帧 Cmd 0x80：resp[10] 为 0..255 量程，换算百分比（raw*100/255）
/// - 充电帧 Cmd 0x84：resp[10] = 1 充电中
/// - 仅支持 91 字节 Feature Report 的控制接口（真机 DeathAdder V2 Pro mi_00）
/// - 若传入路径不是控制接口，自动重新枚举寻找 91 字节接口重试
pub fn read_battery(path: &str, _feature_len_hint: u16) -> Result<(Option<u8>, bool), String> {
    let first = try_read_one(path);
    if first.is_ok() {
        return first;
    }
    // 重枚举兜底：控制接口 mi_00 周期性不可见（约 5% 概率可见），快速连续重试
    for _ in 0..20 {
        if let Ok(devs) = list_razer_devices_once() {
            for d in devs {
                if d.feature_len == 91 {
                    if let Ok(r) = try_read_one(&d.path) {
                        return Ok(r);
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    first
}

/// 在指定接口上尝试读取低电量阈值（0x07/0x81；raw 在 args[0]=resp[9]，0..255 量程）
fn try_read_threshold_one(path: &str) -> Result<Option<u8>, String> {
    let (handle, feature) = open_device_caps(path)?;
    if feature != 91 {
        unsafe { CloseHandle(handle) };
        return Err(format!(
            "该接口 Feature Report 长度 {feature} 字节，暂不支持电量协议（仅支持 91 字节控制接口）"
        ));
    }
    let result = (|| -> Result<Option<u8>, String> {
        let frame = build_frame(0x81);
        let resp = exchange_feature(handle, &frame)?;
        // 91 字节缓冲：[1]=status、[7]=class、[8]=cmd、[9]=args0（低电量阈值 raw 0..255）
        if resp[1] != 0x02 || resp[7] != 0x07 || resp[8] != 0x81 {
            return Err("设备未应答低电量阈值查询（0x07/0x81）".to_string());
        }
        let raw: u8 = resp[9];
        // 0..255 量程换算百分比（真机实测阈值 raw=0x0D=13 → 5%）
        Ok(Some(((raw as u32) * 100 / 255) as u8))
    })();
    unsafe { CloseHandle(handle) };
    result
}

/// 读取设备固件的低电量阈值（百分比；DeathAdder V2 Pro 实测 5%，与官方 <5% 红灯一致）
pub fn read_low_battery(path: &str, _feature_len_hint: u16) -> Result<Option<u8>, String> {
    let first = try_read_threshold_one(path);
    if first.is_ok() {
        return first;
    }
    for _ in 0..20 {
        if let Ok(devs) = list_razer_devices_once() {
            for d in devs {
                if d.feature_len == 91 {
                    if let Ok(r) = try_read_threshold_one(&d.path) {
                        return Ok(r);
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    first
}
