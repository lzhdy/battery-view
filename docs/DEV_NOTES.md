# BatteryView 开发踩坑记录

> 面向维护者的经验记录（不含任何公司内部信息 / 敏感配置）。

## 构建流程（必须遵守）

- **不要直接 `npx vite build`**：产物嵌套在 `dist/client/client/`，index.html 没 flatten 导致旧版一直在跑。
- **正确命令**：`node src-tauri/scripts/build-desktop.mjs`（清空 dist → vite build → flatten index.html → sanitize 占位符）。
- **vite 缓存会导致改了代码 hash 不变**：改源码后如果 js hash 没变，删 `client/node_modules/.vite` 和 `dist/client` 重 build。
- **build-desktop.mjs 中途失败会留下半成品 dist**：vite build 报错后不要继续，重跑完整 build-desktop.mjs。

## Tauri 2.0 托盘/弹窗

- **WebviewUrl::App("index.html?popup=1") 会 404**：`?` 被编码进 path，按带 query 的文件名读盘失败。改用窗口 label 区分（"popup"），URL 只写 "index.html"。
- **uri().path() 处理**：自定义 scheme 里读文件前要 `split('?').next()` 剥 query（双保险）。
- **不要 import @tauri-apps/api/window 等包**：vite build 会 externalize 报错。改用全局 `window.__TAURI__`。
- **mon.work_size() 不存在**：用 `mon.size()`。
- **WebView2 启动黑框**：窗口初始 visible(false)，React 挂载后 invoke show_main_after_ready 显示。
- **弹窗 eval 时序坑**：Rust show_popup 里 eval 时 popup 窗口的 React 可能还没挂载完。必须三重保险：① eval 先写 window.__popupPayload=<JSON> ② dispatchEvent(new CustomEvent('app:popup',{detail:<JSON>})) ③ 再调 __showPopup。PopupPage useEffect 挂载时先读 __popupPayload 缓存，再监听 app:popup 事件，再保留 __showPopup 直接调用方式。
- **GUI 子系统看不到 eprintln**：调试弹窗逻辑要写文件日志，不要靠 eprintln!。

## 前端崩溃

- **`Cannot read properties of undefined (reading 'at')`**：estimateTrend 里 segment 可能为空数组（最新历史记录 charging 状态和当前不一致时），`last = segment[last]` 是 undefined 后面 `.at` 崩。加 segment.length===0 防御。
- **localStorage 数据脏**：loadReadings 要 sanitize 过滤无效项（非对象/无 at/无 deviceId）。
- **任何数组操作前先防御 filter**：filter Boolean + typeof at === 'number'，别信上游数据干净。

## HID / Razer

- 插线充电时 HID 枚举节点仍是接收器（0x007D），Razer 协议不直接报连接方式。charging=true ⇒ 显示"有线"。
- log crate 不在依赖，调试用 eprintln!。

## 弹窗透明边框/四角缺口（2026-10-30 定稿）

- **透明窗口四角缺口根因**：Tauri 透明窗口是矩形，CSS 圆角卡片在四角铺不满窗口 → 深色桌面透出"黑边/缺口"。这是几何问题，CSS 单独无法消除。
- **走过的弯路（勿重复）**：CSS 阴影弧线/半透明残留形成"套娃感"（去阴影、背景 0.94~0.98）；`.shadow(true)` 在 layered 窗口不绘制圆角还引入黑边（弃用）；DWM 手动圆角 `DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE=33, DWMWCP_ROUND=2)` 为最终妥协方案。
- **最终方案**：窗口 320×60（单条），卡片圆角 8px 铺满窗口；PopupPage 挂载时强制 html/body/#root margin0/padding0/background transparent/overflow hidden；多设备高度 `n*60 + (n-1)*6`。
- **windows-sys 0.61**：`HWND` 是 `type HWND = isize`；`DwmSetWindowAttribute` 需 feature `Win32_Graphics_Dwm`。
- **充电跳变检测**：插拔充电线会让 HID 枚举 path 在 007C↔007D 间变化 → 用全局充电状态（`prev_any_charging: Option<bool>`，第一轮只记录不弹；false→true 跳变才弹）。

## 托盘 Lucide 剪影

- **素材**：Lucide（lucide.dev，ISC 开源）官网 Download PNG 导出 8 个设备图标（256×256，Stroke width=3px、Size=256px、Non-scaling stroke 不勾）。源文件存 `assets/lucide/`，Rust 嵌入副本在 `src-tauri/src/assets/lucide/`。
- **渲染管线**（tray.rs `draw_lucide_icon`）：`include_bytes!` PNG → `image::load_from_memory` 解码 RGBA → 按前景色重染（alpha>0 像素 RGB 置为 fg）→ CatmullRom 缩放 68% → 自写 `blit_pixmap` 逐像素 alpha-over（不依赖 tiny-skia draw_pixmap 版本签名）。
- **坑**：`image = { default-features = false }` 导致 PNG 解码失败 → 图标空白；必须加 `features = ["png"]`（0.25 无 "std" feature 名，勿加）。
- 前端主界面 8 张萌系插画大图与托盘 Lucide 剪影是两套素材，勿混淆。
