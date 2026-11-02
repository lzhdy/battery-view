import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../..');
const distDir = path.join(root, 'dist/client');

// DLP 全内联（本机特有方案，默认关闭）：仅当构建/运行环境装有 DLP（如绿盾，对 .js/.jsd
// 透明加密，非白名单进程读到密文 → WebView SyntaxError → 白屏）时，显式 DLP_INLINE=1
// 把全部 JS 合并为单 chunk 并内联进 index.html（HTML 明文通道），前端零 .js 文件读取。
// 未设置时保持常规多文件构建（manualChunks 代码分割）。
const dlpInline = process.env.DLP_INLINE === '1';

fs.rmSync(distDir, { recursive: true, force: true });

const viteBin = path.join(root, 'node_modules/vite/bin/vite.js');
const result = spawnSync(
  process.execPath,
  [viteBin, 'build', '--config', 'vite.config.ts'],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', DLP_INLINE: dlpInline ? '1' : '0' },
    stdio: 'inherit',
  }
);
if (result.status !== 0) process.exit(result.status ?? 1);

const stripMaps = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) stripMaps(full);
    else if (entry.name.endsWith('.map')) fs.rmSync(full);
  }
};
if (fs.existsSync(distDir)) stripMaps(distDir);

// DLP 明文副本（可选）：公司 DLP 对 .js 扩展名做透明加密，非白名单进程（battery-view.exe）
// 读取时得到密文（+4096B 头），WebView2 解析即 SyntaxError 导致界面空白。仅在显式开启
// DLP_JSD_MIRROR=1 时，为 assets/*.js 生成同名 *.jsd 明文副本（DLP 不加密 .jsd）；
// lib.rs 协议层对 .js 请求优先读同名 .jsd，不存在则回退 .js（无 DLP 环境行为不变）。
if (process.env.DLP_JSD_MIRROR === "1") {
  const jsdAssets = path.join(distDir, 'assets');
  if (fs.existsSync(jsdAssets)) {
    let n = 0;
    for (const entry of fs.readdirSync(jsdAssets, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        const src = path.join(jsdAssets, entry.name);
        const dst = src.slice(0, -3) + '.jsd';
        fs.copyFileSync(src, dst);
        n++;
      }
    }
    if (n > 0) console.log(`jsd mirror created (DLP_JSD_MIRROR=1): ${n} files`);
  }
}

// flatten: preset outputs <distDir>/client/index.html while assets sit at <distDir>/assets;
// move index.html up so frontendDist resolves both correctly.
const nested = path.join(distDir, 'client');
if (fs.existsSync(path.join(nested, 'index.html')) && !fs.existsSync(path.join(distDir, 'index.html'))) {
  fs.renameSync(path.join(nested, 'index.html'), path.join(distDir, 'index.html'));
  fs.rmSync(nested, { recursive: true, force: true });
  console.log('flattened index.html into dist/client');
}

// 桌面化：妙搭平台占位符（{{appName}} 等）在脱离平台后不会被注入，
// 原样保留会导致标题显示字面量、Router basename 无法匹配、__platform__ 解析失败。
// 此处统一替换为桌面环境的安全默认值。
const indexHtmlPath = path.join(distDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  let html = fs.readFileSync(indexHtmlPath, 'utf-8');
  const replacements = [
    ['{{{appAvatar}}}', '""'],
    ['{{{__platform__}}}', '{}'],
    ['{{appName}}', '外设电量坞'],
    ['{{appDescription}}', '2.4G 无线外设电量管理'],
    ['{{appId}}', ''],
    ['{{userId}}', ''],
    ['{{tenantId}}', ''],
    ['{{userName}}', ''],
    ['{{csrfToken}}', ''],
    ['{{environment}}', ''],
    ['{{basename}}', ''],
  ];
  let changed = 0;
  for (const [from, to] of replacements) {
    const escaped = from.replace(/[{}]/g, (m) => (m === '{' ? '\\{' : '\\}'));
    const re = new RegExp(escaped, 'g');
    const before = html;
    html = html.replace(re, to);
    if (html !== before) changed++;
  }

  // 双括号 avatar 占位符（og:image / icon）单独清洗
  html = html.replace(/{{appAvatar}}/g, '');

  // 修复 avatar 四引号：模板 `avatar: """{{appAvatar}}"""` 被替换成 `""""`（JS 语法错误）
  html = html.replace(/avatar:\s*""""/g, 'avatar: ""');

  // 删除外域监控脚本（slardar / tea / performance），桌面单机不需要且会 console warning
  html = html.replace(/<script>[\s\S]*?<\/script>/g, (m) => {
    if (/KSlardarWeb|slardarScript|teaScript|LogAnalyticsObject/.test(m)) return '';
    return m;
  });
  html = html.replace(/<script[^>]*src="https:\/\/[^"]*"[^>]*><\/script>/g, '');

  fs.writeFileSync(indexHtmlPath, html, 'utf-8');
  console.log(`sanitized index.html placeholders (${changed} kinds replaced)`);
}

// DLP 全内联：公司 DLP 对 .js 扩展名透明加密，非白名单进程（battery-view.exe 及其
// WebView）读任何 .js/.jsd 都得到密文 → SyntaxError → 白屏。此模式由 vite.config.ts
// 合并为单一入口 chunk，再把该 chunk 整体内联进 index.html：HTML 是明文通道，前端
// 零 .js 文件读取，从根上绕过 DLP 加密。默认关闭，仅 DLP_INLINE=1 时启用（本机特有）。
if (dlpInline) {
  let html = fs.readFileSync(indexHtmlPath, 'utf-8');
  // 移除 modulepreload 外链（内联后冗余，且其 .js 引用在 DLP 环境读取会出错）
  html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
  let inlined = 0;
  html = html.replace(/<script[^>]*type="module"[^>]*src="([^"]+\.js)"[^>]*><\/script>/g, (_m, src) => {
    const assetPath = path.join(distDir, src.replace(/^\//, ''));
    let code = fs.readFileSync(assetPath, 'utf-8');
    code = code.replace(/<\/script/gi, '<\\/script');
    inlined++;
    return `<script type="module">\n${code}\n</script>`;
  });
  if (inlined === 0) {
    console.error('DLP_INLINE=1: no module script found to inline; check vite output layout');
    process.exit(1);
  }
  fs.writeFileSync(indexHtmlPath, html, 'utf-8');
  console.log(`DLP_INLINE=1: inlined ${inlined} module script(s) into index.html`);
}

console.log(`desktop build done: ${distDir}`);
