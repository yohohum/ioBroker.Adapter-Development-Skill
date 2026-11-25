#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { validatePublishWorkflow as validateWorkflow, validateWorkflowFile } from './lib/publish-workflow.mjs';
import { readVerifiedText } from './lib/action-refs.mjs';

const VALID_PROFILES = ['create-adapter-default', 'custom-approved'];

const args = process.argv.slice(2);
const rootArg = args.find((arg) => !arg.startsWith('--')) ?? '.';
const allowIoPackageNoPrerelease = args.includes('--allow-io-package-no-prerelease');
const profileArg = args.find((arg) => arg.startsWith('--profile='));
const profile = profileArg ? profileArg.slice('--profile='.length) : null;
const skipGitCheck = args.includes('--no-git-check');
const root = path.resolve(rootArg);
const errors = [];
const warnings = [];
const reviewNeeded = [];

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

// --- Валидация профиля ---
if (profile !== null && !VALID_PROFILES.includes(profile)) {
    errors.push(`Неизвестный профиль: "${profile}". Допустимые значения: ${VALID_PROFILES.join(', ')}.`);
    finish();
    process.exitCode = 1;
    process.exit(1);
}

// Если профиль не указан, определяем по наличию release-script
if (profile === null) {
    const devDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (devDeps['@alcalzone/release-script']) {
        warnings.push('Профиль не указан, но обнаружен @alcalzone/release-script. Рекомендуется --profile=create-adapter-default.');
    } else {
        reviewNeeded.push('Профиль не указан. Укажите --profile=create-adapter-default или --profile=custom-approved (ручной релиз с тегом без release-script).');
    }
}

// --- Общие проверки (обязательны для любого профиля) ---

if (pkg.version !== ioPkg.common?.version) {
    const baseVersion = typeof pkg.version === 'string' ? pkg.version.match(/^\d+\.\d+\.\d+/)?.[0] : undefined;
    const allowed = allowIoPackageNoPrerelease && typeof pkg.version === 'string' && pkg.version.includes('-') && baseVersion === ioPkg.common?.version;
    if (!allowed) errors.push(`Version mismatch: package ${pkg.version}; io-package ${ioPkg.common?.version}.`);
}

// Changelog: WORK IN PROGRESS в README.md
const changelogCandidates = ['README.md'];
const hasWip = changelogCandidates.some((name) => {
    const file = path.join(root, name);
    return fs.existsSync(file) && /WORK IN PROGRESS/i.test(fs.readFileSync(file, 'utf8'));
});
if (!hasWip) {
    if (profile === 'create-adapter-default' || profile === null) {
        errors.push('No WORK IN PROGRESS changelog placeholder found in README.md.');
    } else {
        reviewNeeded.push('No WORK IN PROGRESS changelog placeholder found in README.md.');
    }
}

// Отдельный CHANGELOG.md не требуется; архив в CHANGELOG_OLD.md допустимо
const hasChangelogMd = fs.existsSync(path.join(root, 'CHANGELOG.md'));
if (hasChangelogMd) {
    warnings.push('CHANGELOG.md найден; актуальная схема хранит changelog в README.md, старые записи — в CHANGELOG_OLD.md.');
}

