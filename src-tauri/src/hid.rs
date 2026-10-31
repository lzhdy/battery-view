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


#[link(name = "hid")]
extern "system" {
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

const INVALID_HANDLE_VALUE: isize = -1;
const FILE_SHARE_READ: u32 = 0x0000_0001;
const FILE_SHARE_WRITE: u32 = 0x0000_0002;
const OPEN_EXISTING: u32 = 3;



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


fn utf16(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
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
/// - 设备接口由 DeviceManager::discover() 统一枚举选出（枚举职责已上收平台，阶段 B）
pub fn read_battery(path: &str, _feature_len_hint: u16) -> Result<(Option<u8>, bool), String> {
    try_read_one(path)
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
/// 设备接口由 DeviceManager::discover() 统一枚举选出（阶段 B）
pub fn read_low_battery(path: &str, _feature_len_hint: u16) -> Result<Option<u8>, String> {
    try_read_threshold_one(path)
}
