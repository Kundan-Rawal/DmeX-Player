import { cpSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ui = join(root, 'music-player-ui');
const cli = join(ui, 'node_modules/@tauri-apps/cli/tauri.js');
const generated = join(root, '.tools/branding-icons');
const desktop = join(root, '.tools/branding-desktop');
const androidOnly = process.argv.includes('--android-only');
function generate(input, output) {
  const result = spawnSync(process.execPath, [cli, 'icon', input, '--output', output], { cwd: ui, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Tauri icon generation failed');
}
generate(join(root, 'design/branding/icon-manifest.json'), generated);
if (!androidOnly) {
  // A light icon surface keeps the approved dark stem visible on OS taskbars.
  generate(join(generated, 'ios/AppIcon-512@2x.png'), desktop);
  const icons = join(ui, 'src-tauri/icons');
  mkdirSync(icons, { recursive: true });
  for (const file of readdirSync(desktop, { withFileTypes: true })) {
    if (file.isFile()) copyFileSync(join(desktop, file.name), join(icons, file.name));
  }
}
const android = join(ui, 'src-tauri/gen/android/app/src/main/res');
cpSync(join(generated, 'android'), android, { recursive: true });
// Tauri 2.10 does not apply android_fg_scale to adaptive layers.
// Keep the complete mark inside Android's 66 dp safe zone with runtime insets.
const manifest = JSON.parse(readFileSync(join(root, 'design/branding/icon-manifest.json'), 'utf8'));
const background = manifest.android_bg ? '@mipmap/ic_launcher_background' : '@color/ic_launcher_background';
mkdirSync(join(android, 'drawable'), { recursive: true });
for (const layer of ['foreground', 'monochrome']) {
  writeFileSync(join(android, `drawable/ic_launcher_${layer}_inset.xml`), `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@mipmap/ic_launcher_${layer}"
    android:insetLeft="20%" android:insetTop="20%"
    android:insetRight="20%" android:insetBottom="20%" />
`);
}
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@drawable/ic_launcher_foreground_inset"/>
  <background android:drawable="${background}"/>
  ${manifest.android_monochrome ? '<monochrome android:drawable="@drawable/ic_launcher_monochrome_inset"/>' : ''}
</adaptive-icon>
`;
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  writeFileSync(join(android, `mipmap-anydpi-v26/${name}.xml`), adaptive);
}
if (!androidOnly) {
  const web = join(ui, 'public/branding');
  mkdirSync(web, { recursive: true });
  copyFileSync(join(generated, '128x128@2x.png'), join(web, 'dmex-orbit-d.png'));
  copyFileSync(join(desktop, '32x32.png'), join(web, 'favicon-32.png'));
  copyFileSync(join(generated, 'ios/AppIcon-60x60@3x.png'), join(web, 'apple-touch-icon.png'));
}
console.log(androidOnly ? 'Updated Android launcher assets only.' : 'Updated desktop, Android and browser brand assets.');
