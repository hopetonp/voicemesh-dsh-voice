import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2];
const verifyOnly = process.argv[3] === '--verify-only';
if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(tag ?? '') || (process.argv[3] && !verifyOnly)) {
  throw new Error('Usage: node scripts/deploy-github-release.mjs <version-tag> [--verify-only]');
}
const version = tag.slice(1);
const assetName = `voicemesh-dsh-voice-${version}.tgz`;
const directory = join(root, '.release', 'assets', tag);
const archive = join(directory, assetName);
const checksumFile = join(directory, 'SHA256SUMS');
const sourceFile = join(directory, 'SOURCE_COMMIT');

function command(binary, args, options = {}) {
  return execFileSync(binary, args, { cwd: root, encoding: 'utf8', ...options })?.trim() ?? '';
}

const [bytes, checksumText, sourceCommit] = await Promise.all([
  readFile(archive), readFile(checksumFile, 'utf8'), readFile(sourceFile, 'utf8'),
]);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (checksumText !== `${sha256}  ${assetName}\n`) throw new Error('SHA256SUMS does not match the release archive');
const tagCommit = command('git', ['rev-parse', `${tag}^{commit}`]);
if (sourceCommit.trim() !== tagCommit) throw new Error('SOURCE_COMMIT does not match the source tag');

const manifest = JSON.parse(command('tar', ['-xOf', archive, 'package/package.json']));
if (manifest.name !== '@voicemesh/dsh-voice' || manifest.version !== version || manifest.private === true || manifest.publishConfig?.access !== 'public') {
  throw new Error('Release archive manifest does not match the public tagged package');
}
console.log(`Verified ${assetName}: SHA-256 ${sha256}`);
if (verifyOnly) process.exit(0);

if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required to update the GitHub release');
try {
  command('gh', ['release', 'view', tag]);
} catch {
  command('gh', ['release', 'create', tag, '--verify-tag', ...(version.includes('-') ? ['--prerelease'] : []),
    '--title', `DeepSeek Harness Two-Way Voice by Hopeton ${tag}`, '--notes', 'Install the attached plugin archive through DeepSeek Harness Plugins → Add plugin.']);
}
command('gh', ['release', 'upload', tag, archive, checksumFile, '--clobber'], { stdio: 'inherit' });

const download = await mkdtemp(join(tmpdir(), 'voicemesh-release-verify-'));
try {
  command('gh', ['release', 'download', tag, '--pattern', assetName, '--dir', download]);
  command('gh', ['release', 'download', tag, '--pattern', 'SHA256SUMS', '--dir', download]);
  const [downloadedArchive, downloadedChecksums] = await Promise.all([
    readFile(join(download, assetName)), readFile(join(download, 'SHA256SUMS'), 'utf8'),
  ]);
  const downloadedHash = createHash('sha256').update(downloadedArchive).digest('hex');
  if (downloadedHash !== sha256 || downloadedChecksums !== checksumText) throw new Error('Downloaded release assets differ from reviewed inputs');
  console.log(`Downloaded release assets match ${sha256}`);
} finally {
  await rm(download, { recursive: true, force: true });
}
