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
let clientDsh;
for (const [name, relative] of components) {
  const source = join(harness, relative), target = join(modules, name);
  const original = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  await mkdir(join(target, 'lib'), { recursive: true });
  if (name.endsWith('-host')) {
    await build({
      config: false, entry: { index: join(source, 'lib/index.js') },
      outDir: join(target, 'lib'), format: ['esm'], platform: 'node', target: 'es2024',
      fixedExtension: false, dts: false, clean: false, sourcemap: false,
      // A profile installs this archive outside the Harness runtime tree, so Node cannot
      // resolve Harness workspace packages from the nested host package. Bundle those
      // implementation helpers; the voice host uses the supplied Context structurally.
      deps: { alwaysBundle: /^(?!node:)/ },
    });
  } else {
    for (const file of ['index.js', 'client.js']) {
      const content = (await readFile(join(source, 'lib', file), 'utf8'))
        .replace(/^\/\/[@#] sourceMappingURL=.*$/gm, '')
        .replace(/^[ \t]*\/\/#region .*$(?:\r?\n)?|^[ \t]*\/\/#endregion.*$(?:\r?\n)?/gm, '')
      await writeFile(join(target, 'lib', file), content);
    }
  }
  if (name.endsWith('-host')) {
    const runtime = join(target, 'lib/local-runtime');
    await mkdir(runtime, { recursive: true });
    for (const entry of ['worker.mjs', 'package.json', 'package-lock.json', 'scripts']) {
      await cp(join(harness, 'plugins/voice/local-runtime', entry), join(runtime, entry), {
        recursive: true,
        filter: source => !source.endsWith('.pyc') && !source.includes('/__pycache__/'),
      });
    }
  }
  let hostCode = await readFile(join(target, 'lib/index.js'), 'utf8');
  if (name.endsWith('-host')) {
    // Harness implementation modules include stage-3 decorators. The private
    // artifact targets Node directly, so lower them after RollDown inlines the
    // implementation modules.
    hostCode = execFileSync(join(harness, 'node_modules/.bin/esbuild'), ['--loader=js', '--format=esm', '--target=es2024'], {
      cwd: harness, input: hostCode, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    await writeFile(join(target, 'lib/index.js'), hostCode);
  }
  if (name.endsWith('-host') && /(?:from\s+|import\s+)["']@deepseek-ai\//.test(hostCode)) {
    throw new Error('Voice host bundle retained a Harness runtime import that profiles cannot resolve.');
  }
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
  if (name.endsWith('-client')) clientDsh = original.dsh?.client;
  provenance.push({ name, sourceVersion: original.version, hostSha256: createHash('sha256').update(hostCode).digest('hex') });
}
if (clientDsh === undefined) throw new Error('Voice client has no dsh.client declaration.');
await mkdir(join(output, 'lib'), { recursive: true });
// The browser row must resolve the package root for its dsh.client declaration,
// but that row is not the host plugin. Keep its node half inert and expose the
// host through a subpath so the profile can mount it as a separate Loader row.
await writeFile(join(output, 'lib/index.js'), "export const name = '@voicemesh/dsh-voice';\nexport function apply() {}\n");
await writeFile(join(output, 'lib/host.js'), "export * from '@deepseek-ai/dsh-voice-host';\n");
const clientBundle = await readFile(join(modules, '@deepseek-ai/dsh-voice-client/lib/client.js'), 'utf8');
if (!clientBundle.includes('id: "@deepseek-ai/dsh-voice-client"')) {
  throw new Error('Voice client bundle has no expected module id.');
}
await writeFile(join(output, 'lib/client.js'), clientBundle.replace(
  'id: "@deepseek-ai/dsh-voice-client"', 'id: "@voicemesh/dsh-voice"',
));
const packaged = {
  name: manifest.name, version: manifest.version, private: true, type: 'module',
  description: manifest.description, author: manifest.author, repository: manifest.repository,
  engines: manifest.engines, files: ['lib', 'cordis.patch.yml', 'provenance.json', 'README.md', 'LICENSE', 'LICENSE-COMPOSER', 'NOTICE'],
  exports: { '.': './lib/index.js', './host': './lib/host.js', './client': './lib/client.js', './package.json': './package.json' },
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: clientDsh },
  dependencies: Object.fromEntries(components.map(([name]) => [name, manifest.version])),
  bundledDependencies: components.map(([name]) => name),
};
await writeFile(join(output, 'package.json'), JSON.stringify(packaged, null, 2) + '\n');
await writeFile(join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
await cp(join(root, 'LICENSE'), join(output, 'LICENSE'));
await cp(join(root, 'LICENSE-COMPOSER'), join(output, 'LICENSE-COMPOSER'));
await cp(join(root, 'NOTICE'), join(output, 'NOTICE'));
await writeFile(join(output, 'README.md'), '# VoiceMesh Harness plugin — private beta artifact\n\nIncludes Composer license and runtime notice material. Not approved for public distribution.\n');
await writeFile(join(output, 'cordis.patch.yml'), `# Connection RPC registration accesses webServer on its owning context.
- id: connection
  inject: [webRuntime, webServer]
- insert:
    - id: voice-host
      name: '@voicemesh/dsh-voice/host'
      config:
        path: /api/voice/stt
        sttStreamPath: /api/voice/stt/stream
        sttWsPath: /api/voice/stt/ws
        ttsPath: /api/voice/tts
        healthPath: /api/voice/health
        lastOutputPath: /api/voice/last-output
        deepgramKey: DEEPGRAM_API_KEY
        maxBodyBytes: 33554432
    # Stock profiles have no voice-client row to replace. The root entry is
    # the client-scanned wrapper; its inert Node face keeps host registration
    # on the sibling subpath row above.
    - id: voice-client
      name: '@voicemesh/dsh-voice'
      config:
        path: /api/voice/stt
        sttStreamPath: /api/voice/stt/stream
        sttWsPath: /api/voice/stt/ws
        ttsPath: /api/voice/tts
        healthPath: /api/voice/health
        lastOutputPath: /api/voice/last-output
        deepgramKey: DEEPGRAM_API_KEY
        maxBodyBytes: 33554432
`);
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: output, encoding: 'utf8' }));
const artifact = join(output, packed[0].filename);
await writeFile(join(root, '.release/latest-artifact.json'), JSON.stringify({ artifact, output }, null, 2) + '\n');
console.log('Private validation artifact: ' + artifact);
