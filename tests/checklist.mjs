// Extra checklist items not covered by e2e.mjs / e2e-auto.mjs
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'tests', 'out-check');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok === null ? 'MANUAL' : ok ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? '  — ' + detail : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 1. the shareable zip itself
const REL = path.join(OUT, 'release');
execSync(`unzip -q ${path.join(ROOT, "dist", "lazyform-extension.zip")} -d ${REL}`);
const files = execSync(`cd ${REL} && find . -type f | sort`).toString().trim().split('\n');
const mf = JSON.parse(fs.readFileSync(path.join(REL, 'manifest.json')));
check('P1', 'Zip contains only extension files (no tests, keys, dotfiles)', !files.some((f) => /test|fixture|\.git|\.env|\.pem|node_modules|\.DS_Store/.test(f)), `${files.length} files`);
check('P2', 'Manifest V3, version set, no test flag, no always-on host access', mf.manifest_version === 3 && mf.version === '1.1.0' && !mf.version_name && !mf.host_permissions && !mf.content_scripts);
check('P3', 'All icon sizes present', ['16', '32', '48', '128'].every((s) => fs.existsSync(path.join(REL, mf.icons[s]))));
const src = files.filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(REL, f), 'utf8')).join('\n');
check('S1', 'No remote code / eval / new Function', !/\beval\(|new Function\(|importScripts\(\s*['"]http/.test(src));
check('S2', 'No network calls except reading the stored resume (data: URL)', (src.match(/fetch\(/g) || []).length === 1 && /fetch\(resume\.dataUrl\)/.test(src) && !/XMLHttpRequest|sendBeacon|WebSocket\(/.test(src));
check('S3', 'No externally_connectable / web_accessible_resources (websites can’t talk to it)', !mf.externally_connectable && !mf.web_accessible_resources);
const htmlFiles = files.filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(path.join(REL, f), 'utf8')).join('');
check('S4', 'No inline scripts or remote assets in extension pages', !/<script(?![^>]*src=)[^>]*>|\son\w+=["']|https?:\/\//.test(htmlFiles.replace(/<!doctype[^>]*>/i, '')));
check('S5', 'Every shadow root used for LazyForm UI is closed', !/attachShadow\(\{\s*mode:\s*'open'/.test(src));
check('S6', 'Banner buttons only react to real (trusted) clicks', /e\.isTrusted/.test(src));

