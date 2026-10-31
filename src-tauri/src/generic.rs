//! 通用（非雷蛇）HID 外设识别层
//!
//! 枚举白名单品牌的 HID 设备接口（达尔优 AE7 鼠标 / SteelSeries 键盘 / 北通黑武士 4 Pro 手柄），
//! 按 VID:PID 分流 kind/名称/连接方式，电量读取先尝试标准 HID 电池协议（0x84 电池强度页），
//! 无标准协议时返回"暂不支持"（蓝牙设备电池由 sysbat 模块走 Windows 电池类读取）。
//! FFI 直调系统 DLL，零第三方 crate（与 hid.rs 同一风格）。

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
    fn HidP_GetValueCaps(
        report_type: u32,
        value_caps: *mut HIDP_VALUE_CAPS,
        value_caps_length: *mut u16,
        preparsed_data: *mut std::ffi::c_void,
    ) -> i32;
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
}

const DIGCF_PRESENT: u32 = 0x02;
const DIGCF_DEVICEINTERFACE: u32 = 0x10;
const INVALID_HANDLE_VALUE: isize = -1;
const FILE_SHARE_READ: u32 = 0x0000_0001;
const FILE_SHARE_WRITE: u32 = 0x0000_0002;
const OPEN_EXISTING: u32 = 3;

/// 白名单 VID
pub const VID_DAREU: u16 = 0x260D; // 达尔优（Dareu）
pub const VID_STEELSERIES: u16 = 0x1038; // SteelSeries
pub const VID_BETOP: u16 = 0x2E8C; // 北通（Betop，直连模式预留）
pub const VID_MS_XINPUT: u16 = 0x045E; // Microsoft XInput 兼容控制器（FlyDigi Vader 4 以 XInput 枚举）
pub const VID_BLE_KB: u16 = 0x37D7; // BLE HID over GATT 设备（本机为京东京造键盘蓝牙接口）

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

#[repr(C)]
#[derive(Clone, Copy)]
struct HIDP_VALUE_CAPS {
    usage_page: u16,
    report_id: u8,
    is_alias: u8,
    bit_field: u16,
    link_collection: u16,
    link_usage: u16,
    link_usage_page: u16,
    is_range: u8,
    is_string_range: u8,
    is_designator_range: u8,
    is_absolute: u8,
    reserved: [u16; 10],
    string_min: u16,
    string_max: u16,
    designator_min: u16,
    designator_max: u16,
    data_index_min: u16,
    data_index_max: u16,
    pad: u32,
    logical_min: i32,
    logical_max: i32,
    physical_min: i32,
    physical_max: i32,
    units_exp: u32,
    units: u32,
    pad2: u32,
}

/// 识别到的通用设备
#[derive(Clone, Debug)]
pub struct GenericHidDevice {
    /// 设备接口路径（CreateFileW 目标；同时作为前端 deviceId）
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub kind: &'static str,
    pub name: &'static str,
    pub connection: &'static str,
    pub feature_len: u16,
}

