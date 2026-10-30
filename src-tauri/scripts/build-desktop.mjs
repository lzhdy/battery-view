import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../..');
const distDir = path.join(root, 'dist/client');

fs.rmSync(distDir, { recursive: true, force: true });

const viteBin = path.join(root, 'node_modules/vite/bin/vite.js');
const result = spawnSync(
  process.execPath,
  [viteBin, 'build', '--config', 'vite.config.ts'],
  { cwd: root, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' }
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

console.log(`desktop build done: ${distDir}`);
