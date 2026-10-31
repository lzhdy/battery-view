//! 匠盟(JM) HID 私有协议电量读取层（达尔优 AE7 8K 接收器 260D:1257）
//!
//! 协议来源：dr.dareu.com 网页驱动逆向提取（jmdevice.js GetBatteryStatus / CheckSum /
//! CommandProcess / GetReport；device.js ReportId 映射）。零第三方 crate，FFI 直调 DLL。
//!
//! 协议规格（真机 2026-10-31 实测确认）：
//! - 命令集合：usagePage=0xFF02 / usage=0x02，input/output report = 17 字节
//!   （[0]=ReportID=0x08 + 16 字节帧体）
//! - 电量命令帧（17 字节）：[0]=0x08 [1]=0x04 [2..15]=0x00 [16]=checksum
//! - checksum：cs = (0x155 - Σ 前 16 字节) & 0xFF（等价 JS：sum<0x55 ? 0x55-sum : 0x155-sum）
//! - 响应（17 字节含 ReportID）：帧体[0]=命令 echo（0x04）、帧体[5]=电量%（0..100）、
//!   帧体[6]=状态（0x00 正常/非充电、0x01 普通充电、0x02 快充、≥0x03 错误）
//!   → 对应 Windows raw 偏移：电量=raw[6]、状态=raw[7]
//! 真机实测：发送 [08 04 00×14 49]，返回 08 04 00 00 02 5F 00 0F E9 00 00 00 00 00 00 F0
//! → 电量 0x5F = 95%，状态 0x00。

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

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
    fn WriteFile(
        h: isize,
        buffer: *const u8,
        n: u32,
        written: *mut u32,
        overlapped: *mut std::ffi::c_void,
    ) -> i32;
    fn ReadFile(
        h: isize,
        buffer: *mut u8,
        n: u32,
        read: *mut u32,
        overlapped: *mut std::ffi::c_void,
    ) -> i32;
    fn WaitForSingleObject(handle: isize, timeout_ms: u32) -> u32;
    fn GetOverlappedResult(
        h: isize,
        overlapped: *mut std::ffi::c_void,
        transferred: *mut u32,
        wait: i32,
    ) -> i32;
    fn GetLastError() -> u32;
}

/// 重叠 IO 结构（与 Windows OVERLAPPED 布局一致）
#[repr(C)]
struct OVERLAPPED {
    internal: usize,
    internal_high: usize,
    offset: u32,
    offset_high: u32,
    h_event: usize,
}

const INVALID_HANDLE_VALUE: isize = -1;
const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const FILE_SHARE_READ: u32 = 0x0000_0001;
const FILE_SHARE_WRITE: u32 = 0x0000_0002;
const OPEN_EXISTING: u32 = 3;
const FILE_FLAG_OVERLAPPED: u32 = 0x4000_0000;
const ERROR_IO_PENDING: u32 = 997;
const WAIT_OBJECT_0: u32 = 0;
const WAIT_TIMEOUT: u32 = 0x0000_0102;

/// 命令集合标识（与网页驱动 ParseDevices 判定一致）
pub const JM_USAGE_PAGE: u16 = 0xFF02;
pub const JM_USAGE: u16 = 0x0002;
pub const JM_REPORT_ID: u8 = 0x08;
/// 完整 report 长度（ReportID + 16 字节帧体）
pub const JM_REPORT_LEN: usize = 17;
/// 电量命令（GetBatteryStatus 的 cmd 字节）
const JM_CMD_BATTERY: u8 = 0x04;

