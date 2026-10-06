import { mkdir, readFile, writeFile, cp, rm, readdir, realpath, symlink } from 'node:fs/promises';
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
const clientSource = join(root, 'integration/client');
const clientBuild = join(output, 'client-build');

/** Collect package license files for dependencies preserved in RollDown source markers. */
async function writeBundledDependencyLicenses(outputFile, roots, dependencyRoots) {
  const packages = new Map();
  async function addPackage(directory, key = directory) {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (manifest.name === '@voicemesh/composer' || manifest.name.startsWith('@deepseek-ai/') || manifest.name.startsWith('@dsh-voice/')) return;
    packages.set(key, { directory, name: manifest.name, version: manifest.version });
  }
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { await scan(file); continue; }
      if (!entry.isFile() || !/\.[cm]?js$/.test(entry.name)) continue;
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)/g)) {
        const [store, name] = [match[1], match[2]];
        if (name === '@voicemesh/composer' || name.startsWith('@deepseek-ai/') || name.startsWith('@dsh-voice/')) continue;
        const directory = join(harness, 'node_modules/.pnpm', store, 'node_modules', name);
        try { await addPackage(directory, `${store}/${name}`); }
        catch (error) {
          // This exact Composer build references 2.1.2 while the selected Harness
          // store has 2.1.1. Retain the license from the published 2.1.2 archive.
          if (error.code !== 'ENOENT' || store !== 'micromark-extension-gfm-table@2.1.2' || name !== 'micromark-extension-gfm-table') throw error;
          packages.set(`${store}/${name}`, {
            directory: join(root, 'license-sources', store), name, version: '2.1.2',
          });
        }
      }
    }
  }
  for (const directory of roots) await scan(directory);
  for (const root of dependencyRoots) {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (name === '@voicemesh/composer' || name.startsWith('@deepseek-ai/') || name.startsWith('@dsh-voice/')) continue;
      let directory;
      try { directory = await realpath(join(root, 'node_modules', name)); }
      catch {
        try { directory = await realpath(join(harness, 'packages/host/voice-host/node_modules', name)); }
        catch {
          const version = manifest.dependencies[name].replace(/^[~^]/, '');
          directory = await realpath(join(harness, 'node_modules/.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', name));
        }
      }
      await addPackage(directory);
    }
  }
  const sections = [];
  for (const { directory, name, version } of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
    const licenseFiles = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^(?:license|copying|notice)(?:[._-].*)?$|^[a-z0-9_-]+_license$/i.test(entry.name))
      .map(entry => entry.name)
      .sort();
    if (licenseFiles.length === 0) throw new Error(`Bundled dependency ${name}@${version} has no root license file: ${directory}`);
    const texts = await Promise.all(licenseFiles.map(file => readFile(join(directory, file), 'utf8')));
    sections.push(`## ${name} ${version}\n\n${texts.join('\n\n').trim()}`);
  }
  if (sections.length === 0) throw new Error('No bundled third-party dependency source markers were found.');
  await writeFile(outputFile, `# Third-party license texts\n\nThis file is generated from the selected Harness checkout's RollDown source markers.\n\n${sections.join('\n\n')}\n`);
  return packages.size;
}

