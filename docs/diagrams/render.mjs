// Renders every <canvas> in diagrams.html to docs/assets/<id>.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(here, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + path.join(here, 'diagrams.html'));
await page.waitForFunction(() => window.__ready);
const shots = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => [c.id, c.toDataURL('image/png')]));
for (const [id, url] of shots) fs.writeFileSync(path.join(out, id + '.png'), Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
console.log(shots.map(([id]) => id).join(' '));