fn utf16(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// 构建 17 字节电量命令帧；checksum 作用于帧前 16 字节（含 ReportID 与 cmd）
fn build_battery_frame() -> [u8; JM_REPORT_LEN] {
    let mut pkt = [0u8; JM_REPORT_LEN];
    pkt[0] = JM_REPORT_ID;
    pkt[1] = JM_CMD_BATTERY;
    let sum: u32 = pkt[..16].iter().map(|&b| b as u32).sum();
    pkt[16] = (0x155u32 - sum) as u8;
    pkt
}

/// 打开 JM 命令集合（需读写访问，ReadFile 用重叠 IO + 超时防挂死）
fn open_cmd(path: &str) -> Result<isize, String> {
    let w = utf16(path);
    let handle = unsafe {
        CreateFileW(
            w.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!("无法打开匠盟命令集合 (GetLastError={})", unsafe { GetLastError() }));
    }
    Ok(handle)
}

/// 读取 input report（重叠 IO，最多等 600ms；读不到返回 None）
fn read_report(handle: isize) -> Option<[u8; JM_REPORT_LEN]> {
    let mut buf = [0u8; JM_REPORT_LEN];
    let mut ov: OVERLAPPED = unsafe { std::mem::zeroed() };
    let mut read: u32 = 0;
    let ok = unsafe {
        ReadFile(
            handle,
            buf.as_mut_ptr(),
            JM_REPORT_LEN as u32,
            &mut read,
            &mut ov as *mut OVERLAPPED as *mut std::ffi::c_void,
        )
    };
    if ok != 0 {
        return (read as usize >= JM_REPORT_LEN).then_some(buf);
    }
    let err = unsafe { GetLastError() };
    if err == ERROR_IO_PENDING {
        // 等待完成；超时返回（设备无响应时不挂死调用线程）
        let wait = unsafe { WaitForSingleObject(handle, 600) };
        if wait == WAIT_OBJECT_0 {
            let mut done: u32 = 0;
            let rok = unsafe {
                GetOverlappedResult(
                    handle,
                    &mut ov as *mut OVERLAPPED as *mut std::ffi::c_void,
                    &mut done,
                    0,
                )
            };
            if rok != 0 && done as usize >= JM_REPORT_LEN {
                return Some(buf);
            }
        }
    }
    None
}

/// 发送 output report（重叠 IO，最多等 1s；成功返回实际写入字节数）
fn write_report(handle: isize, pkt: &[u8; JM_REPORT_LEN]) -> Result<u32, u32> {
    let mut ov: OVERLAPPED = unsafe { std::mem::zeroed() };
    let mut written: u32 = 0;
    let ok = unsafe {
        WriteFile(
            handle,
            pkt.as_ptr(),
            JM_REPORT_LEN as u32,
            &mut written,
            &mut ov as *mut OVERLAPPED as *mut std::ffi::c_void,
        )
    };
    if ok != 0 {
        return Ok(written);
    }
    let err = unsafe { GetLastError() };
    if err == ERROR_IO_PENDING {
        let wait = unsafe { WaitForSingleObject(handle, 1000) };
        if wait == WAIT_OBJECT_0 {
            let mut done: u32 = 0;
            let rok = unsafe {
                GetOverlappedResult(
                    handle,
                    &mut ov as *mut OVERLAPPED as *mut std::ffi::c_void,
                    &mut done,
                    0,
                )
            };
            if rok != 0 {
                return Ok(done);
            }
        }
        return Err(err);
    }
    Err(err)
}

/// 在指定接口读取电量（调用方保证 path 是 JM 命令集合接口）：
/// 响应帧体[5]=电量%（0..100）、帧体[6]=状态（0x00 正常/0x01 普通充电/0x02 快充）
pub fn read_battery(path: &str) -> Result<(Option<u8>, bool), String> {
    let handle = open_cmd(path)?;
    let frame = build_battery_frame();
    match write_report(handle, &frame) {
        Ok(_) => {}
        Err(err) => {
            unsafe { CloseHandle(handle) };
            return Err(format!("写入电量命令失败 (GetLastError={})", err));
        }
    }
    // 响应匹配规则（对齐 JS GetReport）：reportId==0x08 && 首字节 echo 命令（0x04）
    let mut level: Option<u8> = None;
    let mut charging = false;
    for _ in 0..6 {
        match read_report(handle) {
            Some(r) if r[0] == JM_REPORT_ID && r[1] == JM_CMD_BATTERY => {
                // Windows raw 含 ReportID（[0]），帧体从 [1] 起：帧体[5]=电量%、帧体[6]=状态
                level = Some(r[6]);
                let status = r[7];
                charging = status == 0x01 || status == 0x02;
                break;
            }
            Some(_) => continue, // 串帧：非本命令响应，重读
            None => break,       // 超时无响应
        }
    }
    unsafe { CloseHandle(handle) };
    if level.is_none() {
        return Err("设备未应答电量命令（超时）".to_string());
    }
    Ok((level, charging))
}
