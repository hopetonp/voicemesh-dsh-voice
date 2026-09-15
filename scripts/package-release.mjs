import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Provide the built Harness checkout path.');
const harness = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, '.release', 'package-' + Date.now());
const modules = join(output, 'node_modules');
await mkdir(modules, { recursive: true });
const components = [
  ['@deepseek-ai/dsh-voice-host', 'packages/host/voice-host'],
  ['@deepseek-ai/dsh-voice-client', 'packages/client/voice-client'],
];
execFileSync('pnpm', ['exec', 'tsdown'], { cwd: join(harness, 'packages/client/voice-client'), stdio: 'inherit' });
const { build } = await import(pathToFileURL(join(harness, 'node_modules/tsdown/dist/index.mjs')).href);
const provenance = [];
for (const [name, relative] of components) {
  const source = join(harness, relative), target = join(modules, name);
  const original = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  await mkdir(join(target, 'lib'), { recursive: true });
  if (name.endsWith('-host')) {
    await build({
      config: false, entry: { index: join(source, 'lib/index.js') },
      outDir: join(target, 'lib'), format: ['esm'], platform: 'node', target: 'es2024',
      fixedExtension: false, dts: false, clean: false, sourcemap: false,
      deps: { neverBundle: /^@deepseek-ai\//, alwaysBundle: /^(?!@deepseek-ai\/|node:)/ },
    });
  } else {
    for (const file of ['index.js', 'client.js']) {
      const content = (await readFile(join(source, 'lib', file), 'utf8')).replace(/^\/\/[#@] sourceMappingURL=.*$/gm, '');
      await writeFile(join(target, 'lib', file), content);
    }
  }
  if (name.endsWith('-host')) {
    const runtime = join(target, 'lib/local-runtime');
    await mkdir(runtime, { recursive: true });
    for (const entry of ['worker.mjs', 'package.json', 'package-lock.json', 'scripts']) {
      await cp(join(harness, 'plugins/voice/local-runtime', entry), join(runtime, entry), { recursive: true });
    }
  }
  const hostCode = await readFile(join(target, 'lib/index.js'), 'utf8');
  const imports = [...hostCode.matchAll(/from\s+['"](@deepseek-ai\/[^'"]+)['"]|import\s+['"](@deepseek-ai\/[^'"]+)['"]/g)]
    .map(match => (match[1] ?? match[2]).split('/').slice(0, 2).join('/'));
  const peers = Object.fromEntries([...new Set(imports)].map(name => [name, '*']));
  const child = {
    name, version: manifest.version, private: true, type: 'module', main: 'lib/index.js',
    exports: { '.': './lib/index.js', './package.json': './package.json',
      ...(name.endsWith('-client') ? { './client': './lib/client.js' } : {}) },
    ...(original.dsh ? { dsh: original.dsh } : {}),
    peerDependencies: peers,
    peerDependenciesMeta: Object.fromEntries(Object.keys(peers).map(name => [name, { optional: true }])),
  };
  await writeFile(join(target, 'package.json'), JSON.stringify(child, null, 2) + '\n');
  provenance.push({ name, sourceVersion: original.version, hostSha256: createHash('sha256').update(hostCode).digest('hex') });
}
const packaged = {
  name: manifest.name, version: manifest.version, private: true, type: 'module',
  description: manifest.description, author: manifest.author, repository: manifest.repository,
  engines: manifest.engines, files: ['cordis.patch.yml', 'provenance.json', 'README.md', 'LICENSE'],
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  dependencies: Object.fromEntries(components.map(([name]) => [name, manifest.version])),
  bundledDependencies: components.map(([name]) => name),
};
await writeFile(join(output, 'package.json'), JSON.stringify(packaged, null, 2) + '\n');
await writeFile(join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
await cp(join(root, 'LICENSE'), join(output, 'LICENSE'));
await writeFile(join(output, 'README.md'), '# VoiceMesh Harness plugin — private validation artifact\n\nNot approved for public distribution. Composer license and third-party notices remain pending.\n');
await writeFile(join(output, 'cordis.patch.yml'), `# Connection RPC registration accesses webServer on its owning context.
- id: connection
  inject: [webRuntime, webServer]
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
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: output, encoding: 'utf8' }));
const artifact = join(output, packed[0].filename);
await writeFile(join(root, '.release/latest-artifact.json'), JSON.stringify({ artifact, output }, null, 2) + '\n');
console.log('Private validation artifact: ' + artifact);
