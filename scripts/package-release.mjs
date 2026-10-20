import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pkg.version)) throw new Error('Invalid package version');
const output = path.join(root, 'release-assets');
await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'relayops-release-'));
const name = `RelayOps-v${pkg.version}`;
const stage = path.join(temporary, name);
await fs.mkdir(stage);
async function copy(relative) {
  const source = path.join(root, relative);
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Release input must not be a symlink: ${relative}`);
  if (stat.isDirectory()) {
    await fs.mkdir(path.join(stage, relative), { recursive: true });
    for (const file of await fs.readdir(source)) await copy(path.join(relative, file));
  } else {
    if (/(^|[/\\])(?:node_modules|\.relayops|\.git)([/\\]|$)|(^|[/\\])(?:\.env|rules\.local\.yaml)$|\.(?:sqlite|db|log)$/.test(relative)) throw new Error(`Private runtime file excluded: ${relative}`);
    await fs.mkdir(path.dirname(path.join(stage, relative)), { recursive: true });
    await fs.copyFile(source, path.join(stage, relative));
  }
}
try {
  // Explicit allowlist: never package the working directory or local configuration wholesale.
  for (const item of ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', '.env.example', '.nvmrc', 'rules.example.yaml', 'examples', 'docs', 'dist', 'web/package.json', 'web/dist']) await copy(item);
  await fs.writeFile(path.join(stage, 'build-info.json'), JSON.stringify({ version: pkg.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }, null, 2) + '\n');
  const archive = path.join(output, `${name}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', temporary, name]);
  const checksum = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), `${checksum}  ${path.basename(archive)}\n`);
  console.log(`Packaged ${path.basename(archive)} with SHA256SUMS.txt`);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
