import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(tag ?? '')) {
  throw new Error('Usage: node scripts/sync-git-bundle.mjs <version-tag>');
}
execFileSync(process.execPath, [join(root, 'scripts/deploy-github-release.mjs'), tag, '--verify-only'], {
  cwd: root, stdio: 'inherit',
});

const archive = join(root, '.release', 'assets', tag, `voicemesh-dsh-voice-${tag.slice(1)}.tgz`);
const temporary = await mkdtemp(join(tmpdir(), 'voicemesh-git-bundle-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', temporary]);
  const built = join(temporary, 'package');
  const manifest = JSON.parse(await readFile(join(built, 'package.json'), 'utf8'));
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (source.name !== manifest.name || source.version !== manifest.version) {
    throw new Error('Source and release package names or versions differ');
  }

  await rm(join(root, 'lib'), { recursive: true, force: true });
  await cp(join(built, 'lib/index.js'), join(root, 'lib/index.js'));
  await cp(join(built, 'lib/client.js'), join(root, 'lib/client.js'));
  const host = join(built, 'node_modules/@deepseek-ai/dsh-voice-host/lib');
  await cp(join(host, 'index.js'), join(root, 'lib/host.js'));
  await cp(join(host, 'local-runtime'), join(root, 'lib/local-runtime'), { recursive: true });
  for (const entry of ['cordis.patch.yml', 'provenance.json', 'NOTICE', 'THIRD_PARTY_LICENSES']) {
    await cp(join(built, entry), join(root, entry));
  }
  await cp(join(built, 'locale'), join(root, 'locale'), { recursive: true, force: true });

  source.files = manifest.files;
  source.exports = manifest.exports;
  source.dsh = manifest.dsh;
  await writeFile(join(root, 'package.json'), JSON.stringify(source, null, 2) + '\n');
  console.log(`Git installation bundle synchronized from ${tag}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