fn utf16(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// VID:PID → 识别信息（kind / 名称 / 连接方式）
fn identify(vid: u16, pid: u16) -> Option<(&'static str, &'static str, &'static str)> {
    match (vid, pid) {
        (VID_DAREU, 0x1257) => Some(("mouse", "达尔优 AE7", "2.4G")),
        (VID_STEELSERIES, 0x2052) => Some(("keyboard", "SteelSeries Gaming Keyboard", "有线")),
        (VID_BETOP, _) => Some(("gamepad", "北通 黑武士 4 Pro", "无线")),
        (VID_MS_XINPUT, 0x028E) => Some(("gamepad", "黑武士 4 Pro (XInput)", "XInput")),
        (VID_BLE_KB, 0x1002) => Some(("keyboard", "京东京造键盘", "蓝牙")),
        _ => None,
    }
}

/// 枚举所有 HID 接口（不按 VID 过滤），返回白名单命中的设备
fn list_generic_once() -> Vec<GenericHidDevice> {
    let mut guid: GUID = unsafe { std::mem::zeroed() };
    unsafe { HidD_GetHidGuid(&mut guid) };
    let dev_info = unsafe {
        SetupDiGetClassDevsW(&guid, std::ptr::null(), 0, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)
    };
    if dev_info == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    let mut out: Vec<GenericHidDevice> = Vec::new();
    let mut index: u32 = 0;
    loop {
        let mut if_data: SP_DEVICE_INTERFACE_DATA = unsafe { std::mem::zeroed() };
        if_data.cb_size = std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32;
        let ok = unsafe { SetupDiEnumDeviceInterfaces(dev_info, std::ptr::null(), &guid, index, &mut if_data) };
        if ok == 0 {
            break;
        }
        index += 1;
        let mut required: u32 = 0;
        unsafe {
            SetupDiGetDeviceInterfaceDetailW(dev_info, &if_data, std::ptr::null_mut(), 0, &mut required, std::ptr::null_mut());
        }
        if required == 0 {
            continue;
        }
        let mut detail: Vec<u8> = vec![0u8; required as usize];
        detail[0..4].copy_from_slice(&8u32.to_le_bytes());
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
        let path_u16: Vec<u16> = detail[4..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|&u| u != 0)
            .collect();
        if path_u16.is_empty() {
            continue;
        }
        let path = String::from_utf16_lossy(&path_u16);

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
        let attrs_ok = unsafe { HidD_GetAttributes(handle as *mut std::ffi::c_void, &mut attrs) } != 0;
        let mut feature_len: u16 = 0;
        if attrs_ok {
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

        if !attrs_ok {
            continue;
        }
        if let Some((kind, name, connection)) = identify(attrs.vendor_id, attrs.product_id) {
            out.push(GenericHidDevice {
                path,
                vendor_id: attrs.vendor_id,
                product_id: attrs.product_id,
                kind,
                name,
                connection,
                feature_len,
            });
        }
    }
    unsafe { SetupDiDestroyDeviceInfoList(dev_info) };
    out
}

/// 通用设备列表（按 VID:PID 去重：同一设备的多个 HID 集合只保留第一个接口）
pub fn list_generic_devices() -> Vec<GenericHidDevice> {
    let mut seen: Vec<(u16, u16)> = Vec::new();
    let mut result: Vec<GenericHidDevice> = Vec::new();
    for attempt in 0..5 {
        let all = list_generic_once();
        for d in all {
            if seen.contains(&(d.vendor_id, d.product_id)) {
                continue;
            }
            seen.push((d.vendor_id, d.product_id));
            result.push(d);
        }
        // 命中白名单任一设备即收敛
        if !result.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = attempt;
    }
    result
}

/// 该 HID 接口是否暴露标准 HID 电池强度页（Power Device page 0x84）
fn has_battery_page(handle: isize) -> bool {
    let mut prep: *mut std::ffi::c_void = std::ptr::null_mut();
    if unsafe { HidD_GetPreparsedData(handle as *mut std::ffi::c_void, &mut prep) } == 0 || prep.is_null() {
        return false;
    }
    let mut caps: HIDP_CAPS = HIDP_CAPS::default();
    unsafe { HidP_GetCaps(prep, &mut caps) };
    let mut hit = false;
    for (kind, count) in [
        (0x11u32, caps.number_input_value_caps), // HidP_Input
        (0x13u32, caps.number_feature_value_caps), // HidP_Feature
    ] {
        if count == 0 {
            continue;
        }
        let mut cnt = count;
        let mut buf: Vec<HIDP_VALUE_CAPS> = vec![HIDP_VALUE_CAPS {
            usage_page: 0, report_id: 0, is_alias: 0, bit_field: 0, link_collection: 0,
            link_usage: 0, link_usage_page: 0, is_range: 0, is_string_range: 0,
            is_designator_range: 0, is_absolute: 0, reserved: [0; 10], string_min: 0,
            string_max: 0, designator_min: 0, designator_max: 0, data_index_min: 0,
            data_index_max: 0, pad: 0, logical_min: 0, logical_max: 0, physical_min: 0,
            physical_max: 0, units_exp: 0, units: 0, pad2: 0,
        }; count as usize];
        let ret = unsafe { HidP_GetValueCaps(kind, buf.as_mut_ptr(), &mut cnt, prep) };
        if ret == 0x00110000 || ret == 0 {
            if buf.iter().any(|c| c.usage_page == 0x84) {
                hit = true;
            }
        }
    }
    unsafe { HidD_FreePreparsedData(prep) };
    hit
}

/// 读取通用设备电量：
/// - 标准 HID 电池（0x84 页）设备：读 Input Report 得电池强度（当前本机外设均无此页）
/// - 其余（达尔优 2.4G / XInput 手柄 / 有线键盘 / 蓝牙键盘）：无公开读取协议 →
///   返回 Ok((None, false))，前端显示 "--"（不报错、不影响设备识别）
pub fn read_battery(path: &str, _vid: u16, _pid: u16) -> Result<(Option<u8>, bool), String> {
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
        return Err("无法打开设备".to_string());
    }
    let has = has_battery_page(handle);
    unsafe { CloseHandle(handle) };
    if has {
        // 标准电池强度页存在：读取实现后续扩展（当前本机未出现此类设备）
        Ok((None, false))
    } else {
        Ok((None, false))
    }
}