// --- Профиль create-adapter-default ---
if (profile === 'create-adapter-default' || profile === null) {
    const devDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (!devDeps['@alcalzone/release-script']) {
        errors.push('@alcalzone/release-script is not installed (требуется для профиля create-adapter-default).');
    }
    if (!devDeps['@alcalzone/release-script-plugin-iobroker']) {
        errors.push('@alcalzone/release-script-plugin-iobroker is missing (требуется для профиля create-adapter-default).');
    }
    if (!pkg.scripts?.release || !String(pkg.scripts.release).includes('release-script')) {
        errors.push('package.json scripts.release must invoke release-script (требуется для профиля create-adapter-default).');
    }

    const configPath = path.join(root, '.releaseconfig.json');
    if (!fs.existsSync(configPath)) {
        warnings.push('.releaseconfig.json is missing; verify that the ioBroker plugin is loaded explicitly by your release command/config.');
    } else {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (!Array.isArray(config.plugins) || !config.plugins.includes('iobroker')) {
                errors.push('.releaseconfig.json must include "iobroker" in plugins.');
            }
        } catch (error) {
            errors.push(`Invalid .releaseconfig.json: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Проверка workflow публикации через YAML-парсер
    const testAndReleasePath = path.join(root, '.github/workflows/test-and-release.yml');
    if (!fs.existsSync(testAndReleasePath)) {
        errors.push('No publishing workflow found: .github/workflows/test-and-release.yml (обязателен для профиля create-adapter-default).');
    } else {
        validatePublishWorkflow(testAndReleasePath, 'create-adapter-default');
    }

    // npm-publish.yml не должен быть альтернативой в default-профиле
    const npmPublishPath = path.join(root, '.github/workflows/npm-publish.yml');
    if (fs.existsSync(npmPublishPath)) {
        errors.push('.github/workflows/npm-publish.yml не должен использоваться как альтернатива test-and-release.yml в профиле create-adapter-default.');
    }
}

// --- Профиль custom-approved ---
if (profile === 'custom-approved') {
    // Профиль предназначен для ручного релиза с тегом и Trusted Publishing.
    // release-script он не требует, но применяет ту же workflow и Action
    // policy, что и стандартный профиль, и не утверждает альтернативный
    // publication workflow.
    if (!pkg.version || !ioPkg.common?.version) {
        errors.push('Не удаётся проверить версию: отсутствует package.json version или io-package.json common.version.');
    }

    const testAndReleasePath = path.join(root, '.github/workflows/test-and-release.yml');
    const npmPublishPath = path.join(root, '.github/workflows/npm-publish.yml');
    if (fs.existsSync(npmPublishPath)) {
        errors.push('.github/workflows/npm-publish.yml не поддерживается в профиле custom-approved; используйте стандартный test-and-release.yml.');
    }
    if (!fs.existsSync(testAndReleasePath)) {
        errors.push('No publishing workflow found: .github/workflows/test-and-release.yml (обязателен также для профиля custom-approved).');
    } else {
        validatePublishWorkflow(testAndReleasePath, 'custom-approved');
    }
}

// --- Валидация структуры workflow публикации ---

function validatePublishWorkflow(wfPath, profileName) {
    const actionResult = validateWorkflowFile(wfPath, {
        root,
        requireIoBrokerActions: true,
        profile: profileName,
    });
    errors.push(...actionResult.errors);
    warnings.push(...actionResult.warnings);
    reviewNeeded.push(...actionResult.reviews);
    try {
        const workflow = loadYaml(readVerifiedText(root, wfPath));
        // validateWorkflowFile() выше уже рекурсивно проверила локальные
        // reusable workflows (включая job-level uses: ./...). Второй этап
        // оставляет все проверки публикации, но не отвергает локальные
        // reusable workflows повторно — иначе корректный локальный
        // reusable workflow отклонялся бы после успешной рекурсивной проверки.
        const result = validateWorkflow(workflow?.jobs ?? {}, { wfName: path.basename(wfPath), allowLocalJobUses: true, allowLocalStepUses: true });
        errors.push(...result.errors);
        warnings.push(...result.warnings);
        reviewNeeded.push(...result.reviews);
    } catch (error) {
        errors.push(`${wfPath}: некорректный YAML: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// --- Проверка git статуса ---
if (!skipGitCheck) {
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    if (status.error) warnings.push(`Could not inspect Git status: ${status.error.message}`);
    else if (status.status !== 0) warnings.push('git status failed; check repository state manually.');
    else if (status.stdout.trim()) errors.push('Git working tree is not clean. Commit or stash changes before release.');
}

finish();
function finish() {
    for (const warning of warnings) console.warn(`WARN  ${warning}`);
    for (const r of reviewNeeded) console.warn(`REVIEW  ${r}`);
    for (const error of errors) console.error(`ERROR ${error}`);
    if (errors.length) {
        console.error(`Release preflight failed: ${errors.length} error(s), ${warnings.length} warning(s), ${reviewNeeded.length} review(s).`);
        process.exitCode = 1;
    } else if (reviewNeeded.length > 0) {
        console.log(`Release preflight: NEEDS REVIEW (profile: ${profile ?? 'auto'}): ${reviewNeeded.length} review(s), ${warnings.length} warning(s).`);
        process.exitCode = 2;
    } else {
        console.log(`Release preflight passed (profile: ${profile ?? 'auto'}): ${warnings.length} warning(s).`);
    }
}
