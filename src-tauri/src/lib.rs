use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

mod generic;
mod hid;
mod tray;

// ── 运行时设置（开机自启 / 充电弹窗开关）：static 供轮询线程实时读取，磁盘 JSON 持久化 ──
static AUTO_START_EN: AtomicBool = AtomicBool::new(true);
static POPUP_CHARGING_EN: AtomicBool = AtomicBool::new(true);

/// 设置文件路径：%APPDATA%\battery-view\settings.json
fn prefs_path() -> std::path::PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    base.join("battery-view").join("settings.json")
}

/// 启动时加载持久化的设置（无文件则保持默认值）
fn load_prefs() {
    if let Ok(txt) = fs::read_to_string(prefs_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(b) = v.get("autoStart").and_then(|x| x.as_bool()) {
                AUTO_START_EN.store(b, Ordering::Relaxed);
            }
            if let Some(b) = v.get("popupCharging").and_then(|x| x.as_bool()) {
                POPUP_CHARGING_EN.store(b, Ordering::Relaxed);
            }
        }
    }
}

/// 保存单个布尔设置到 settings.json（保留其它字段）
fn save_pref(key: &str, value: bool) -> Result<(), String> {
    let p = prefs_path();
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut obj = serde_json::json!({});
    if let Ok(txt) = fs::read_to_string(&p) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if v.is_object() {
                obj = v;
            }
        }
    }
    obj[key] = serde_json::Value::Bool(value);
    fs::write(&p, serde_json::to_string_pretty(&obj).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// 写入/删除 HKCU\...\Run 键（BatteryView 开机自启）
fn set_autostart_registry(enabled: bool) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
    };
    let run_key: Vec<u16> = r"Software\Microsoft\Windows\CurrentVersion\Run"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let name: Vec<u16> = "BatteryView".encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let cmd = format!("\"{}\"", exe.display());
            let value: Vec<u16> = cmd.encode_utf16().chain(std::iter::once(0)).collect();
            let rc = RegSetKeyValueW(
                HKEY_CURRENT_USER,
                run_key.as_ptr(),
                name.as_ptr(),
                REG_SZ,
                value.as_ptr() as *const core::ffi::c_void,
                (value.len() * 2) as u32,
            );
            if rc != 0 {
                return Err(format!("RegSetKeyValueW failed: {rc}"));
            }
        } else {
            let rc = RegDeleteKeyValueW(HKEY_CURRENT_USER, run_key.as_ptr(), name.as_ptr());
            if rc != 0 {
                return Err(format!("RegDeleteKeyValueW failed: {rc}"));
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn get_auto_start() -> bool {
    AUTO_START_EN.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_auto_start(enabled: bool) -> Result<(), String> {
    set_autostart_registry(enabled)?;
    AUTO_START_EN.store(enabled, Ordering::Relaxed);
    save_pref("autoStart", enabled)
}

#[tauri::command]
fn get_popup_charging() -> bool {
    POPUP_CHARGING_EN.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_popup_charging(enabled: bool) -> Result<(), String> {
    POPUP_CHARGING_EN.store(enabled, Ordering::Relaxed);
    save_pref("popupCharging", enabled)
}

/// 单实例互斥锁：返回 true 表示本进程应继续；false 表示已有实例在运行，应直接退出。
/// 防止用户重复启动/双击产生多个透明窗口叠加闪烁（黑框闪动）。
fn ensure_single_instance() -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    let name: Vec<u16> = "Local\\BatteryView_SingleInstance_Mutex"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let handle = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
        if handle.is_null() {
            return true; // 创建失败不阻塞启动
        }
        if GetLastError() == ERROR_ALREADY_EXISTS {
            return false;
        }
    }
    true
}

/// 标准 RFC 4648 Base64 解码（支持末尾 padding 与空白字符）。
fn base64_decode(input: &[u8]) -> Result<Vec<u8>, String> {
    fn val(b: u8) -> Result<u32, String> {
        match b {
            b'A'..=b'Z' => Ok((b - b'A') as u32),
            b'a'..=b'z' => Ok((b - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((b - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err(format!("非法 base64 字符: {}", b as char)),
        }
    }

    let s: Vec<u8> = input
        .iter()
        .copied()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if s.is_empty() {
        return Err("base64 内容为空".into());
    }
    let mut pad: usize = 0;
    for &b in s.iter().rev() {
        if b == b'=' {
            pad += 1;
        } else {
            break;
        }
    }
    let data_len = s.len() - pad;
    if data_len % 4 == 1 || pad > 2 {
        return Err("base64 长度非法".into());
    }
    let mut out = Vec::with_capacity(data_len / 4 * 3 + 2);
    let mut i = 0;
    while i < data_len {
        let a = val(s[i])?;
        let b = val(s[i + 1])?;
        let c = if i + 2 < data_len {
            Some(val(s[i + 2])?)
        } else {
            None
        };
        let d = if i + 3 < data_len {
            Some(val(s[i + 3])?)
        } else {
            None
        };
        let triple = (a << 18) | (b << 12) | (c.unwrap_or(0) << 6) | d.unwrap_or(0);
        out.push((triple >> 16) as u8);
        if c.is_some() {
            out.push((triple >> 8) as u8);
        }
        if d.is_some() {
            out.push(triple as u8);
        }
        i += 4;
    }
    Ok(out)
}

/// 标准 RFC 4648 Base64 编码。
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(triple >> 18) as usize & 0x3F] as char);
        out.push(TABLE[(triple >> 12) as usize & 0x3F] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(triple >> 6) as usize & 0x3F] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[triple as usize & 0x3F] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// 解析 data URL（如 `data:image/png;base64,<body>`）为 (字节, 扩展名)。
fn parse_data_url(data: &str) -> Result<(Vec<u8>, String), String> {
    let rest = data
        .strip_prefix("data:")
        .ok_or_else(|| "非法 data URL 前缀".to_string())?;
    let comma = rest.find(',').ok_or_else(|| "非法 data URL（缺少逗号）".to_string())?;
    let meta = &rest[..comma];
    let body = &rest[comma + 1..];
    let mime = meta.split(';').next().unwrap_or("image/png");
    let ext = match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    };
    let bytes = base64_decode(body.as_bytes())?;
    Ok((bytes, ext.to_string()))
}

fn backgrounds_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backgrounds");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 保存自定义背景图片（data URL → appData/backgrounds/custom.<ext>）。成功返回空串。
#[tauri::command]
fn save_background(app: tauri::AppHandle, data: String) -> Result<String, String> {
    let (bytes, ext) = parse_data_url(&data)?;
    let dir = backgrounds_dir(&app)?;
    let path = dir.join(format!("custom.{ext}"));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// 读取自定义背景图片，返回 data URL；无自定义背景时返回 null。
#[tauri::command]
fn load_background(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backgrounds");
    if !dir.exists() {
        return Ok(None);
    }
    for ext in ["png", "jpg", "jpeg", "webp"] {
        let p = dir.join(format!("custom.{ext}"));
        if p.exists() {
            let bytes = fs::read(&p).map_err(|e| e.to_string())?;
            let mime = match ext {
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                _ => "image/png",
            };
            return Ok(Some(format!("data:{mime};base64,{}", base64_encode(&bytes))));
        }
    }
    Ok(None)
}

/// 删除自定义背景图片，恢复默认背景。
#[tauri::command]
fn remove_background(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backgrounds");
    if !dir.exists() {
        return Ok(());
    }
    for ext in ["jpg", "jpeg", "png", "webp"] {
        let p = dir.join(format!("custom.{ext}"));
        if p.exists() {
            fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 枚举全部受支持的外设：
/// - 雷蛇 HID 设备（真机：DeathAdder V2 Pro 2.4G 接收器 0x007D / 有线 0x007C，走 90B Feature Report）
/// - 通用外设（达尔优 AE7 鼠标 / SteelSeries 笔记本键盘 / 黑武士 4 Pro 手柄 / 京东京造蓝牙键盘，
///   识别与名称映射，电量读取视设备公开协议而定）
/// 返回前端可直接消费的设备列表字段（productId 统一为 "VID:PID"）。
#[tauri::command]
fn list_hid_devices() -> Result<Vec<serde_json::Value>, String> {
    let mut out: Vec<serde_json::Value> = Vec::new();
    for d in hid::list_razer_devices()? {
        let pid = d.product_id;
        out.push(serde_json::json!({
            "id": d.path,
            "productId": format!("1532:{:04X}", pid),
            "kind": kind_for_pid(pid),
            "name": pid_name(pid),
            "connection": d.connection,
            "featureLen": d.feature_len,
            "source": "razer",
        }));
    }
    for d in generic::list_generic_devices() {
        out.push(serde_json::json!({
            "id": d.path,
            "productId": format!("{:04X}:{:04X}", d.vendor_id, d.product_id),
            "kind": d.kind,
            "name": d.name,
            "connection": d.connection,
            "featureLen": d.feature_len,
            "source": "generic",
        }));
    }
    Ok(out)
}

/// 读取指定设备的电量与充电状态（按设备路径分流：雷蛇走 90B 协议，通用设备按各自能力）。
#[tauri::command]
fn read_battery_level(path: String, feature_len: Option<u16>) -> Result<serde_json::Value, String> {
    let (level, charging) = if path.contains("vid_1532") {
        hid::read_battery(&path, feature_len.unwrap_or(91))?
    } else {
        generic::read_battery(&path, 0, 0)?
    };
    Ok(serde_json::json!({ "level": level, "charging": charging }))
}

/// 读取设备固件的低电量阈值（百分比；DeathAdder V2 Pro 真机实测 5%）。
/// 通用外设无公开低电量阈值协议，返回 null。
#[tauri::command]
fn read_low_battery_threshold(path: String, feature_len: Option<u16>) -> Result<Option<u8>, String> {
    if path.contains("vid_1532") {
        hid::read_low_battery(&path, feature_len.unwrap_or(91))
    } else {
        Ok(None)
    }
}

/// 设备 PID → 设备类型（前端大图 / 托盘剪影 / 弹窗图标共用）
fn kind_for_pid(product_id: u16) -> &'static str {
    match product_id {
        // 鼠标
        0x007C | 0x007D => "mouse", // DeathAdder V2 Pro（有线/2.4G 接收器）
        0x00B2 => "mouse",          // DeathAdder V3 Pro
        0x00A6 => "mouse",          // Viper V2 Pro
        0x00A5 => "mouse",          // Viper V3 Pro
        0x00AE => "mouse",          // Basilisk V3 Pro
        // 键盘
        0x00B3 => "keyboard", // BlackWidow V4 Pro
        // 耳机
        0x00C6 => "headset", // Kraken V4 Pro
        _ => "mouse",        // 未知设备兜底（鼠标轮廓）
    }
}

/// 常见雷蛇产品名（托盘 tooltip / 前端设备名使用；未收录的退回 PID 显示）
fn pid_name(product_id: u16) -> &'static str {
    match product_id {
        0x007C | 0x007D => "DeathAdder V2 Pro",
        0x00B2 => "DeathAdder V3 Pro",
        0x00A6 => "Viper V2 Pro",
        0x00A5 => "Viper V3 Pro",
        0x00AE => "Basilisk V3 Pro",
        0x00B3 => "BlackWidow V4 Pro",
        0x00C6 => "Kraken V4 Pro",
        _ => "Razer 设备",
    }
}

/// 构建托盘右键菜单：设备列表（PID + 连接方式 + 电量） + 显示/退出
fn build_tray_menu(
    app: &tauri::AppHandle,
    states: &[(hid::RazerHidDevice, Option<u8>, bool)],
) -> Result<tauri::menu::Menu<tauri::Wry>, String> {
    let menu = MenuBuilder::new(app)
        .text("header", "外设电量坞 · 2.4G Battery View")
        .separator()
        .build()
        .map_err(|e| e.to_string())?;
    if states.is_empty() {
        menu.append(
            &MenuItem::with_id(app, "no-device", "未检测到设备", false, None::<&str>)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    } else {
        for (dev, level, charging) in states {
            let pct = match level {
                Some(l) => format!("{l}%"),
                None => "--".to_string(),
            };
            let chg = if *charging { " · 充电中" } else { "" };
            let text = format!("{:04X} · {}{} · {}", dev.product_id, dev.connection, chg, pct);
            menu.append(
                &MenuItem::with_id(app, format!("dev-{}", dev.path), text, true, None::<&str>)
                    .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    menu.append(
        &MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    menu.append(
        &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(menu)
}

/// 显示并聚焦主窗口
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 前端渲染完成后调用：显示主窗口（消除启动时的黑框闪烁）
#[tauri::command]
fn show_main_after_ready(app: tauri::AppHandle) {
    show_main_window(&app);
}

/// 弹窗显示：传入 JSON 负载与窗口高度，定位屏幕右下角并置顶弹出
#[tauri::command]
fn show_popup(app: tauri::AppHandle, payload: String, height: u32) -> Result<(), String> {
    let win = app
        .get_webview_window("popup")
        .ok_or("popup window not found")?;
    let mon = win
        .current_monitor().map_err(|e| e.to_string())?
        .ok_or("no monitor")?;
    let scale = mon.scale_factor();
    // 用工作区（排除任务栏）定位，弹窗底部停在任务栏上方 12px
    let wa = mon.work_area();
    let wa_pos = wa.position;
    let wa_size = wa.size;
    let w = 320.0_f64;
    let h = height as f64;
    let x = (wa_pos.x as f64 / scale) + (wa_size.width as f64 / scale) - w - 16.0;
    let y = (wa_pos.y as f64 / scale) + (wa_size.height as f64 / scale) - h - 12.0;
    win.set_size(tauri::LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    win.set_position(tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    let js = format!(
        "window.__popupPayload={};window.dispatchEvent(new CustomEvent('app:popup',{{detail:{}}}));window.__showPopup&&window.__showPopup({});try{{localStorage.setItem('bv_last_popup_charging_at',String(Date.now()))}}catch(e){{}}",
        payload, payload, payload
    );
    win.eval(&js).map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 弹窗关闭（隐藏，窗口保留复用）
#[tauri::command]
fn close_popup(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        let _ = win.hide();
    }
}

/// 简单扩展名 → MIME 映射（为磁盘资源协议提供 Content-Type）。
fn asset_mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "json" | "map" => "application/json",
        _ => "application/octet-stream",
    }
}

/// 前端资源根目录（优先打包安装目录，回退开发目录）。
fn dist_base() -> std::path::PathBuf {
    // 1) 打包安装后：exe 同目录 resources/dist/client（NSIS/MSI 的 bundle.resources 布局）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("resources").join("dist").join("client");
            if p.join("index.html").exists() {
                return p;
            }
            // 2) 开发运行（cargo run / release exe 直接跑，dist 未进 resources）
            let p2 = dir.join("dist").join("client");
            if p2.join("index.html").exists() {
                return p2;
            }
        }
    }
    // 3) 编译期工程目录：src-tauri/../dist/client
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("dist")
        .join("client");
    if dev.join("index.html").exists() {
        return dev;
    }
    std::env::current_dir()
        .unwrap_or_default()
        .join("dist")
        .join("client")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !ensure_single_instance() {
        // 已有实例在运行：新实例直接退出，避免多窗口叠加/闪烁
        return;
    }
    // 加载持久化设置（开机自启 / 充电弹窗开关），供轮询线程与命令读取
    load_prefs();
    // 开机自启默认开启：确保注册表 Run 键存在（幂等；用户关闭后不再写入）
    if AUTO_START_EN.load(Ordering::Relaxed) {
        let _ = set_autostart_registry(true);
    }
    tauri::Builder::default()
        // 磁盘资源协议：生产模式前端资源从磁盘读取（dist/client 随安装包分发）
        .register_uri_scheme_protocol("app", |_ctx, request| {
            let raw = request.uri().path();
            // 剥掉 query string（如 index.html?popup=1），避免按带 query 的文件名读盘导致 404
            let raw = raw.split('?').next().unwrap_or(raw);
            let mut path = raw.trim_start_matches('/');
            if path.is_empty() {
                path = "index.html";
            }
            let base = dist_base();
            let file = base.join(path);
            // DLP 透明加密：非白名单进程（本程序）读取 .js 会拿到密文（+4096 字节头），
            // WebView2 解析密文即 SyntaxError → 界面空白。构建时已为 assets/*.js 生成
            // 同名 *.jsd 明文副本（DLP 不加密 .jsd 扩展名），此处 .js 请求优先读 .jsd。
            let data = if path.ends_with(".js") {
                let jsd = file.with_extension("jsd");
                let d = std::fs::read(&jsd);
                if d.is_ok() {
                    d
                } else {
                    std::fs::read(&file)
                }
            } else {
                std::fs::read(&file)
            };
            match data {
                Ok(data) => tauri::http::Response::builder()
                    .header("Content-Type", asset_mime(path))
                    .body(data)
                    .unwrap_or_else(|_| {
                        tauri::http::Response::builder()
                            .status(500)
                            .body(Vec::new())
                            .unwrap()
                    }),
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain")
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .setup(|app| {
            let app = app.handle().clone();
            // 兜底：窗口初始隐藏（见 tauri.conf visible:false），4 秒后无论前端是否就绪都强制显示，
            // 避免渲染失败导致窗口永久隐藏；正常路径由前端 invoke show_main_after_ready 提前显示。
            {
                let app2 = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(4));
                    if let Some(win) = app2.get_webview_window("main") {
                        let _ = win.show();
                    }
                });
            }
            // 多设备托盘：每在线设备一个独立图标（设备剪影+各自电量竖条）；
            // 无设备时保留一个兜底入口图标。图标随设备上下线动态增删。
            let size = tray::tray_icon_size();
            let dark = tray::is_dark_mode();
            let app_init = app.clone();

            // 挂到托盘图标上的通用菜单与左键行为
            fn tray_menu_and_click(
                builder: tauri::tray::TrayIconBuilder<tauri::Wry>,
                menu: tauri::menu::Menu<tauri::Wry>,
            ) -> tauri::tray::TrayIconBuilder<tauri::Wry> {
                builder
                    // 必须挂载 menu，右键才会弹出托盘菜单
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window(tray.app_handle());
                        }
                    })
            }

            // 后台轮询：每 5 秒读设备电量 → 增删/更新各托盘图标；
            // 同时检测充电插入（charging false→true 跳变）→ 立即弹充电提醒（不等前端 5 分钟轮询）
            std::thread::spawn(move || {
                use std::collections::HashMap;
                use std::io::Write;
                let mut trays: HashMap<String, (String, tauri::tray::TrayIcon)> = HashMap::new();
                let mut fallback_on: bool = false;
                // 全局充电状态检测：插拔充电线会导致 HID 设备 path 变化（007C↔007D），
                // 不能依赖 per-path 记录；用"全局是否有设备在充电"的跳变检测（第一轮只记录不弹）
                let mut prev_any_charging: Option<bool> = None;
                let rust_log = std::env::temp_dir().join("battery-view-debug.log");
                let log_line = |msg: String| {
                    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&rust_log) {
                        let _ = writeln!(f, "{}", msg);
                    }
                };
                loop {
                    match hid::list_razer_devices() {
                        Ok(devices) => {
                            let mut states: Vec<(hid::RazerHidDevice, Option<u8>, bool)> = Vec::new();
                            for dev in &devices {
                                let (level, charging) =
                                    hid::read_battery(&dev.path, dev.feature_len).unwrap_or((None, false));
                                log_line(format!("poll path={} pid={:04X} level={:?} charging={}", dev.path, dev.product_id, level, charging));
                                states.push((dev.clone(), level, charging));
                            }
                            let any_charging = states.iter().any(|(_, _, c)| *c);
                            log_line(format!("any_charging={} prev={:?}", any_charging, prev_any_charging));
                            // 充电插入跳变：从无充电变为有充电 → 弹窗（受"充电提醒"开关控制）
                            if prev_any_charging == Some(false)
                                && any_charging
                                && POPUP_CHARGING_EN.load(Ordering::Relaxed)
                            {
                                if let Some((dev, level, _)) = states.iter().find(|(_, _, c)| *c) {
                                    log_line(">>> CHARGING JUMP DETECTED".to_string());
                                    let kind = kind_for_pid(dev.product_id);
                                    // 信息行：状态 + 预计充满时间（按约 1%/min 充电速率粗估）
                                    let sub = match level {
                                        Some(l) => {
                                            let tte = (100i32.saturating_sub(*l as i32)).clamp(1, 90);
                                            format!("充电中 · 约 {} 分钟充满", tte)
                                        }
                                        None => "充电中".to_string(),
                                    };
                                    let payload = format!(
                                        r#"{{"kind":"charging","sticky":false,"title":"开始充电","devices":[{{"kind":"{}","name":"{}","level":{},"charging":true,"sub":"{}"}}]}}"#,
                                        kind,
                                        pid_name(dev.product_id),
                                        level.map(|l| l.to_string()).unwrap_or_else(|| "-1".into()),
                                        sub,
                                    );
                                    let h = 65; // 单条：卡片全铺，行 45 + 上下内边距 10×2
                                    let r = show_popup(app_init.clone(), payload, h);
                                    log_line(format!("show_popup result: {:?}", r));
                                }
                            }
                            prev_any_charging = Some(any_charging);
                            if states.is_empty() {
                                // 无设备：清掉设备图标，保留兜底入口
                                for k in trays.keys().cloned().collect::<Vec<_>>() {
                                    if k != "__fallback__" {
                                        let _ = app_init.remove_tray_by_id(&trays[&k].0);
                                    }
                                }
                                trays.retain(|k, _| k == "__fallback__");
                                if !fallback_on {
                                    let icon = tray::render_tray_icon(None, false, "mouse", dark, size);
                                    let menu = match build_tray_menu(&app_init, &[]) {
                                        Ok(m) => m,
                                        Err(e) => {
                                            eprintln!("[tray] menu build failed: {e}");
                                            TrayIconBuilder::with_id("tray-fallback")
                                                .icon(icon.clone())
                                                .build(&app_init)
                                                .map(|t| trays.insert("__fallback__".into(), ("tray-fallback".into(), t)))
                                                .ok();
                                            continue;
                                        }
                                    };
                                    if let Ok(t) = tray_menu_and_click(
                                        TrayIconBuilder::with_id("tray-fallback")
                                            .icon(icon)
                                            .tooltip("外设电量坞 · 未检测到设备"),
                                        menu,
                                    )
                                    .build(&app_init)
                                    {
                                        trays.insert("__fallback__".into(), ("tray-fallback".into(), t));
                                        fallback_on = true;
                                    }
                                } else if let Some((_, t)) = trays.get("__fallback__") {
                                    let icon = tray::render_tray_icon(None, false, "mouse", dark, size);
                                    let _ = t.set_icon(Some(icon));
                                    let _ = t.set_tooltip(Some("外设电量坞 · 未检测到设备"));
                                }
                            } else {
                                // 有设备：移除兜底
                                if fallback_on {
                                    let _ = app_init.remove_tray_by_id("tray-fallback");
                                    trays.remove("__fallback__");
                                    fallback_on = false;
                                }
                                // 按设备 path 稳定排序，id 用索引（路径含特殊字符不能做 id）
                                states.sort_by(|a, b| a.0.path.cmp(&b.0.path));
                                // 所有设备托盘图标共享同一菜单（含全部设备行 + 调试入口）
                                let menu = match build_tray_menu(&app_init, &states) {
                                    Ok(m) => m,
                                    Err(e) => {
                                        eprintln!("[tray] menu build failed: {e}");
                                        continue;
                                    }
                                };
                                for (i, (dev, level, charging)) in states.iter().enumerate() {
                                    let id = format!("tray-{}", i);
                                    let kind = kind_for_pid(dev.product_id);
                                    let icon = tray::render_tray_icon(*level, *charging, kind, dark, size);
                                    let pct = level.map(|l| format!("{l}%")).unwrap_or_else(|| "--".into());
                                    let tip = format!(
                                        "{} · {}{}",
                                        pid_name(dev.product_id),
                                        pct,
                                        if *charging { " · 充电中" } else { "" }
                                    );
                                    match trays.get(&dev.path) {
                                        Some((_, t)) => {
                                            let _ = t.set_icon(Some(icon));
                                            let _ = t.set_tooltip(Some(&tip));
                                        }
                                        None => {
                                            if let Ok(t) = tray_menu_and_click(
                                                TrayIconBuilder::with_id(&id).icon(icon).tooltip(tip.as_str()),
                                                menu.clone(),
                                            )
                                            .build(&app_init)
                                            {
                                                trays.insert(dev.path.clone(), (id, t));
                                            }
                                        }
                                    }
                                }
                                // 移除已掉线设备的图标
                                for k in trays.keys().filter(|k| *k != "__fallback__").cloned().collect::<Vec<_>>() {
                                    if !states.iter().any(|(d, _, _)| d.path == k) {
                                        let (id, _) = &trays[&k];
                                        let _ = app_init.remove_tray_by_id(id.as_str());
                                        trays.remove(&k);
                                    }
                                }
                            }
                        }
                        Err(_) => {}
                    }
                    std::thread::sleep(Duration::from_secs(5));
                }
            });
            // 弹窗专用窗口（隐藏常驻，需要时显示；无边框/透明/置顶/不占任务栏）
            {
                use tauri::WebviewUrl;
                match tauri::WebviewWindowBuilder::new(
                    &app,
                    "popup",
                    WebviewUrl::App("index.html".into()),
                )
                .title("BatteryView Popup")
                .decorations(false)
                // 终极方案：不透明窗口 + 系统级 DWM 圆角 + 卡片全铺。
                // 透明窗口在 Windows 上必现矩形边缘伪影（外框），彻底放弃透明；
                // DWM 圆角由系统裁剪窗口四角（Win11 系 build≥22000 生效），无残影
                .transparent(false)
                .shadow(false)
                .always_on_top(true)
                .resizable(false)
                .skip_taskbar(true)
                .visible(false)
                .focused(false)
                .build()
                {
                    Ok(win) => {
                        eprintln!("[popup] window created ok");
                        #[cfg(target_os = "windows")]
                        {
                            // DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE=33, DWMWCP_ROUND=2)
                            #[allow(non_snake_case)]
                            unsafe extern "system" {
                                fn DwmSetWindowAttribute(
                                    hwnd: isize,
                                    attr: u32,
                                    data: *const core::ffi::c_void,
                                    size: u32,
                                ) -> i32;
                            }
                            if let Ok(hwnd) = win.hwnd() {
                                let pref: i32 = 2; // DWMWCP_ROUND
                                unsafe {
                                    let _ = DwmSetWindowAttribute(
                                        hwnd.0 as isize,
                                        33,
                                        &pref as *const i32 as *const core::ffi::c_void,
                                        core::mem::size_of::<i32>() as u32,
                                    );
                                }
                            }
                        }
                    }
                    Err(e) => eprintln!("[popup] window build FAILED: {:?}", e),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_background,
            load_background,
            remove_background,
            list_hid_devices,
            read_battery_level,
            read_low_battery_threshold,
            show_main_after_ready,
            show_popup,
            close_popup,
            get_auto_start,
            set_auto_start,
            get_popup_charging,
            set_popup_charging
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// DLP rebuild marker: force crate recompile after OUT rewrite


// DLP rebuild marker 2: trend v2 rebuild


// DLP rebuild marker 3: trend v2 final


// DLP rebuild marker 4: trend v2 needMore fix


// DLP rebuild marker 5: trend v2 num rounding


// DLP rebuild marker 6: post-cli-build fix


// DLP rebuild marker 7: scroll-padding + color-link + predict-gap + dynamic device name


// DLP rebuild marker 8: image.tsx remove default gray-gradient bg


// DLP rebuild marker 9: responsive fixes (img max-h + translateZ(0) glass patch)


// DLP rebuild marker 10: bottom spacer for scroll-padding eaten in flex scroll container


// DLP rebuild marker 11: spacer-based bottom gap (pb removed, h-16 spacer)

// DLP rebuild marker 12: enlarge bottom spacer to h-24

// DLP rebuild marker 13: main scroll container flex-col -> block (scrollHeight calc bug)

// DLP rebuild marker 14: system tray (tiny-skia render + poll + menu)
// DLP rebuild marker 15: fresh dist/client rebuild (69 assets, full UI snapshot)
// DLP rebuild marker 16: rewrite OUT (e1678) to plaintext + recompile
// DLP rebuild marker 17: disk-asset protocol (app:// scheme) to bypass embedded-asset corruption



