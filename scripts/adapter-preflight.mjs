#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const checkMain = args.includes('--check-main');
const allowIoPackageNoPrerelease = args.includes('--allow-io-package-no-prerelease');
const rootArg = args.find((arg) => !arg.startsWith('--')) ?? '.';
const root = path.resolve(rootArg);
const errors = [];
const warnings = [];

function readJson(file) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
        errors.push(`Missing required file: ${file}`);
        return undefined;
    }
    try {
        return JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
        errors.push(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

const pkg = readJson('package.json');
const ioPkg = readJson('io-package.json');
if (!pkg || !ioPkg) {
    printAndExit();
}

if (typeof pkg.name !== 'string' || !/^iobroker\.[a-z0-9][a-z0-9._-]*$/.test(pkg.name)) {
    errors.push('package.json name must be lowercase and follow iobroker.<adaptername>.');
}
if (typeof pkg.version !== 'string' || !pkg.version.trim()) {
    errors.push('package.json must contain a non-empty version string.');
}
const ioVersion = ioPkg.common?.version;
if (typeof ioVersion !== 'string') {
    errors.push('io-package.json common.version must be a string.');
} else if (pkg.version !== ioVersion) {
    const baseVersion = typeof pkg.version === 'string' ? pkg.version.match(/^\d+\.\d+\.\d+/)?.[0] : undefined;
    const isAllowedPrerelease = allowIoPackageNoPrerelease && typeof pkg.version === 'string' && pkg.version.includes('-') && baseVersion === ioVersion;
    if (!isAllowedPrerelease) errors.push(`Version mismatch: package.json=${pkg.version}; io-package.json common.version=${ioVersion}. Synchronize them using the configured release process. If you intentionally use release-script --ioPackageNoPrerelease, pass --allow-io-package-no-prerelease.`);
}
if (!ioPkg.common || typeof ioPkg.common !== 'object') {
    errors.push('io-package.json must contain a common object.');
}
if (typeof ioPkg.common?.name !== 'string' || !ioPkg.common.name.trim()) {
    errors.push('io-package.json common.name must be a non-empty adapter ID.');
} else if (typeof pkg.name === 'string' && pkg.name.startsWith('iobroker.') && ioPkg.common.name !== pkg.name.slice('iobroker.'.length)) {
    warnings.push(`common.name (${ioPkg.common.name}) differs from package suffix (${pkg.name.slice('iobroker.'.length)}); verify this is intentional.`);
}
if (!pkg.repository?.url) warnings.push('package.json repository.url is missing; public repository requirements expect a valid GitHub repository.');
if (!pkg.engines?.node) warnings.push('package.json engines.node is missing; declare the supported Node.js range based on js-controller compatibility.');
if (!pkg.main || typeof pkg.main !== 'string') {
    errors.push('package.json main must point to the built adapter entry point.');
} else if (checkMain && !fs.existsSync(path.resolve(root, pkg.main))) {
    errors.push(`Built entry point does not exist: ${pkg.main}`);
}

for (const key of ['protectedNative', 'encryptedNative']) {
    if (ioPkg[key] !== undefined && (!Array.isArray(ioPkg[key]) || ioPkg[key].some((item) => typeof item !== 'string'))) {
        errors.push(`io-package.json ${key} must be an array of native property names.`);
    }
}
const protectedSet = new Set(Array.isArray(ioPkg.protectedNative) ? ioPkg.protectedNative : []);
const encryptedSet = new Set(Array.isArray(ioPkg.encryptedNative) ? ioPkg.encryptedNative : []);
for (const key of protectedSet) {
    if (!encryptedSet.has(key)) warnings.push(`Native field "${key}" is protected but not encrypted. Confirm that this is intentional; protectedNative does not encrypt data.`);
}
for (const key of encryptedSet) {
    if (!protectedSet.has(key)) warnings.push(`Native field "${key}" is encrypted but not protected. Confirm whether access by other adapters should also be restricted.`);
}

if (pkg.files !== undefined && !Array.isArray(pkg.files)) {
    errors.push('package.json files must be an array when present.');
}
if (!fs.existsSync(path.join(root, 'README.md'))) warnings.push('README.md is missing; public adapter repository requirements expect a README in English.');
if (!fs.existsSync(path.join(root, 'LICENSE'))) warnings.push('LICENSE file is missing.');

// Translations: repochecker requires all supported interface languages (currently 11),
// not only English and German. Check that io-package.json common has localized title/desc/news.
const common = ioPkg.common ?? {};
const localizedKeys = ['title', 'desc', 'news'];
for (const key of localizedKeys) {
    const value = common[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const langs = Object.keys(value);
        if (langs.length > 0 && !langs.includes('en')) {
            warnings.push(`io-package.json common.${key} is missing English ("en") localization.`);
        }
        if (langs.length > 0 && langs.length < 2) {
            warnings.push(`io-package.json common.${key} has only one language; repochecker typically requires all supported interface languages (currently 11), not only en/de.`);
        }
    }
}

// News entries limit: repochecker W56xx flags more than 7 news records.
const news = common.news;
if (news && typeof news === 'object' && !Array.isArray(news)) {
    const newsCount = Object.keys(news).length;
    if (newsCount > 7) {
        warnings.push(`io-package.json common.news has ${newsCount} entries; repochecker limit is 7 news records.`);
    }
}

// License section order: License should be the last section in io-package.json.
const ioKeys = Object.keys(ioPkg);
const licenseIdx = ioKeys.indexOf('license');
const commonIdx = ioKeys.indexOf('common');
const nativeIdx = ioKeys.indexOf('native');
if (licenseIdx !== -1 && (commonIdx !== -1 && licenseIdx < commonIdx || nativeIdx !== -1 && licenseIdx < nativeIdx)) {
    warnings.push('io-package.json "license" section should be the last top-level section according to repository requirements.');
}

printAndExit();

function printAndExit() {
    for (const warning of warnings) console.warn(`WARN  ${warning}`);
    for (const error of errors) console.error(`ERROR ${error}`);
    if (errors.length) {
        console.error(`\nPreflight failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
        process.exitCode = 1;
    } else {
        console.log(`Preflight passed: ${warnings.length} warning(s).`);
    }
}
