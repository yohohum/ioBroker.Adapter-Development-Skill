#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const required = [
    'SKILL.md', 'README.md', 'CONTRIBUTING.md', 'LICENSE',
    'references/official-sources.md', 'references/object-model.md', 'references/security.md',
    'references/transports.md', 'references/admin-config.md', 'references/testing.md',
    'references/release-and-repository.md',
    'workflows/01-discovery.md', 'workflows/02-scaffolding.md', 'workflows/03-architecture.md',
    'workflows/04-implementation.md', 'workflows/05-admin-ui.md', 'workflows/06-debugging.md',
    'workflows/07-testing.md', 'workflows/08-release-gate.md', 'workflows/09-release.md',
    'scripts/adapter-preflight.mjs', 'scripts/check-object-dump.mjs', 'scripts/check-translations.mjs', 'scripts/release-preflight.mjs',
    'scripts/run-adapter-checks.sh', 'scripts/validate-skill.mjs',
    'templates/adapter-tests/testPackageFiles.cjs', 'templates/adapter-tests/testAdapter.integration.cjs',
    'templates/github-actions/adapter-ci.yml', 'templates/github-actions/test-and-release.yml',
    'templates/release/releaseconfig.json',
    '.github/workflows/validate-skill.yml'
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
    'scripts/check-translations.mjs', 'scripts/release-preflight.mjs', 'scripts/validate-skill.mjs',
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