// The published browser factory is owned by VoiceMesh. Stage its source under
// this package, then use the selected Harness checkout only for its installed
// build runtime and workspace dependencies. Nothing under that checkout is
// written during this process.
await cp(join(clientSource, 'src'), join(clientBuild, 'src'), { recursive: true });
await cp(join(clientSource, 'package.json'), join(clientBuild, 'package.json'));
await symlink(
  join(harness, 'packages/client/voice-client/node_modules'),
  join(clientBuild, 'node_modules'),
);
await writeFile(join(clientBuild, 'tsconfig.json'), JSON.stringify({
  extends: join(harness, 'tsconfig.base.client.json'),
  compilerOptions: {
    baseUrl: '.',
    paths: {},
    rootDir: 'src',
    outDir: 'lib/types',
    composite: false,
    incremental: false,
    ignoreDeprecations: '6.0',
  },
  include: ['src'],
}, null, 2) + '\n');
await writeFile(join(clientBuild, 'tsdown.config.mjs'), `
import { clientBundle } from ${JSON.stringify(pathToFileURL(join(harness, 'packages/client/tsdown.client.ts')).href)};

const configure = clientBundle('@deepseek-ai/dsh-voice-client', ['lib/types/index.js'], {
  clientBanner: () => '/* voicemesh-integration-client */',
});

export default (options) => configure(options).map(config => ({
  ...config,
  outputOptions: { ...config.outputOptions, codeSplitting: false },
}));
`);
execFileSync(join(harness, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
  cwd: clientBuild, stdio: 'inherit',
});
execFileSync(join(harness, 'node_modules/.bin/tsdown'), ['--config', 'tsdown.config.mjs', '--tsconfig', 'tsconfig.json'], {
  cwd: clientBuild, stdio: 'inherit',
});
if (!(await readFile(join(clientBuild, 'lib/client.js'), 'utf8')).includes('voicemesh-integration-client')) {
  throw new Error('VoiceMesh client build did not retain its integration-client source marker.');
}
const components = [
  ['@deepseek-ai/dsh-voice-host', 'packages/host/voice-host'],
  ['@deepseek-ai/dsh-voice-client', clientBuild],
];
const { build } = await import(pathToFileURL(join(harness, 'node_modules/tsdown/dist/index.mjs')).href);
const provenance = [];
let clientDsh;
for (const [name, relative] of components) {
  const source = name.endsWith('-client') ? relative : join(harness, relative), target = join(modules, name);
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
    // implementation modules. Use a file instead of stdin because the CLI can
    // keep an inherited stdin pipe open in some host launchers.
    const decoratorInput = join(target, 'lib', 'decorator-lowering-input.js');
    await writeFile(decoratorInput, hostCode);
    try {
      hostCode = execFileSync(join(harness, 'node_modules/.bin/esbuild'), [decoratorInput, '--platform=neutral', '--format=esm', '--target=es2024'], {
        cwd: harness, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      }).replaceAll('</script>', '<\\/script>');
    } finally { await rm(decoratorInput, { force: true }); }
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
    description: original.description,
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
const bundledLicenseCount = await writeBundledDependencyLicenses(join(output, 'THIRD_PARTY_LICENSES'), [
  join(harness, 'packages/host/voice-host/lib'),
  join(clientBuild, 'lib'),
  join(harness, 'packages/host/voice-host/node_modules/@voicemesh/composer/lib'),
], [
  join(harness, 'packages/host/voice-host'),
  join(harness, 'packages/host/voice-host/node_modules/@voicemesh/composer'),
]);
const packaged = {
  name: manifest.name, version: manifest.version, private: true, type: 'module',
  description: manifest.description, icon: manifest.icon, author: manifest.author, repository: manifest.repository,
  engines: manifest.engines, files: ['icon.svg', 'lib', 'locale', 'cordis.patch.yml', 'provenance.json', 'README.md', 'LICENSE', 'LICENSE-COMPOSER', 'NOTICE', 'THIRD_PARTY_LICENSES'],
  exports: { '.': './lib/index.js', './host': './lib/host.js', './client': './lib/client.js', './locale/*.json': './locale/*.json', './host/locale/*.json': './locale/host/*.json', './package.json': './package.json' },
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: clientDsh },
  dependencies: Object.fromEntries(components.map(([name]) => [name, manifest.version])),
  bundledDependencies: components.map(([name]) => name),
};
await writeFile(join(output, 'package.json'), JSON.stringify(packaged, null, 2) + '\n');
await cp(join(root, 'icon.svg'), join(output, 'icon.svg'));
await cp(join(root, 'locale'), join(output, 'locale'), { recursive: true });
await writeFile(join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
await cp(join(root, 'LICENSE'), join(output, 'LICENSE'));
await cp(join(root, 'LICENSE-COMPOSER'), join(output, 'LICENSE-COMPOSER'));
await cp(join(root, 'NOTICE'), join(output, 'NOTICE'));
await writeFile(join(output, 'README.md'), `# VoiceMesh Harness plugin — private beta artifact\n\nIncludes Composer license and ${bundledLicenseCount} bundled third-party dependency notices. Not approved for public distribution.\n`);
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
    # The bundled client package has its own dsh.client declaration and display
    # metadata. The wrapper root remains the installable bundle and host owner.
    - id: voice-client
      name: '@deepseek-ai/dsh-voice-client'
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
