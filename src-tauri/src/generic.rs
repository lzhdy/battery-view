//! 通用（非雷蛇）HID 外设识别层
//!
//! 枚举白名单品牌的 HID 设备接口（达尔优 AE7 鼠标 / 北通黑武士 4 Pro 手柄 / 京东京造键盘），
//! 按 VID:PID 分流 kind/名称/连接方式；电量读取策略：
//! - 蓝牙键盘（京东京造，BLE HID over GATT）→ 由 BLE Provider 单独路由（ble.rs，0x180F/0x2A19）
//! - 标准 HID 电池页（0x84）设备 → 本文件按 HID 规范读取 Battery Strength（0x40）+ Charging（0x44）
//! - 其余（达尔优 2.4G 私有协议 / XInput 手柄）→ 无公开电量读取协议，返回 "--"
//! FFI 直调系统 DLL，零第三方 crate（与 hid.rs 同一风格；BLE 读取走 windows crate WinRT 投影）。

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
    fn HidD_GetInputReport(device: *mut std::ffi::c_void, report_buffer: *mut u8, report_buffer_len: u32) -> i32;
    fn HidD_GetFeature(device: *mut std::ffi::c_void, report_buffer: *mut u8, report_buffer_len: u32) -> i32;
    fn HidP_GetCaps(preparsed_data: *mut std::ffi::c_void, caps: *mut HIDP_CAPS) -> i32;
    fn HidP_GetValueCaps(
        report_type: u32,
        value_caps: *mut HIDP_VALUE_CAPS,
        value_caps_length: *mut u16,
        preparsed_data: *mut std::ffi::c_void,
    ) -> i32;
    fn HidP_GetUsageValue(
        report_type: u32,
        usage_page: u16,
        link_collection: u16,
        usage: u16,
        usage_value: *mut u32,
        preparsed_data: *mut std::ffi::c_void,
        report: *const u8,
        report_length: u16,
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
const HIDP_INPUT: u32 = 0x11;
const HIDP_FEATURE: u32 = 0x13;
const USAGE_PAGE_BATTERY: u16 = 0x84; // Power Device page：标准 HID 电池
const USAGE_BATTERY_STRENGTH: u16 = 0x40; // Battery Strength（0-100/0-255）
const USAGE_BATTERY_CHARGING: u16 = 0x44; // Battery Charging（boolean）

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

fn utf16(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// 枚举本机全部 HID 接口（不按 VID/PID 过滤）：
/// (path, vid, pid, feature_len, usage_page, usage, input_len)。
/// 平台统一枚举源（设计 v0.2 P0-1）：DeviceManager 与 generic 白名单列表共用，
/// 覆盖雷蛇 / 通用 / BLE HID-over-GATT 三类接口。
/// usage_page/usage/input_len 供 DeviceManager 识别私有协议命令集合（如匠盟 FF02:02）。
pub fn enumerate_all_hid() -> Vec<(String, u16, u16, u16, u16, u16, u16)> {
    let mut guid: GUID = unsafe { std::mem::zeroed() };
    unsafe { HidD_GetHidGuid(&mut guid) };
    let dev_info = unsafe {
        SetupDiGetClassDevsW(&guid, std::ptr::null(), 0, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)
    };
    if dev_info == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    let mut out: Vec<(String, u16, u16, u16, u16, u16, u16)> = Vec::new();
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
        let mut usage_page: u16 = 0;
        let mut usage: u16 = 0;
        let mut input_len: u16 = 0;
        if attrs_ok {
            let mut prep: *mut std::ffi::c_void = std::ptr::null_mut();
            let prep_ok = unsafe { HidD_GetPreparsedData(handle as *mut std::ffi::c_void, &mut prep) } != 0 && !prep.is_null();
            if prep_ok {
                let mut caps: HIDP_CAPS = HIDP_CAPS::default();
                let caps_ret = unsafe { HidP_GetCaps(prep, &mut caps) };
                if caps_ret == 0x00110000 || caps_ret == 0 {
                    feature_len = caps.feature_report_byte_length;
                    usage_page = caps.usage_page;
                    usage = caps.usage;
                    input_len = caps.input_report_byte_length;
                }
                unsafe { HidD_FreePreparsedData(prep) };
            }
        }
        unsafe { CloseHandle(handle) };

        if !attrs_ok {
            continue;
        }
        out.push((path, attrs.vendor_id, attrs.product_id, feature_len, usage_page, usage, input_len));
    }
    unsafe { SetupDiDestroyDeviceInfoList(dev_info) };
    out
}

/// 该 HID 接口是否暴露标准 HID 电池强度页（Power Device page 0x84）。
/// 使用已获取的 preparsed data 检测（避免重复 GetPreparsedData）。
fn has_battery_page_from_prep(prep: *mut std::ffi::c_void) -> bool {
    let mut caps: HIDP_CAPS = HIDP_CAPS::default();
    unsafe { HidP_GetCaps(prep, &mut caps) };
    let mut hit = false;
    for (kind, count) in [
        (HIDP_INPUT, caps.number_input_value_caps),
        (HIDP_FEATURE, caps.number_feature_value_caps),
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
            if buf.iter().any(|c| c.usage_page == USAGE_PAGE_BATTERY) {
                hit = true;
            }
        }
    }
    hit
}

