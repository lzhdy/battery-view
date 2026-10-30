//! 系统托盘图标：参考风格（设备描边剪影 + 右侧竖条电量）
//! - 透明底（RGBA 全透明画布，仅图形着色），直接叠加在真实任务栏上
//! - 深浅两套配色自动切换（注册表 SystemUsesLightTheme，深色任务栏=白剪影 / 浅色=深灰剪影）
//! - 超采样抗锯齿：8x 画布 tiny-skia 绘制 -> CatmullRom 缩到目标尺寸，边缘平滑无锯齿
//! - 电量用右侧竖条"高度 + 颜色"双编码，直观可读

use tiny_skia::{LineCap, Paint, Path, PathBuilder, Pixmap, Rect, Stroke, Transform};

// ── 电量配色（与前端 BatteryGauge / 电池分级完全一致）──
const CHARGING: (u8, u8, u8) = (59, 130, 246); // #3B82F6
const GREEN: (u8, u8, u8) = (34, 197, 94); // #22C55E >=50
const ORANGE: (u8, u8, u8) = (249, 115, 22); // #F97316 <50
const RED: (u8, u8, u8) = (239, 68, 68); // #EF4444 <20

fn level_color(battery: Option<u8>) -> (u8, u8, u8) {
    match battery {
        None => (139, 132, 160),
        Some(b) if b >= 50 => GREEN,
        Some(b) if b >= 20 => ORANGE,
        Some(_) => RED,
    }
}

/// 读注册表 DWORD 值（Windows API 直读，不 spawn reg.exe；subkey 不带根键前缀）
fn reg_query_dword(subkey: &str, value: &str) -> Option<u32> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let key: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
    let name: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let mut data: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    unsafe {
        let rc = RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut data as *mut u32 as *mut _,
            &mut size,
        );
        if rc == 0 {
            Some(data)
        } else {
            None
        }
    }
}

/// 任务栏深浅色检测：SystemUsesLightTheme（1=浅色/0=深色），失败回退 AppsUseLightTheme，再失败按浅色
pub fn is_dark_mode() -> bool {
    let key = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    match reg_query_dword(key, "SystemUsesLightTheme") {
        Some(1) => false,
        Some(0) => true,
        _ => match reg_query_dword(key, "AppsUseLightTheme") {
            Some(1) => false,
            Some(0) => true,
            _ => false,
        },
    }
}

/// DPI 自适应托盘图标尺寸：AppliedDPI 96→16px，120→24px，≥144→32px
pub fn tray_icon_size() -> u32 {
    let key = r"Control Panel\Desktop\WindowMetrics";
    match reg_query_dword(key, "AppliedDPI") {
        Some(96) => 16,
        Some(120) => 24,
        Some(_) => 32,
        None => 24,
    }
}

// ── 绘制辅助 ──
fn paint(c: (u8, u8, u8), a: u8) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(c.0, c.1, c.2, a);
    p.anti_alias = true;
    p
}

/// 圆角矩形路径（四段二次贝塞尔近似圆角）
fn rounded_rect(x0: f32, y0: f32, x1: f32, y1: f32, r: f32) -> Option<Path> {
    let r = r.min((x1 - x0) / 2.0).min((y1 - y0) / 2.0);
    let mut pb = PathBuilder::new();
    pb.move_to(x0 + r, y0);
    pb.line_to(x1 - r, y0);
    pb.quad_to(x1, y0, x1, y0 + r);
    pb.line_to(x1, y1 - r);
    pb.quad_to(x1, y1, x1 - r, y1);
    pb.line_to(x0 + r, y1);
    pb.quad_to(x0, y1, x0, y1 - r);
    pb.line_to(x0, y0 + r);
    pb.quad_to(x0, y0, x0 + r, y0);
    pb.close();
    pb.finish()
}

fn stroke_path(pm: &mut Pixmap, path: &Path, fg: (u8, u8, u8), a: u8, width: f32, round: bool) {
    let st = Stroke {
        width,
        line_cap: if round { LineCap::Round } else { LineCap::Butt },
        ..Default::default()
    };
    pm.stroke_path(path, &paint(fg, a), &st, Transform::identity(), None);
}

fn fill_rect(pm: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, c: (u8, u8, u8), a: u8) {
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    if let Some(r) = Rect::from_xywh(x, y, w, h) {
        pm.fill_rect(r, &paint(c, a), Transform::identity(), None);
    }
}

/// RGBA buffer → tiny-skia Pixmap（直接拷贝像素，无 PNG feature 的手动合成）
fn pixmap_from_rgba(rgba: &[u8], w: u32, h: u32) -> Option<Pixmap> {
    let mut pm = Pixmap::new(w, h)?;
    pm.data_mut().copy_from_slice(rgba);
    Some(pm)
}

/// 将 src（straight alpha RGBA）alpha-over 合成到 dst（tiny-skia premultiplied）的 (x, y) 处。
fn blit_pixmap(dst: &mut Pixmap, x: f32, y: f32, src: &Pixmap) {
    let (dw, dh) = (dst.width() as i32, dst.height() as i32);
    let (sw, sh) = (src.width() as i32, src.height() as i32);
    let x0 = x.round() as i32;
    let y0 = y.round() as i32;
    let d = dst.data_mut();
    let s = src.data();
    for j in 0..sh {
        let dy = y0 + j;
        if dy < 0 || dy >= dh {
            continue;
        }
        for i in 0..sw {
            let dx = x0 + i;
            if dx < 0 || dx >= dw {
                continue;
            }
            let si = ((j * sw + i) * 4) as usize;
            let di = ((dy * dw + dx) * 4) as usize;
            let sa = s[si + 3] as u32;
            if sa == 0 {
                continue;
            }
            let da = d[di + 3] as u32;
            // src 为 straight alpha，先转 premultiplied 再做标准 alpha-over
            let inv = 255 - sa;
            for c in 0..3 {
                let pr = (s[si + c] as u32 * sa) / 255;
                d[di + c] = (pr + (d[di + c] as u32 * inv) / 255) as u8;
            }
            d[di + 3] = (sa + (da * inv) / 255) as u8;
        }
    }
}

