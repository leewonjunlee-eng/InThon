import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('merged extension retains main shortcuts, version and all referenced assets', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '0.2.0');
  assert.deepEqual(Object.values(manifest.commands).map(item => item.suggested_key.default), ['Ctrl+Shift+K', 'Ctrl+Shift+Right', 'Ctrl+Shift+Left']);
  assert(Object.values(manifest.commands).every(item => item.suggested_key.mac.startsWith('MacCtrl+Shift+')));
  const paths = [manifest.background.service_worker, manifest.action.default_popup, manifest.action.default_icon,
    ...Object.values(manifest.icons), 'icons/pause.svg', 'offscreen.html', 'lib/auto-profiles.js', 'lib/page-context.js', 'lib/summary.js'];
  await Promise.all(paths.map(path => access(new URL(`../extension/${path}`, import.meta.url))));
  const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert(background.includes(`iconUrl: "${manifest.action.default_icon}"`));
});
