// Web アプリのファイルを Capacitor の webDir（www/）へコピーする。
// ルート直下の Web 資産を「正」とし、ネイティブ用に複製する方式。
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const files = ['index.html', 'app.js', 'manifest.webmanifest', 'sw.js', 'icon.svg'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of files) {
  copyFileSync(join(root, f), join(out, f));
}
console.log(`Copied ${files.length} web assets to www/`);
