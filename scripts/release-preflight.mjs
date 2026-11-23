#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

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
function readYaml(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return load(content);
    } catch (error) {
        errors.push(`${filePath}: некорректный YAML: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
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
        reviewNeeded.push('Профиль не указан. Укажите --profile=create-adapter-default или --profile=custom-approved.');
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
    const hasCustomReleaseDoc = fs.existsSync(path.join(root, 'docs', 'RELEASE.md')) ||
        fs.existsSync(path.join(root, 'RELEASE.md')) ||
        (pkg.scripts?.release && String(pkg.scripts.release).includes('release-script'));
    if (!hasCustomReleaseDoc) {
        reviewNeeded.push('Профиль custom-approved требует документированного описания альтернативного механизма релиза (docs/RELEASE.md или scripts.release).');
    }
    // Даже в custom-approved проверяются все инварианты
    if (!pkg.version || !ioPkg.common?.version) {
        errors.push('Не удаётся проверить версию: отсутствует package.json version или io-package.json common.version.');
    }

    // Проверка любого найденного workflow публикации
    const testAndReleasePath = path.join(root, '.github/workflows/test-and-release.yml');
    const npmPublishPath = path.join(root, '.github/workflows/npm-publish.yml');
    const workflowsToCheck = [testAndReleasePath, npmPublishPath].filter(p => fs.existsSync(p));
    if (workflowsToCheck.length === 0) {
        reviewNeeded.push('No publishing workflow found; verify custom release process.');
    } else {
        for (const wf of workflowsToCheck) {
            validatePublishWorkflow(wf, 'custom-approved');
        }
    }
}

// --- Валидация структуры workflow публикации ---

function validatePublishWorkflow(wfPath, profileName) {
    const wf = readYaml(wfPath);
    if (!wf) return;

    // Проверяем наличие обязательных jobs
    const requiredJobs = ['check-and-lint', 'adapter-tests', 'deploy'];
    const jobs = wf.jobs || {};
    for (const jobName of requiredJobs) {
        if (!jobs[jobName]) {
            errors.push(`${path.basename(wfPath)}: отсутствует обязательный job "${jobName}".`);
        }
    }

    // Проверяем Actions и их inputs даже если job уже существует.
    // Отсутствующий Action внутри существующей job — ошибка, а не повод пропустить проверку.
    if (jobs['check-and-lint']) {
        checkActionInputs(jobs['check-and-lint'], 'check-and-lint', 'ioBroker/testing-action-check', ['node-version'], 2, wfPath);
    }
    if (jobs['adapter-tests']) {
        checkActionInputs(jobs['adapter-tests'], 'adapter-tests', 'ioBroker/testing-action-adapter', ['node-version', 'os'], 1, wfPath);
    }
    if (jobs['deploy']) {
        checkActionInputs(jobs['deploy'], 'deploy', 'ioBroker/testing-action-deploy', ['node-version', 'github-token'], 1, wfPath);
    }

    // Проверяем матрицу Node.js
    checkNodeMatrix(jobs, wfPath);

    // Проверяем матрицу OS
    checkOSMatrix(jobs, wfPath);

    // Проверяем зависимости deploy
    checkDeployNeeds(jobs, wfPath);

    // Проверяем условия публикации (deploy только по тегам)
    checkDeployCondition(jobs, wfPath);

    // Проверяем отсутствие ручного npm publish
    checkNoManualPublish(jobs, wfPath);
}

function actionRefMatches(uses, expectedAction) {
    if (typeof uses !== 'string') return false;
    return uses === expectedAction ||
        uses.startsWith(`${expectedAction}@`) ||
        uses.startsWith(`${expectedAction}/`);
}

function checkActionInputs(job, jobName, expectedAction, requiredInputs, minMajorVersion, wfPath) {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    let actionFound = false;

    for (const step of steps) {
        if (!actionRefMatches(step?.uses, expectedAction)) continue;
        actionFound = true;
        const withInputs = step.with || {};
        for (const input of requiredInputs) {
            if (!(input in withInputs)) {
                errors.push(`${path.basename(wfPath)}: Action ${expectedAction} в job "${jobName}" не имеет обязательного параметра "${input}".`);
            }
        }
        const versionMatch = step.uses.match(/@v(\d+)(?:\.|$)/);
        if (versionMatch) {
            const majorVersion = parseInt(versionMatch[1], 10);
            if (majorVersion < minMajorVersion) {
                errors.push(`${path.basename(wfPath)}: ${expectedAction} в job "${jobName}" должен быть @v${minMajorVersion} или выше, найден ${step.uses}.`);
            }
        }
    }

    if (!actionFound) {
        errors.push(`${path.basename(wfPath)}: Action ${expectedAction} не найден в существующей job "${jobName}". Это обязательное действие для публикации.`);
    }
}

function checkNodeMatrix(jobs, wfPath) {
    const requiredNodeVersions = ['22', '24', '26'];
    // Матрица Node.js обязательна только для job adapter-tests
    const job = jobs['adapter-tests'];
    if (!job) {
        errors.push(`${path.basename(wfPath)}: отсутствует job "adapter-tests" — обязателен для кросс-платформенного тестирования.`);
        return;
    }
    const strategy = job.strategy || {};
    if (!strategy || !strategy.matrix) {
        errors.push(`${path.basename(wfPath)}: job "adapter-tests": отсутствует strategy.matrix — обязательна для тестирования на múltiples версиях Node.js.`);
        return;
    }
    const matrix = strategy.matrix;
    const nodeVersions = matrix['node-version'];
    if (!Array.isArray(nodeVersions)) {
        errors.push(`${path.basename(wfPath)}: job "adapter-tests": matrix['node-version'] должен быть массивом, получен: ${typeof nodeVersions}.`);
        return;
    }
    const missing = requiredNodeVersions.filter(v => !nodeVersions.includes(v));
    if (missing.length > 0) {
        errors.push(`${path.basename(wfPath)}: job "adapter-tests": неполная матрица Node.js, отсутствуют версии: ${missing.join(', ')}.`);
    }
}

function checkOSMatrix(jobs, wfPath) {
    const requiredOS = ['ubuntu-latest', 'windows-latest', 'macos-latest'];
    // Матрица OS обязательна только для job adapter-tests
    const job = jobs['adapter-tests'];
    if (!job) return;
    const strategy = job.strategy || {};
    if (!strategy || !strategy.matrix) {
        errors.push(`${path.basename(wfPath)}: job "adapter-tests": отсутствует strategy.matrix — обязательна для тестирования на разных ОС.`);
        return;
    }
    const matrix = strategy.matrix;
    const osList = matrix.os;
    if (!Array.isArray(osList)) {
        errors.push(`${path.basename(wfPath)}: job "adapter-tests": matrix['os'] должен быть массивом, получен: ${typeof osList}.`);
        return;
    }
    const missing = requiredOS.filter(v => !osList.includes(v));
    if (missing.length > 0) {
        errors.push(`${path.basename(wfPath)}: job "adapter-tests": неполная матрица OS, отсутствуют: ${missing.join(', ')}.`);
    }
}

function checkDeployNeeds(jobs, wfPath) {
    const deployJob = jobs['deploy'];
    if (!deployJob) return;
    const needs = deployJob.needs || [];
    const needsArray = Array.isArray(needs) ? needs : [needs];
    const requiredDeps = ['check-and-lint', 'adapter-tests'];
    const missing = requiredDeps.filter(d => !needsArray.includes(d));
    if (missing.length > 0) {
        errors.push(`${path.basename(wfPath)}: job "deploy" не зависит от обязательных задач: ${missing.join(', ')}. Публикация не должна выполняться при ошибках тестирования.`);
    }
}

function checkDeployCondition(jobs, wfPath) {
    const deployJob = jobs['deploy'];
    if (!deployJob) return;

    const rawCondition = deployJob.if;
    if (rawCondition === undefined || rawCondition === null || String(rawCondition).trim() === '') {
        errors.push(`${path.basename(wfPath)}: job "deploy" не имеет условия запуска. Публикация должна выполняться только по релизным тегам.`);
        return;
    }

    const condition = String(rawCondition).replace(/\$\{\{/g, '').replace(/\}\}/g, '').trim();
    const lower = condition.toLowerCase();

    if (/^(true|1)$/.test(lower)) {
        errors.push(`${path.basename(wfPath)}: job "deploy" имеет безусловный запуск. Публикация должна выполняться только по релизным тегам.`);
        return;
    }

    // Условия, которые могут выполнить deploy после падения/отмены тестов.
    for (const fn of ['always', 'failure', 'cancelled']) {
        if (new RegExp(`\\b${fn}\\s*\\(`).test(lower)) {
            errors.push(`${path.basename(wfPath)}: job "deploy" содержит "${fn}()", что позволяет публикацию без успешного завершения тестов. Это недопустимо.`);
        }
    }

    const tagGuardPatterns = [
        /startsWith\s*\(\s*github\.ref\s*,\s*['"]refs\/tags\//i,
        /github\.ref\s*==\s*['"]refs\/tags\//i,
        /contains\s*\(\s*github\.ref\s*,\s*['"]refs\/tags\//i,
        /github\.ref_type\s*==\s*['"]tag['"]/i,
    ];
    const hasTagGuard = tagGuardPatterns.some(pattern => pattern.test(condition));

    if (!hasTagGuard) {
        errors.push(`${path.basename(wfPath)}: job "deploy" не имеет условия запуска только по релизным тегам. Публикация должна выполняться только для тегов.`);
    }

    // Отрицание tag-guard не является безопасным ограничением.
    // Проверяем все формы: !contains(...), !startsWith(...), !(github.ref == ...),
    // github.ref != ..., github.ref_type != 'tag', а также сравнение tag-guard с false/true.
    const negatedTagGuardPatterns = [
        /!\s*\(*\s*startsWith\s*\(\s*github\.ref\s*,\s*['"]refs\/tags\//i,
        /!\s*\(*\s*contains\s*\(\s*github\.ref\s*,\s*['"]refs\/tags\//i,
        /!\s*\(*\s*github\.ref\s*==\s*['"]refs\/tags\//i,
        /!\s*\(*\s*github\.ref_type\s*==\s*['"]tag['"]/i,
        /github\.ref\s*!=\s*['"]refs\/tags\//i,
        /github\.ref_type\s*!=\s*['"]tag['"]/i,
        /(?:startsWith|contains)\s*\(\s*github\.ref[^)]*\)\s*==\s*false/i,
        /(?:startsWith|contains)\s*\(\s*github\.ref[^)]*\)\s*!=\s*true/i,
        /github\.ref_type\s*==\s*['"]tag['"]\s*==\s*false/i,
    ];
    if (negatedTagGuardPatterns.some(pattern => pattern.test(condition))) {
        errors.push(`${path.basename(wfPath)}: job "deploy" инвертирует проверку тега — это небезопасное условие публикации.`);
    }

    // Ветки, pull request и ручные refs не должны открывать публикацию.
    // Отрицание ветки (например, !startsWith(github.ref, 'refs/heads/')) безопасно и не считается веткой.
    const positiveCondition = condition
        .replace(/!\s*\(*\s*(?:startsWith|contains)\s*\(\s*github\.ref\s*,\s*['"]refs\/heads\//gi, '')
        .replace(/github\.ref\s*!=\s*['"]refs\/heads\//gi, '');
    const branchOrPullRequestPattern = new RegExp(
        'refs/heads|github\\.head_ref|github\\.base_ref|github\\.event_name\\s*==\\s*[\'"]pull_request[\'"]|github\\.event\\.pull_request',
        'i'
    );
    if (branchOrPullRequestPattern.test(positiveCondition)) {
        errors.push(`${path.basename(wfPath)}: job "deploy" содержит условие для ветки/pull request; публикация должна выполняться только по тегам.`);
    }

    // OR допустим только если каждая ветка условия сама ограничена тегом.
    if (condition.includes('||')) {
        const operands = condition.split('||').map(part => part.trim()).filter(Boolean);
        const unsafeOperands = operands.filter(part => !tagGuardPatterns.some(pattern => pattern.test(part)));
        if (unsafeOperands.length > 0) {
            errors.push(`${path.basename(wfPath)}: job "deploy" использует OR с условием, не ограниченным релизным тегом: ${unsafeOperands.join(' || ')}. Это позволяет публикацию вне тега.`);
        }
    }
}

function checkNoManualPublish(jobs, wfPath) {
    const steps = [];
    for (const [jobName, job] of Object.entries(jobs)) {
        if (job.steps) {
            for (const step of job.steps) {
                if (step.run && /\b(?:npm|pnpm|yarn)\s+publish\b/.test(step.run)) {
                    errors.push(`${path.basename(wfPath)}: job "${jobName}" содержит прямой вызов "npm publish". Используйте ioBroker/testing-action-deploy@v1 вместо ручной публикации.`);
                }
            }
        }
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
