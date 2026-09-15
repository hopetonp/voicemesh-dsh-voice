import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Provide the built Harness checkout path.');
const harness = await realpath(process.argv[2]);
const stage = join(root, '.release', 'staging-' + Date.now());
await mkdir(stage, { recursive: true });
const components = [
  ['client', join(harness, 'packages/client/voice-client')],
  ['host', join(harness, 'packages/host/voice-host')],
  ['harness-policy', join(harness, 'plugins/voice/harness-policy')],
  ['composer', await realpath(join(harness, 'packages/host/voice-host/node_modules/@voicemesh/composer'))],
];
const provenance = [];
for (const [label, source] of components) {
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const target = join(stage, 'components', label);
  await mkdir(target, { recursive: true });
  const entries = label === 'client' ? ['lib/index.js', 'lib/client.js']
    : label === 'composer' ? ['lib/index.js', 'lib/server.js', 'lib/browser.js', 'lib/pipeline.js']
    : ['lib/index.js'];
  for (const entry of entries) await readFile(join(source, entry));
  const hashes = {};
  async function copyRuntime(from, to) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (entry.name.endsWith('.map') || entry.name.endsWith('.tsbuildinfo')) continue;
      const input = join(from, entry.name), output = join(to, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected runtime symlink: ' + input);
      if (entry.isDirectory()) { await copyRuntime(input, output); continue; }
      if (!/\.(?:js|cjs|mjs|json|wasm)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) continue;
      let bytes = await readFile(input);
      if (/\.(?:js|cjs|mjs)$/.test(entry.name)) {
        bytes = Buffer.from(bytes.toString().replace(/^\/\/[#@] sourceMappingURL=.*$/gm, ''));
      }
      await writeFile(output, bytes);
      hashes[output.slice(target.length + 1)] = createHash('sha256').update(bytes).digest('hex');
    }
  }
  // Client output is a single loader factory; exclude obsolete chunks from earlier builds.
  if (label === 'client') {
    await mkdir(join(target, 'lib'));
    for (const entry of entries) {
      const bytes = Buffer.from((await readFile(join(source, entry), 'utf8')).replace(/^\/\/[#@] sourceMappingURL=.*$/gm, ''));
      await writeFile(join(target, entry), bytes);
      hashes[entry] = createHash('sha256').update(bytes).digest('hex');
    }
  } else await copyRuntime(join(source, 'lib'), join(target, 'lib'));
  const { scripts, devDependencies, repository, ...runtimeManifest } = manifest;
  runtimeManifest.private = true;
  if (runtimeManifest.exports) delete runtimeManifest.exports['./src/*'];
  await writeFile(join(target, 'package.json'), JSON.stringify(runtimeManifest, null, 2) + '\n');
  provenance.push({ component: label, package: manifest.name, version: manifest.version, hashes });
}
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));
await writeFile(join(stage, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
await writeFile(join(stage, 'cordis.patch.yml'), `# Draft: validate placement and existing voice rows before installation.
- insert:
    - id: voice-host
      name: '@deepseek-ai/dsh-voice-host'
      config:
        path: /api/voice/stt
        sttStreamPath: /api/voice/stt/stream
        sttWsPath: /api/voice/stt/ws
        ttsPath: /api/voice/tts
        healthPath: /api/voice/health
        lastOutputPath: /api/voice/last-output
        deepgramKey: DEEPGRAM_API_KEY
        maxBodyBytes: 33554432
    - id: voice-client
      name: '@deepseek-ai/dsh-voice-client'
`);
await writeFile(join(stage, 'NOT-READY-FOR-DISTRIBUTION.txt'), 'Staged runtime only. Dependency packaging, licensing, and clean installation are not validated.\n');
console.log('Staged runtime components: ' + stage);
