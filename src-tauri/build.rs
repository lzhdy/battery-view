// 构建触发标记：修改本文件会强制 tauri-build 重新生成 OUT 资源（DLP 环境下用）
// v2: force rebuild of codegen assets
// v3: trend v2 rebuild
// v4: trend v2 needMore fix
// v5: trend v2 num rounding
// v6: scroll-padding + color-link + predict-gap + dynamic device name
// v7: image.tsx remove default gray-gradient bg
// v8: responsive fixes (img max-h + translateZ(0) glass patch)
// v9: bottom spacer for scroll-padding eaten in flex scroll container
// v10: spacer-based bottom gap (pb removed, h-16 spacer)
// v11: enlarge bottom spacer to h-24 (WebView2 eats ~half of spacer height)
// v12: switch main scroll container flex-col -> block (scrollHeight calc bug), mb-4 spacing
// v13: system tray (tiny-skia render + poll + menu)
// v14: rebuild after tray-icon feature added (OUT dir hash changed)
// v15: delete stale OUT dir, force rebuild (old frontend snapshot removed)
// v16: frontendDist=Url (app:// disk protocol) -> tauri-codegen assets must be EMPTY
fn main() {
    tauri_build::build()
}
