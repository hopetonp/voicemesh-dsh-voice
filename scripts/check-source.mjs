import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let files = 0;
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['.git', '.release', 'node_modules', 'dist'].includes(item.name)) continue;
    const path = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error('Unexpected public source symlink: ' + path);
    if (item.isDirectory()) { await scan(path); continue; }
    if (item.name.endsWith('.map') || item.name.endsWith('.tgz') || item.name.startsWith('.env')) throw new Error('Forbidden public artifact: ' + path);
    const text = await readFile(path, 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) && !path.endsWith('check-source.mjs')) throw new Error('Private key found: ' + path);
    if (/from\s+['"][^'"]*voicemesh-composer\/src\//.test(text)) throw new Error('Private Composer source import: ' + path);
    files++;
  }
}
await scan(root);
console.log('Checked ' + files + ' files for forbidden artifacts and private source imports. This is not a full secret audit.');
