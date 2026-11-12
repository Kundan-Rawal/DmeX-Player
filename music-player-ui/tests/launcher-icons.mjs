import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 410 } });
  await page.setContent('<body style="margin:0;background:#e8edf3;font:16px Arial;color:#17263c"><div id="previews" style="display:flex;gap:40px;padding:28px"></div></body>');
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const layer of ['foreground', 'monochrome']) {
      const bytes = await readFile(new URL(`../src-tauri/gen/android/app/src/main/res/mipmap-${density}/ic_launcher_${layer}.png`, import.meta.url));
      const inset = await readFile(new URL(`../src-tauri/gen/android/app/src/main/res/drawable/ic_launcher_${layer}_inset.xml`, import.meta.url), 'utf8');
      const result = await page.evaluate(async ({ url, inset, preview }) => {
        const image = new Image(); image.src = url; await image.decode();
        const size = image.naturalWidth, center = size / 2, radius = size * 33 / 108;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        const xml = new DOMParser().parseFromString(inset, 'application/xml');
        const amount = edge => {
          const value = xml.documentElement.getAttributeNS('http://schemas.android.com/apk/res/android', 'inset' + edge);
          if (!value?.endsWith('%')) throw new Error('Expected percentage inset');
          return parseFloat(value) / 100 * size;
        };
        const left = amount('Left'), top = amount('Top'), right = amount('Right'), bottom = amount('Bottom');
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, left, top, size - left - right, size - top - bottom);
        const pixels = ctx.getImageData(0, 0, size, size).data;
        let visible = 0, clipped = 0, maxRadius = 0;
        for (let y = 0; y < size; ++y) for (let x = 0; x < size; ++x) {
          if (pixels[(y * size + x) * 4 + 3] < 64) continue;
          ++visible;
          const distance = Math.hypot(x + .5 - center, y + .5 - center);
          maxRadius = Math.max(maxRadius, distance);
          if (distance > radius) ++clipped;
        }
        if (preview) for (const shape of ['Circle', 'Squircle']) {
          const item = document.createElement('div'), target = document.createElement('canvas');
          target.width = target.height = 280; const out = target.getContext('2d');
          out.beginPath();
          if (shape === 'Circle') out.arc(140, 140, 140, 0, Math.PI * 2);
          else out.roundRect(0, 0, 280, 280, 72);
          out.clip(); out.fillStyle = '#f4f7fc'; out.fillRect(0, 0, 280, 280);
          // Android masks the central 72 dp viewport of its 108 dp layers.
          const viewport = size * 72 / 108, offset = (size - viewport) / 2;
          out.drawImage(canvas, offset, offset, viewport, viewport, 0, 0, 280, 280);
          item.append(target); const label = document.createElement('p'); label.textContent = shape;
          label.style.textAlign = 'center'; item.append(label); document.querySelector('#previews').append(item);
        }
        return { size, visible, clipped, radiusDp: maxRadius / size * 108 };
      }, { url: 'data:image/png;base64,' + bytes.toString('base64'), inset, preview: density === 'xxxhdpi' && layer === 'foreground' });
      console.log(`${density} ${layer}: radius ${result.radiusDp.toFixed(2)} dp; outside safe zone ${result.clipped}/${result.visible}`);
      assert.ok(result.visible > 0, 'Launcher artwork must not be blank');
      assert.equal(result.clipped, 0, `${density} ${layer} must fit Android's 66 dp safe circle`);
    }
  }
  await page.screenshot({ path: 'tests/artifacts/launcher-mask-previews.png' });
  console.log('PASS launcher safe zones and circle/squircle previews across all densities');
} finally { await browser.close(); }
