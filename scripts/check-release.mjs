import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const web = JSON.parse(fs.readFileSync('web/package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
if (web.version !== pkg.version || lock.version !== pkg.version || lock.packages[''].version !== pkg.version || lock.packages.web.version !== pkg.version) throw new Error('Package, workspace, and lockfile versions must match');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${pkg.version}`) throw new Error('Release tag must match the committed package version');
for (const required of ['LICENSE', 'CHANGELOG.md', 'dist/main.js', 'dist/mcp/index.js', 'web/dist/index.html']) if (!fs.existsSync(required)) throw new Error(`Missing release file: ${required}`);
console.log(`Release v${pkg.version} metadata and build verified`);
