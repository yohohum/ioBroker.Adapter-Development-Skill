#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const rootArg = args.find((arg) => !arg.startsWith('--')) ?? '.';
const allowIoPackageNoPrerelease = args.includes('--allow-io-package-no-prerelease');
const root = path.resolve(rootArg);
const errors = [];
const warnings = [];
function readJson(name) {
    try { return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); }
    catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
}
const pkg = readJson('package.json');
const ioPkg = readJson('io-package.json');
if (!pkg || !ioPkg) {
    finish();
    process.exit(1);
}

if (pkg.version !== ioPkg.common?.version) {
    const baseVersion = typeof pkg.version === 'string' ? pkg.version.match(/^\d+\.\d+\.\d+/)?.[0] : undefined;
    const allowed = allowIoPackageNoPrerelease && typeof pkg.version === 'string' && pkg.version.includes('-') && baseVersion === ioPkg.common?.version;
    if (!allowed) errors.push(`Version mismatch: package ${pkg.version}; io-package ${ioPkg.common?.version}.`);
}
const devDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
if (!devDeps['@alcalzone/release-script']) errors.push('@alcalzone/release-script is not installed.');
if (!devDeps['@alcalzone/release-script-plugin-iobroker']) errors.push('@alcalzone/release-script-plugin-iobroker is missing; io-package version/news will not be managed by the plugin.');
if (!pkg.scripts?.release || !String(pkg.scripts.release).includes('release-script')) errors.push('package.json scripts.release must invoke release-script.');

const configPath = path.join(root, '.releaseconfig.json');
if (!fs.existsSync(configPath)) {
    warnings.push('.releaseconfig.json is missing; verify that the ioBroker plugin is loaded explicitly by your release command/config.');
} else {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!Array.isArray(config.plugins) || !config.plugins.includes('iobroker')) errors.push('.releaseconfig.json must include "iobroker" in plugins.');
    } catch (error) {
        errors.push(`Invalid .releaseconfig.json: ${error instanceof Error ? error.message : String(error)}`);
    }
}

const changelogCandidates = ['CHANGELOG.md', 'README.md'];
const hasWip = changelogCandidates.some((name) => {
    const file = path.join(root, name);
    return fs.existsSync(file) && /WORK IN PROGRESS/i.test(fs.readFileSync(file, 'utf8'));
});
if (!hasWip) errors.push('No WORK IN PROGRESS changelog placeholder found in CHANGELOG.md or README.md.');

const publishWorkflow = path.join(root, '.github/workflows/npm-publish.yml');
if (!fs.existsSync(publishWorkflow)) {
    warnings.push('.github/workflows/npm-publish.yml not found; verify the real npm publishing workflow and Trusted Publisher configuration.');
} else {
    const content = fs.readFileSync(publishWorkflow, 'utf8');
    if (!/id-token:\s*write/.test(content)) errors.push('Publish workflow must grant id-token: write for npm Trusted Publishing.');
    if (!/npm publish/.test(content)) errors.push('Publish workflow does not contain npm publish. id-token permission alone does not publish a package.');
    if (!/tags:/.test(content) || !/v\[0-9/.test(content)) warnings.push('Publish workflow tag trigger was not recognized; verify tag patterns manually.');
}

const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (status.error) warnings.push(`Could not inspect Git status: ${status.error.message}`);
else if (status.status !== 0) warnings.push('git status failed; check repository state manually.');
else if (status.stdout.trim()) errors.push('Git working tree is not clean. Commit or stash changes before release.');

finish();
function finish() {
    for (const warning of warnings) console.warn(`WARN  ${warning}`);
    for (const error of errors) console.error(`ERROR ${error}`);
    if (errors.length) {
        console.error(`Release preflight failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
        process.exitCode = 1;
    } else {
        console.log(`Release preflight passed: ${warnings.length} warning(s).`);
    }
}