// --- Проверка YAML файлов ---
const yamlFiles = required.filter((item) => item.endsWith('.yml') || item.endsWith('.yaml'));
for (const relative of yamlFiles) {
    const filePath = path.join(root, relative);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        loadYaml(content);
    } catch (error) {
        failed = true;
        console.error(`Invalid YAML in ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Check relative Markdown links without requiring a network connection.
const markdownFiles = [];
function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
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

// --- Проверка согласованности самого Skill ---

// 1. Нет ссылок на несуществующий npm-publish.yml (кроме отрицательных инструкций "не использовать")
for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('npm-publish.yml') && !/(не\s+использу|НЕ\s+использу|not\s+use|не\s+создава|НЕ\s+создава|do\s+not\s+create)/i.test(line)) {
            failed = true;
            console.error(`Ссылка на несуществующий npm-publish.yml в ${path.relative(root, file)} (строка ${i + 1})`);
        }
    }
}

// 2. Нет ссылок на несуществующий CHANGELOG.md
for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('CHANGELOG.md') && !content.includes('CHANGELOG_OLD.md')) {
        failed = true;
        console.error(`Ссылка на несуществующий CHANGELOG.md в ${path.relative(root, file)}`);
    }
}

// 3. Нет вызовов repochecker с --local . или --local <путь> вместо URL
const repocheckerLocalBadPattern = /repochecker(?:@latest)?\s+https?:\/\/[^\s"'\]]+\s+--local\s+(["']?)\.\1|repochecker(?:@latest)?\s+--local\s+["']?\$ROOT["']?/;
const skipFiles = new Set(['scripts/validate-skill.mjs']);
for (const file of markdownFiles.concat(nodeFiles.map(f => path.join(root, f)))) {
    const relPath = path.relative(root, file);
    if (skipFiles.has(relPath) || !fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (repocheckerLocalBadPattern.test(content)) {
        failed = true;
        console.error(`Некорректный вызов repochecker --local с путем вместо URL в ${relPath}`);
    }
}

// 4. Нет вызовов repochecker без URL
const repocheckerNoUrlPattern = /npx\s+--yes\s+@iobroker\/repochecker(?:@latest)?\s+(?!https:\/\/github\.com\/)(?!$)/;
for (const file of markdownFiles.concat(nodeFiles.map(f => path.join(root, f)))) {
    const relPath = path.relative(root, file);
    if (skipFiles.has(relPath) || !fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (repocheckerNoUrlPattern.test(line) && !line.includes('https://github.com/')) {
            failed = true;
            console.error(`Вызов repochecker без GitHub URL в ${relPath} (строка ${i + 1})`);
        }
    }
}

// 5. check-translations.mjs проверяет common.titleLang
const translationsContent = fs.readFileSync(path.join(root, 'scripts/check-translations.mjs'), 'utf8');
if (!translationsContent.includes('common.titleLang')) {
    failed = true;
    console.error('scripts/check-translations.mjs не проверяет common.titleLang');
}

// 6. check-translations.mjs использует json5 библиотеку
if (!translationsContent.includes("from 'json5'") && !translationsContent.includes('from "json5"')) {
    failed = true;
    console.error('scripts/check-translations.mjs не использует библиотеку json5 для парсинга JSON5');
}

// 7. Нет устаревших упоминаний Admin3
for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (/\badmin3\b/i.test(content)) {
        failed = true;
        console.error(`Устаревшее упоминание Admin3 в ${path.relative(root, file)}`);
    }
}

// 8. Нет упоминания admin/i18n/*/translations.json как универсального пути
for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('admin/i18n/*/translations.json') && !content.includes('устаревший')) {
        failed = true;
        console.error(`Устаревший путь admin/i18n/*/translations.json без пометки об устаревании в ${path.relative(root, file)}`);
    }
}

// 9. test-and-release.yml содержит необходимые jobs, зависимости, Actions с правильными версиями и inputs
const testReleasePath = path.join(root, 'templates/github-actions/test-and-release.yml');
const testReleaseContent = fs.readFileSync(testReleasePath, 'utf8');
let testReleaseYaml;
try {
    testReleaseYaml = loadYaml(testReleaseContent);
} catch (_e) {
    testReleaseYaml = null;
}

if (!testReleaseYaml) {
    failed = true;
    console.error('test-and-release.yml: не удалось распарсить YAML.');
} else {
    const jobs = testReleaseYaml.jobs || {};
    const requiredJobs = ['check-and-lint', 'adapter-tests', 'deploy'];
    for (const job of requiredJobs) {
        if (!jobs[job]) {
            failed = true;
            console.error(`test-and-release.yml: отсутствует job "${job}".`);
        }
    }

    // Проверяем зависимости deploy — fail-closed
    if (jobs['deploy']) {
        const needs = jobs['deploy'].needs || [];
        const needsArray = Array.isArray(needs) ? needs : [needs];
        if (!needsArray.includes('check-and-lint')) {
            failed = true;
            console.error('test-and-release.yml: job "deploy" не зависит от "check-and-lint".');
        }
        if (!needsArray.includes('adapter-tests')) {
            failed = true;
            console.error('test-and-release.yml: job "deploy" не зависит от "adapter-tests".');
        }
    }

    // Проверяем Actions и их версии/inputs структурно
    function checkActionInJob(jobName, expectedAction, minMajorVersion, requiredInputs) {
        const job = jobs[jobName];
        if (!job) return;
        const steps = job.steps || [];
        let actionFound = false;
        for (const step of steps) {
            if (step.uses && step.uses.startsWith(expectedAction)) {
                actionFound = true;
                const versionMatch = step.uses.match(/@v(\d+)/);
                if (versionMatch) {
                    const majorVersion = parseInt(versionMatch[1], 10);
                    if (majorVersion < minMajorVersion) {
                        failed = true;
                        console.error(`test-and-release.yml: job "${jobName}": ${expectedAction} должен быть @v${minMajorVersion} или выше, найден ${step.uses}.`);
                    }
                }
                const withInputs = step.with || {};
                for (const input of requiredInputs) {
                    if (!(input in withInputs)) {
                        failed = true;
                        console.error(`test-and-release.yml: job "${jobName}": Action ${expectedAction} не имеет обязательного параметра "${input}".`);
                    }
                }
            }
        }
        if (!actionFound) {
            failed = true;
            console.error(`test-and-release.yml: job "${jobName}": не найден Action ${expectedAction}.`);
        }
    }

    checkActionInJob('check-and-lint', 'ioBroker/testing-action-check', 2, ['node-version']);
    checkActionInJob('adapter-tests', 'ioBroker/testing-action-adapter', 1, ['node-version', 'os']);
    checkActionInJob('deploy', 'ioBroker/testing-action-deploy', 1, ['node-version', 'github-token']);

    // Проверяем матрицу Node.js — отсутствие матрицы — FAIL
    if (jobs['adapter-tests']) {
        const strategy = jobs['adapter-tests'].strategy;
        if (!strategy || !strategy.matrix) {
            failed = true;
            console.error('test-and-release.yml: job "adapter-tests" не имеет strategy.matrix — обязательна для тестирования на múltiples версиях.');
        } else {
            const matrix = strategy.matrix;
            const nodeVersions = matrix['node-version'];
            if (!Array.isArray(nodeVersions)) {
                failed = true;
                console.error(`test-and-release.yml: job "adapter-tests": matrix['node-version'] должен быть массивом, получен: ${typeof nodeVersions}.`);
            } else {
                const requiredNodeVersions = ['22', '24', '26'];
                const missingNode = requiredNodeVersions.filter(v => !nodeVersions.includes(v));
                if (missingNode.length > 0) {
                    failed = true;
                    console.error(`test-and-release.yml: job "adapter-tests": неполная матрица Node.js, отсутствуют версии: ${missingNode.join(', ')}.`);
                }
            }
            const osList = matrix.os;
            if (!Array.isArray(osList)) {
                failed = true;
                console.error(`test-and-release.yml: job "adapter-tests": matrix['os'] должен быть массивом, получен: ${typeof osList}.`);
            } else {
                const requiredOS = ['ubuntu-latest', 'windows-latest', 'macos-latest'];
                const missingOS = requiredOS.filter(v => !osList.includes(v));
                if (missingOS.length > 0) {
                    failed = true;
                    console.error(`test-and-release.yml: job "adapter-tests": неполная матрица OS, отсутствуют: ${missingOS.join(', ')}.`);
                }
            }
        }
    } else {
        failed = true;
        console.error('test-and-release.yml: отсутствует job "adapter-tests" с матрицей тестирования.');
    }

    // Проверяем условия deploy (только по тегам)
    if (jobs['deploy']) {
        const ifCondition = jobs['deploy'].if;
        if (!ifCondition || !ifCondition.includes('refs/tags')) {
            failed = true;
            console.error('test-and-release.yml: job "deploy" не имеет условия запуска только по релизным тегам.');
        }
    }

    // Проверяем отсутствие прямого npm publish
    for (const [jobName, job] of Object.entries(jobs)) {
        const steps = job.steps || [];
        for (const step of steps) {
            if (step.run && /npm publish/.test(step.run)) {
                failed = true;
                console.error(`test-and-release.yml: job "${jobName}" содержит прямой вызов "npm publish". Используйте ioBroker/testing-action-deploy@v1.`);
            }
        }
    }
}

// 10. SKILL.md не требует обязательных DEVELOPMENT_NOTES.md после каждого этапа
const skillContent = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
if (skillContent.includes('обязательно') && skillContent.includes('DEVELOPMENT_NOTES.md') && skillContent.includes('каждом этапе')) {
    failed = true;
    console.error('SKILL.md всё ещё требует обязательных DEVELOPMENT_NOTES.md после каждого этапа');
}

// 11. Все 11 языков в политике переводов
const requiredLangs = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];
const langPolicyFiles = ['SKILL.md', 'workflows/05-admin-ui.md', 'references/admin-config.md', 'references/official-sources.md'];
for (const f of langPolicyFiles) {
    const fPath = path.join(root, f);
    if (!fs.existsSync(fPath)) continue;
    const content = fs.readFileSync(fPath, 'utf8');
    for (const lang of requiredLangs) {
        if (!content.includes(lang)) {
            failed = true;
            console.error(`Язык ${lang} отсутствует в политике переводов в ${f}`);
        }
    }
}

// 12. Нет инструкций, противоречащих друг другу — все repochecker вызовы используют URL
for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const repocheckerMatches = content.matchAll(/npx\s+--yes\s+@iobroker\/repochecker(?:@latest)?\s+/g);
    for (const match of repocheckerMatches) {
        const afterMatch = content.slice(match.index + match[0].length);
        if (!afterMatch.trimStart().startsWith('https://github.com/')) {
            failed = true;
            console.error(`repochecker вызов без URL сразу после команды в ${path.relative(root, file)}`);
        }
    }
}

// 13. check-translations.mjs вызывается в run-adapter-checks.sh с --mode=new
const runChecksContent = fs.readFileSync(path.join(root, 'scripts/run-adapter-checks.sh'), 'utf8');
if (!/check-translations\.mjs.*--mode=new/.test(runChecksContent)) {
    failed = true;
    console.error('scripts/run-adapter-checks.sh не вызывает scripts/check-translations.mjs с --mode=new');
}

// 14. release-preflight.mjs корректно обрабатывает npm-publish.yml только для custom-approved
// (проверка уже встроена в release-preflight.mjs itself)

// 15. Определение режима локализации не использует Git history, возраст или число коммитов
for (const forbidden of ['git log', 'commitCount', 'rev-list', 'git rev-parse']) {
    if (translationsContent.includes(forbidden)) {
        failed = true;
        console.error(`scripts/check-translations.mjs использует ненадёжное определение режима через "${forbidden}".`);
    }
}
if (/const\s+MODE\s*=/.test(translationsContent)) {
    failed = true;
    console.error('scripts/check-translations.mjs содержит глобальную константу MODE вместо единого context.');
}

// 16. check-translations.mjs использует единый context и поддерживает все форматы Admin i18n
if (!translationsContent.includes('context.strict') || !translationsContent.includes('context.mode')) {
    failed = true;
    console.error('scripts/check-translations.mjs не использует единый context для режима и строгости.');
}
for (const requiredPath of ['admin/src/i18n', 'src/locales', 'src/i18n', 'admin/i18n']) {
    if (!translationsContent.includes(requiredPath)) {
        failed = true;
        console.error(`scripts/check-translations.mjs не поддерживает путь Admin i18n: ${requiredPath}`);
    }
}
if (!/translations\.json/.test(translationsContent) || !/мигрируйте/i.test(translationsContent)) {
    failed = true;
    console.error('scripts/check-translations.mjs не распознаёт legacy HTML i18n с сообщением о миграции.');
}

// 17. Обязательные регрессионные фикстуры существуют
const requiredFixtures = [
    'test/fixtures/translations/react-complete',
    'test/fixtures/translations/react-missing-namespace-file',
    'test/fixtures/translations/react-missing-namespace-key',
    'test/fixtures/translations/react-empty-directory',
    'test/fixtures/translations/react-empty-value',
    'test/fixtures/translations/react-multi-namespace',
    'test/fixtures/translations/react-full',
    'test/fixtures/translations/react-empty-namespace-object',
    'test/fixtures/translations/react-invalid-value',
    'test/fixtures/translations/missing-en',
    'test/fixtures/translations/auto-undeterminable',
    'test/fixtures/release/missing-check-action',
    'test/fixtures/release/deploy-unsafe-or-branch',
    'test/fixtures/release/deploy-negated-contains',
    'test/fixtures/release/deploy-official-condition'
];
for (const fixture of requiredFixtures) {
    if (!fs.existsSync(path.join(root, fixture))) {
        failed = true;
        console.error(`Отсутствует обязательная регрессионная фикстура: ${fixture}`);
    }
}

// 18. Регрессионные тесты не зависят от оставленных вручную файлов вне репозитория
const regressionSource = fs.readFileSync(path.join(root, 'test/run-regression-tests.mjs'), 'utf8');
if (regressionSource.includes('/tmp/test-auto-undeterminable')) {
    failed = true;
    console.error('test/run-regression-tests.mjs зависит от временного пути /tmp/test-auto-undeterminable вместо фикстуры в репозитории.');
}
for (const requiredScenario of [
    '20 Git-коммит',
    'react-missing-namespace-file',
    'react-missing-namespace-key',
    'react-empty-namespace-object',
    'deploy-unsafe-or-branch',
    'deploy-negated-contains',
    'missing-check-action'
]) {
    if (!regressionSource.includes(requiredScenario)) {
        failed = true;
        console.error(`В регрессионных тестах отсутствует сценарий: ${requiredScenario}`);
    }
}

// 19. release-preflight.mjs проверяет Action внутри существующей job и небезопасные OR/ветки deploy
const releaseContent = fs.readFileSync(path.join(root, 'scripts/release-preflight.mjs'), 'utf8');
for (const requiredCheck of ['не найден в существующей job', 'refs/heads', 'unsafeOperands', 'negatedTagGuardPatterns']) {
    if (!releaseContent.includes(requiredCheck)) {
        failed = true;
        console.error(`scripts/release-preflight.mjs не содержит защиту: ${requiredCheck}`);
    }
}

// 20. check-translations.mjs отдельно проверяет пустые namespace-файлы и нестроковые значения
for (const requiredCheck of ['не содержит строковых переводов', 'не является строкой']) {
    if (!translationsContent.includes(requiredCheck)) {
        failed = true;
        console.error(`scripts/check-translations.mjs не содержит проверку: ${requiredCheck}`);
    }
}

if (failed) process.exit(1);
console.log(`Skill validation passed. ${required.length} required files found; ${markdownFiles.length} Markdown files scanned.`);
