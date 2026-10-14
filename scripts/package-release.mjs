import { mkdir, readFile, writeFile, cp, rm, readdir, realpath, symlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Provide the built Harness checkout path.');
const harness = resolve(process.argv[2]);
const publicRelease = process.argv.includes('--public');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, '.release', 'package-' + Date.now());
const modules = join(output, 'node_modules');
await mkdir(modules, { recursive: true });
const clientSource = join(root, 'integration/client');
const hostSource = join(root, 'integration/host');
if (!process.env.VOICEMESH_COMPOSER_DIR) throw new Error('Set VOICEMESH_COMPOSER_DIR to the Composer checkout to package.');
const composer = await realpath(process.env.VOICEMESH_COMPOSER_DIR);
const clientBuild = join(output, 'client-build');
const hostBuild = join(output, 'host-build');

/**
 * Link the selected Harness package dependencies into an isolated build tree.
 *
 * Each link targets the original resolved package, so this never writes the
 * Harness checkout. Composer is deliberately overlaid separately: its current
 * compiled output is the release input, rather than the tarball installed by
 * the selected Harness checkout.
 */
async function linkBuildDependencies(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceEntry = join(source, entry.name);
    const targetEntry = join(target, entry.name);
    if (entry.name.startsWith('@')) {
      await mkdir(targetEntry, { recursive: true });
      for (const nested of await readdir(sourceEntry, { withFileTypes: true })) {
        await symlink(await realpath(join(sourceEntry, nested.name)), join(targetEntry, nested.name));
      }
    } else {
      await symlink(await realpath(sourceEntry), targetEntry);
    }
  }
}

/** Stage one wrapper source tree with Harness dependencies and current Composer. */
async function stageWrapperSource(source, target, harnessModules, manifestFile) {
  await cp(join(source, 'src'), join(target, 'src'), { recursive: true });
  await cp(join(source, manifestFile), join(target, 'package.json'));
  await linkBuildDependencies(harnessModules, join(target, 'node_modules'));
  // The Harness base TypeScript configuration names Node's ambient types, but
  // voice-host does not list them as a direct dependency. Retain the selected
  // checkout as the toolchain source without changing it.
  await mkdir(join(target, 'node_modules/@types'), { recursive: true });
  await symlink(await realpath(join(harness, 'node_modules/@types/node')), join(target, 'node_modules/@types/node'));
  // These source imports are present in the standalone wrapper but not in the
  // selected Harness voice-host's direct dependency links.
  await symlink(await realpath(join(harness, 'packages/credentials/credentials')), join(target, 'node_modules/@deepseek-ai/dsh-credentials'));
  await symlink(await realpath(join(harness, 'vendor/schemastery')), join(target, 'node_modules/@deepseek-ai/schemastery'));
  await rm(join(target, 'node_modules/@voicemesh/composer'), { force: true });
  await symlink(composer, join(target, 'node_modules/@voicemesh/composer'));
}

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
        let directory;
        // RollDown preserves the source store path in its marker, which may be
        // newer than the selected Harness store. Resolve the actual staged
        // source package first so Composer's current dependency licenses are
        // collected from the same input that was bundled.
        for (const dependencyRoot of dependencyRoots) {
          try {
            directory = await realpath(join(dependencyRoot, 'node_modules', name));
            break;
          } catch (error) {
            // The dependency is not a direct child of this staged input; the
            // next input or Harness store may still supply its license.
            if (error.code !== 'ENOENT') throw error;
          }
        }
        directory ??= join(harness, 'node_modules/.pnpm', store, 'node_modules', name);
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
  await writeFile(outputFile, `# Third-party license texts\n\nThis file is generated from the staged VoiceMesh and Harness build inputs' RollDown source markers.\n\n${sections.join('\n\n')}\n`);
  return packages.size;
}

