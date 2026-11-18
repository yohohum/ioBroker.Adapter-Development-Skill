#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const required = [
    'SKILL.md', 'README.md', 'CONTRIBUTING.md', 'LICENSE',
    'references/official-sources.md', 'references/object-model.md', 'references/security.md',
    'references/transports.md', 'references/admin-config.md', 'references/testing.md',
    'references/release-and-repository.md',
    'workflows/01-discovery.md', 'workflows/02-scaffolding.md', 'workflows/03-architecture.md',
    'workflows/04-implementation.md', 'workflows/05-admin-ui.md', 'workflows/06-debugging.md',
    'workflows/07-testing.md', 'workflows/08-release-gate.md', 'workflows/09-release.md',
    'scripts/adapter-preflight.mjs', 'scripts/check-object-dump.mjs', 'scripts/release-preflight.mjs',
    'scripts/run-adapter-checks.sh', 'scripts/validate-skill.mjs',
    'templates/adapter-tests/testPackageFiles.cjs', 'templates/adapter-tests/testAdapter.integration.cjs',
    'templates/github-actions/adapter-ci.yml', 'templates/github-actions/test-and-release.yml',
    'templates/release/releaseconfig.json',
    'templates/changelog/CHANGELOG.md', '.github/workflows/validate-skill.yml'
];
const missing = required.filter((relative) => !fs.existsSync(path.join(root, relative)));
if (missing.length) {
    console.error(`Missing required files:\n${missing.map((item) => ` - ${item}`).join('\n')}`);
    process.exit(1);
}

const frontmatter = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8').split(/\r?\n/).slice(0, 8).join('\n');
if (!frontmatter.startsWith('---') || !/\nname:\s*iobroker-adapter-development\n/.test(frontmatter)) {
    console.error('SKILL.md frontmatter is missing or has an unexpected skill name.');
    process.exit(1);
}

const nodeFiles = [
    'scripts/adapter-preflight.mjs', 'scripts/check-object-dump.mjs',
    'scripts/release-preflight.mjs', 'scripts/validate-skill.mjs',
    'templates/adapter-tests/testPackageFiles.cjs',
    'templates/adapter-tests/testAdapter.integration.cjs'
];
let failed = false;
for (const relative of nodeFiles) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, relative)], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed = true;
        console.error(`Syntax error in ${relative}:\n${result.stderr || result.stdout}`);
    }
}
const bash = spawnSync('bash', ['-n', path.join(root, 'scripts/run-adapter-checks.sh')], { encoding: 'utf8' });
if (bash.status !== 0) {
    failed = true;
    console.error(`Shell syntax error:\n${bash.stderr || bash.stdout}`);
}

for (const relative of required.filter((item) => item.endsWith('.json'))) {
    try { JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
    catch (error) { failed = true; console.error(`Invalid JSON in ${relative}: ${error.message}`); }
}

// Check relative Markdown links without requiring a network connection.
const markdownFiles = [];
function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && full.endsWith('.md')) markdownFiles.push(full);
    }
}
walk(root);
for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const regex = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of content.matchAll(regex)) {
        const target = match[1].split('#')[0];
        if (!target || /^(https?:|mailto:|#)/i.test(target)) continue;
        const resolved = path.resolve(path.dirname(file), target);
        if (!fs.existsSync(resolved)) {
            failed = true;
            console.error(`Broken local Markdown link in ${path.relative(root, file)}: ${target}`);
        }
    }
}

if (failed) process.exit(1);
console.log(`Skill validation passed. ${required.length} required files found; ${markdownFiles.length} Markdown files scanned.`);