/// 从一份报告 buffer 中解析标准电池用法：电量（0x84:0x40）+ 充电状态（0x84:0x44）。
/// 返回 (电量百分比, 是否充电中)；任一步失败 → (None, false) 防误报。
fn parse_battery_usages(
    report_type: u32,
    prep: *mut std::ffi::c_void,
    buf: &[u8],
) -> (Option<u8>, bool) {
    let mut level: u32 = 0;
    let mut charging: u32 = 0;
    let r1 = unsafe {
        HidP_GetUsageValue(
            report_type,
            USAGE_PAGE_BATTERY,
            0,
            USAGE_BATTERY_STRENGTH,
            &mut level,
            prep,
            buf.as_ptr(),
            buf.len() as u16,
        )
    };
    if r1 != 0 {
        return (None, false);
    }
    let r2 = unsafe {
        HidP_GetUsageValue(
            report_type,
            USAGE_PAGE_BATTERY,
            0,
            USAGE_BATTERY_CHARGING,
            &mut charging,
            prep,
            buf.as_ptr(),
            buf.len() as u16,
        )
    };
    // Battery Strength 逻辑范围通常 0-100；个别设备按 0-255 报告，按比例缩放兜底
    let v = if level <= 100 { level as u8 } else { ((level as u32 * 100) / 255) as u8 };
    (Some(v), r2 == 0 && charging != 0)
}

/// 读取标准 HID 设备电量（HID Provider 只接收注册表 provider_id=hid 的设备）：
/// - 标准 HID 电池页（0x84）设备：优先 Input Report，失败再试 Feature Report，
///   读 Battery Strength（0x40）为电量、Battery Charging（0x44）为充电状态（阶段 C 补全）
/// - 其余（达尔优 2.4G / XInput 手柄）：无公开读取协议 →
///   返回 Ok((None, false))，前端显示 "--"（不报错、不影响设备识别）
/// - BLE 键盘由 BLE Provider 单独路由（ble.rs），不在此处处理（P4 已收敛）
pub fn read_battery(path: &str) -> Result<(Option<u8>, bool), String> {
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
    let mut prep: *mut std::ffi::c_void = std::ptr::null_mut();
    if unsafe { HidD_GetPreparsedData(handle as *mut std::ffi::c_void, &mut prep) } == 0 || prep.is_null() {
        unsafe { CloseHandle(handle) };
        return Err("无法获取设备解析数据".to_string());
    }
    // 无 0x84 电池页 → 非标准电池设备，返回 "--"（不报错）
    if !has_battery_page_from_prep(prep) {
        unsafe { HidD_FreePreparsedData(prep) };
        unsafe { CloseHandle(handle) };
        return Ok((None, false));
    }
    let mut caps: HIDP_CAPS = HIDP_CAPS::default();
    unsafe { HidP_GetCaps(prep, &mut caps) };
    let mut out: (Option<u8>, bool) = (None, false);
    // 1) Input Report（多数电池设备经输入报告上报状态）
    if caps.input_report_byte_length > 0 {
        let len = caps.input_report_byte_length as usize;
        let mut buf = vec![0u8; len];
        let ok = unsafe { HidD_GetInputReport(handle as *mut std::ffi::c_void, buf.as_mut_ptr(), len as u32) } != 0;
        if ok {
            out = parse_battery_usages(HIDP_INPUT, prep, &buf);
        }
    }
    // 2) Input 读不到时回退 Feature Report
    if out.0.is_none() && caps.feature_report_byte_length > 0 {
        let len = caps.feature_report_byte_length as usize;
        let mut buf = vec![0u8; len];
        let ok = unsafe { HidD_GetFeature(handle as *mut std::ffi::c_void, buf.as_mut_ptr(), len as u32) } != 0;
        if ok {
            out = parse_battery_usages(HIDP_FEATURE, prep, &buf);
        }
    }
    unsafe { HidD_FreePreparsedData(prep) };
    unsafe { CloseHandle(handle) };
    Ok(out)
}
