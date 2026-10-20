import fs from 'node:fs';
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const start = changelog.indexOf(`## ${version} `);
if (start < 0) throw new Error(`No changelog entry for ${version}`);
const end = changelog.indexOf('\n## ', start + 1);
process.stdout.write(changelog.slice(start, end < 0 ? undefined : end).trim() + '\n');