// Both wrapper implementations are release inputs. The selected Harness
// checkout supplies only the toolchain and its remaining workspace packages;
// Composer always resolves to the current compiled VoiceMesh source.
await stageWrapperSource(clientSource, clientBuild, join(harness, 'packages/client/voice-client/node_modules'), 'package.json');
await stageWrapperSource(hostSource, hostBuild, join(harness, 'packages/host/voice-host/node_modules'), 'development-package.json');
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
await writeFile(join(hostBuild, 'tsconfig.json'), JSON.stringify({
  extends: join(harness, 'tsconfig.base.json'),
  compilerOptions: {
    baseUrl: '.',
    paths: {},
    rootDir: 'src',
    outDir: 'lib',
    composite: false,
    incremental: false,
    ignoreDeprecations: '6.0',
  },
  include: ['src'],
}, null, 2) + '\n');
execFileSync(join(harness, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
  cwd: hostBuild, stdio: 'inherit',
});
const components = [
  ['@deepseek-ai/dsh-voice-host', hostBuild],
  ['@deepseek-ai/dsh-voice-client', clientBuild],
];
const { build } = await import(pathToFileURL(join(harness, 'node_modules/tsdown/dist/index.mjs')).href);
const provenance = [];
const composerManifest = JSON.parse(await readFile(join(composer, 'package.json'), 'utf8'));
const composerHash = createHash('sha256');
for (const entry of ['index.js', 'server.js', 'browser.js', 'pipeline.js']) {
  composerHash.update(await readFile(join(composer, 'lib', entry)));
}
provenance.push({ name: composerManifest.name, sourceVersion: composerManifest.version, buildSha256: composerHash.digest('hex') });
let clientDsh;
for (const [name, relative] of components) {
  const source = relative, target = join(modules, name);
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
const frameworkClientId = '@deepseek-ai/dsh-voice-client';
const installedPluginId = '@voicemesh/dsh-voice';
const clientBundleTemplate = await readFile(join(clientBuild, 'lib/client.js'), 'utf8');
const frameworkCssOwnerCount = [...clientBundleTemplate.matchAll(
  /\.dataset\.plugin\s*=\s*["']@deepseek-ai\/dsh-voice-client["']/g,
)].length;
if (frameworkCssOwnerCount === 0) {
  throw new Error('Voice client bundle has no plugin-owned CSS styles to remap.');
}
const clientBundle = clientBundleTemplate.replaceAll(frameworkClientId, installedPluginId);
if (!/\bid\s*:\s*["']@voicemesh\/dsh-voice["']/.test(clientBundle)) {
  throw new Error('Voice client bundle has no expected module id.');
}
const installedCssOwnerCount = [...clientBundle.matchAll(
  /\.dataset\.plugin\s*=\s*["']@voicemesh\/dsh-voice["']/g,
)].length;
if (installedCssOwnerCount !== frameworkCssOwnerCount || clientBundle.includes(frameworkClientId)) {
  throw new Error('Voice client CSS is not owned by the installed plugin id.');
}
await writeFile(join(output, 'lib/client.js'), clientBundle);
await writeBundledDependencyLicenses(join(output, 'THIRD_PARTY_LICENSES'), [
  join(hostBuild, 'lib'),
  join(clientBuild, 'lib'),
  join(composer, 'lib'),
], [
  hostBuild,
  clientBuild,
  composer,
]);
const packaged = {
  name: manifest.name, version: manifest.version, ...(publicRelease ? { publishConfig: { access: 'public' } } : { private: true }), type: 'module',
  description: manifest.description, icon: manifest.icon, author: manifest.author, repository: manifest.repository,
  license: manifest.license, homepage: manifest.homepage, bugs: manifest.bugs,
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
await cp(join(root, 'README.md'), join(output, 'README.md'));
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
    # Mount the wrapper root: a profile resolver can address this installed package,
    # while the bundled implementation package remains private to the wrapper.
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
console.log(`${publicRelease ? 'Public beta candidate' : 'Private validation artifact'}: ${artifact}`);
