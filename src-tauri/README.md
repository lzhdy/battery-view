# 外设电量坞 · Tauri 桌面端

本目录是 Tauri 2 壳工程。前端源码仍在 `client/`，桌面端与妙搭 Web 预览共用同一份代码。

## 本地准备（一次性）

1. 安装 Rust：https://rustup.rs（Windows 用 rustup-init.exe 默认安装即可）
2. 系统依赖：
   - Windows 10/11：无需额外操作（WebView2 系统自带）
   - macOS / Linux：见 https://tauri.app/start/prerequisites/
3. 在项目根目录安装 Node 依赖：`npm i`

## 开发运行

```bash
npx @tauri-apps/cli@latest dev
```

会自动启动 vite 开发服务器（端口 8080），然后启动 1180×880 无边框桌面窗口。

## 打包发布

```bash
npx @tauri-apps/cli@latest build
```

构建前端经 `src-tauri/scripts/build-desktop.mjs` 完成（跨平台注入 NODE_ENV、自动清空旧产物并删除 sourcemap），产物在 `src-tauri/target/release/bundle/`（Windows 下为 NSIS 安装包与 MSI）。

## 图标

`icons/icon.png`（512）与 `icons/icon.ico` 为当前图标。若需覆盖全部平台（macOS `.icns` 等），可重新生成完整图标集：

```bash
npx @tauri-apps/cli@latest icon src-tauri/icons/icon.png
```

## 常见问题

- **8080 端口被占用**：修改 `tauri.conf.json` 的 `build.devUrl`，并在 dev 命令后加 `-- --port <端口>` 传给 vite
- **窗口按钮点击无效**：Web 页面里按钮为装饰态，属预期；桌面窗口内才生效（通过 `window.__TAURI__` 全局，`withGlobalTauri: true`）。若桌面内也无效，检查 `src-tauri/capabilities/default.json` 是否存在——Tauri 2 的窗口拖拽与控制命令均由该文件授权
- **localStorage**：桌面端沿用 WebView 的 localStorage，数据与浏览器互不相通
