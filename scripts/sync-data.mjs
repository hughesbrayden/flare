// Copies the building model and sheet images from first-look/data/marlowe
// into the app so the static build is self-contained. Source files are only read.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const src = resolve(app, 'data/marlowe');
if (!existsSync(join(src, 'true_model.json'))) {
  console.log('Source data not found; keeping the bundled copy.');
  process.exit(0);
}
mkdirSync(join(app, 'src/data'), { recursive: true });
mkdirSync(join(app, 'public/sheets'), { recursive: true });
copyFileSync(join(src, 'true_model.json'), join(app, 'src/data/marlowe.json'));
for (const s of ['A-1', 'A-2', 'A-4', 'A-301']) {
  copyFileSync(join(src, 'sheets', `${s}.png`), join(app, 'public/sheets', `${s}.png`));
}
console.log('Synced model and sheets from', src);