/// 绘制 Lucide 线条图标：内置 8 种 kind 的透明 PNG（24px 线条风源图渲染为 128px），
/// 重染为当前模式前景色（浅色托盘深灰 / 深色托盘白），缩放到画布后合成到左侧。
fn draw_lucide_icon(pm: &mut Pixmap, kind: &str, fg: (u8, u8, u8), sf: f32) {
    let png: &[u8] = match kind {
        "keyboard" => include_bytes!("assets/lucide/keyboard.png"),
        "headset" => include_bytes!("assets/lucide/headset.png"),
        "speaker" => include_bytes!("assets/lucide/speaker.png"),
        "gamepad" => include_bytes!("assets/lucide/gamepad.png"),
        "webcam" => include_bytes!("assets/lucide/webcam.png"),
        "microphone" => include_bytes!("assets/lucide/microphone.png"),
        "tablet" => include_bytes!("assets/lucide/tablet.png"),
        _ => include_bytes!("assets/lucide/mouse.png"),
    };
    let Ok(decoded) = image::load_from_memory(png) else { return };
    let rgba = decoded.to_rgba8();
    let (sw, sh) = (rgba.width(), rgba.height());
    // 重染：保留 alpha，颜色统一为前景色（深/浅模式自适应）
    let mut buf = rgba.to_vec();
    for px in buf.chunks_exact_mut(4) {
        if px[3] > 0 {
            px[0] = fg.0;
            px[1] = fg.1;
            px[2] = fg.2;
        }
    }
    // 目标尺寸：占画布约 68%（左侧），垂直居中；用 image crate CatmullRom 高质量缩放
    let dw = (sf * 0.68) as u32;
    let dh = (sf * 0.68) as u32;
    if dw < 2 || dh < 2 {
        return;
    }
    let Some(src) = image::RgbaImage::from_raw(sw, sh, buf) else { return };
    let small = image::imageops::resize(&src, dw, dh, image::imageops::FilterType::CatmullRom);
    if let Some(dev) = pixmap_from_rgba(small.as_raw(), dw, dh) {
        let x = sf * 0.01;
        let y = (sf - dh as f32) / 2.0;
        blit_pixmap(pm, x, y, &dev);
    }
}

/// 参考风格托盘图标：battery(0-100, None=未知) / charging / kind(mouse|keyboard|headset|gamepad) / dark / size
pub fn render_tray_icon(
    battery: Option<u8>,
    charging: bool,
    kind: &str,
    dark: bool,
    size: u32,
) -> tauri::image::Image<'_> {
    let ss = 8u32;
    let s = size * ss;
    let sf = s as f32;
    let mut pm = Pixmap::new(s, s).unwrap(); // 全透明
    let fg = if dark { (255u8, 255u8, 255u8) } else { (45u8, 42u8, 40u8) };
    let fa: u8 = if dark { 235 } else { 255 };
    let col = if charging { CHARGING } else { level_color(battery) };

    // ── 设备图标（Lucide 开源线条图标，占左侧约 62%；未知 kind 回退 mouse）──
    draw_lucide_icon(&mut pm, kind, fg, sf);

    // ── 右侧竖条电量（拉长、右移拉开空隙；边框 + 内部按电量高度填充，颜色随电量）──
    let bx0 = sf * 0.74;
    let bx1 = sf * 0.92;
    let by0 = sf * 0.06;
    let by1 = sf * 0.94;
    let bbw = (sf * 0.025).max(ss as f32);
    if let Some(p) = rounded_rect(bx0, by0, bx1, by1, sf * 0.04) {
        stroke_path(&mut pm, &p, fg, fa, bbw, false);
    }
    if battery.is_some() || charging {
        let frac = if charging { 1.0 } else { (battery.unwrap() as f32 / 100.0).max(0.06) };
        let inner_h = (by1 - by0 - 2.0 * bbw) * frac;
        let iy1 = by1 - bbw;
        let iy0 = iy1 - inner_h;
        fill_rect(&mut pm, bx0 + bbw, iy0, bx1 - bx0 - 2.0 * bbw, inner_h, col, 255);
    }

    // ── 缩放到目标尺寸（premultiplied -> straight alpha，再 CatmullRom 高质量缩放）──
    for px in pm.data_mut().chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a != 0 && a != 255 {
            px[0] = ((px[0] as u32 * 255 + a / 2) / a).min(255) as u8;
            px[1] = ((px[1] as u32 * 255 + a / 2) / a).min(255) as u8;
            px[2] = ((px[2] as u32 * 255 + a / 2) / a).min(255) as u8;
        }
    }
    let img = image::RgbaImage::from_raw(s, s, pm.data().to_vec()).unwrap();
    let small = image::imageops::resize(&img, size, size, image::imageops::FilterType::CatmullRom);
    tauri::image::Image::new_owned(small.into_raw(), size, size)
}
