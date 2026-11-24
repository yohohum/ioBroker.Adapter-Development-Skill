#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { validatePublishWorkflow, validateWorkflowActions, validateWorkflowFile } from './lib/publish-workflow.mjs';
import { validateDeployCondition } from './lib/deploy-condition.mjs';
import { OFFICIAL_ACTIONS } from './lib/action-refs.mjs';

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
    'scripts/lib/action-refs.mjs', 'scripts/lib/deploy-condition.mjs', 'scripts/lib/publish-workflow.mjs',
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
    'scripts/lib/action-refs.mjs', 'scripts/lib/deploy-condition.mjs', 'scripts/lib/publish-workflow.mjs',
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
const bashPath = spawnSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' });
if (bashPath.status === 0) {
    const bash = spawnSync('bash', ['-n', path.join(root, 'scripts/run-adapter-checks.sh')], { encoding: 'utf8' });
    if (bash.status !== 0) {
        failed = true;
        console.error(`Shell syntax error:\n${bash.stderr || bash.stdout}`);
    }
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
for (const workflowPath of ['.github/workflows/validate-skill.yml', 'templates/github-actions/adapter-ci.yml', 'templates/github-actions/test-and-release.yml']) {
    try {
        const actions = validateWorkflowFile(path.join(root, workflowPath), { root, requireIoBrokerActions: workflowPath.includes('test-and-release') });
        if (actions.errors.length) {
            failed = true;
            for (const error of actions.errors) console.error(error);
        }
    } catch (error) {
        failed = true;
        console.error(`Не удалось проверить Actions в ${workflowPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// Прочие YAML/JSON workflow fixtures также валидируются, за исключением
// специально некорректной фикстуры invalid-yaml, которую проверяют тесты.
function scanFixtureFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scanFixtureFiles(full);
        else if (entry.isFile() && /\.ya?ml$/i.test(entry.name) && !full.includes(`${path.sep}invalid-yaml${path.sep}`)) {
            try { loadYaml(fs.readFileSync(full, 'utf8')); }
            catch (error) {
                failed = true;
                console.error(`Invalid fixture YAML in ${path.relative(root, full)}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}
scanFixtureFiles(path.join(root, 'test/fixtures'));

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
        if (line.includes('npm-publish.yml') && !/(не\s+использу|НЕ\s+использу|не\s+утвержда|НЕ\s+утвержда|не\s+поддержива|НЕ\s+поддержива|not\s+use|does\s+not\s+approve|not\s+supported|не\s+создава|НЕ\s+создава|do\s+not\s+create)/i.test(line)) {
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

// 9. test-and-release.yml проверяется общим валидатором (те же правила, что в release-preflight)
// Зафиксировать единое использование строгого валидатора deploy condition.
const deployValidatorSource = fs.readFileSync(path.join(root, 'scripts/lib/deploy-condition.mjs'), 'utf8');
if (typeof validateDeployCondition !== 'function' ||
    !fs.readFileSync(path.join(root, 'scripts/release-preflight.mjs'), 'utf8').includes('validatePublishWorkflow') ||
    !fs.readFileSync(path.join(root, 'scripts/lib/publish-workflow.mjs'), 'utf8').includes('validateDeployCondition')) {
    failed = true;
    console.error('release-preflight и validate-skill должны использовать общий валидатор deploy condition через publish-workflow.');
}
if (!deployValidatorSource.includes('matchesOfficialDeployCondition') ||
    !deployValidatorSource.includes('refs/tags/v') ||
    !deployValidatorSource.includes('FORBIDDEN_STATUS_FUNCTIONS')) {
    failed = true;
    console.error('Общий валидатор deploy condition не содержит структурную проверку официальной схемы и status-check функций.');
}
const actionPolicySource = fs.readFileSync(path.join(root, 'scripts/lib/action-refs.mjs'), 'utf8');
if (!actionPolicySource.includes('validateWorkflowActions') ||
    !actionPolicySource.includes('validateRequiredActions') ||
    !['actions/checkout', 'actions/setup-node', 'ioBroker/testing-action-check', 'ioBroker/testing-action-adapter', 'ioBroker/testing-action-deploy'].every((name) => OFFICIAL_ACTIONS.some((item) => item.name === name))) {
    failed = true;
    console.error('Централизованная политика не содержит все Actions официального шаблона или общий workflow validator.');
}
const testReleasePath = path.join(root, 'templates/github-actions/test-and-release.yml');
let testReleaseYaml;
try {
    testReleaseYaml = loadYaml(fs.readFileSync(testReleasePath, 'utf8'));
} catch (_e) {
    testReleaseYaml = null;
}

// Оба README должны содержать один canonical file tree.
const readmeTree = (name) => {
    const content = fs.readFileSync(path.join(root, name), 'utf8');
    const match = content.match(/## Structure\s*\n\n```text\n([\s\S]*?)\n```/);
    if (!match) return null;
    return match[1].split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
};
const englishTree = readmeTree('README.en.md');
const russianTree = (() => {
    const content = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    const match = content.match(/## Структура\s*\n\n```text\n([\s\S]*?)\n```/);
    return match ? match[1].split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim()) : null;
})();
if (!englishTree || !russianTree || JSON.stringify(englishTree) !== JSON.stringify(russianTree)) {
    failed = true;
    console.error('README.md и README.en.md должны содержать согласованное file tree.');
} else {
    const knownFiles = new Set([
        'SKILL.md', 'README.md', 'README.en.md', 'CONTRIBUTING.md', 'LICENSE', '.editorconfig', '.gitignore',
        '.github/workflows/validate-skill.yml',
        'references/official-sources.md', 'references/object-model.md', 'references/security.md', 'references/transports.md', 'references/admin-config.md', 'references/testing.md', 'references/release-and-repository.md',
        'workflows/01-discovery.md', 'workflows/02-scaffolding.md', 'workflows/03-architecture.md', 'workflows/04-implementation.md', 'workflows/05-admin-ui.md', 'workflows/06-debugging.md', 'workflows/07-testing.md', 'workflows/08-release-gate.md', 'workflows/09-release.md',
        'scripts/adapter-preflight.mjs', 'scripts/check-object-dump.mjs', 'scripts/check-translations.mjs', 'scripts/release-preflight.mjs', 'scripts/run-adapter-checks.sh', 'scripts/validate-skill.mjs',
        'scripts/lib/action-refs.mjs', 'scripts/lib/deploy-condition.mjs', 'scripts/lib/publish-workflow.mjs',
        'templates/adapter-tests/testPackageFiles.cjs', 'templates/adapter-tests/testAdapter.integration.cjs', 'templates/changelog/CHANGELOG_OLD.md', 'templates/changelog/README-changelog-section.md', 'templates/release/releaseconfig.json', 'templates/github-actions/adapter-ci.yml', 'templates/github-actions/test-and-release.yml',
        'test/run-regression-tests.mjs'
    ]);
    const directories = [];
    const listedFiles = new Set();
    for (const line of englishTree) {
        if (line === '.') continue;
        const match = line.match(/^([│ ]*)(?:├──|└──)\s+(.+)$/);
        if (!match) continue;
        const depth = Math.floor(match[1].length / 4);
        const name = match[2];
        directories.length = depth;
        const relative = path.posix.join(...directories, name.replace(/\/$/, ''));
        if (name.endsWith('/')) {
            directories.push(name.slice(0, -1));
            continue;
        }
        listedFiles.add(relative);
        if (!knownFiles.has(relative)) {
            failed = true;
            console.error(`README file tree contains an unregistered path: ${relative}`);
        } else if (!fs.existsSync(path.join(root, relative))) {
            failed = true;
            console.error(`README file tree references missing file: ${relative}`);
        }
    }
    for (const expected of knownFiles) {
        if (!listedFiles.has(expected)) {
            failed = true;
            console.error(`README file tree omits required path: ${expected}`);
        }
    }
}

if (!testReleaseYaml) {
    failed = true;
    console.error('test-and-release.yml: не удалось распарсить YAML.');
} else {
    const result = validatePublishWorkflow(testReleaseYaml.jobs || {}, { wfName: 'test-and-release.yml' });
    for (const error of result.errors) {
        failed = true;
        console.error(error);
    }
    for (const review of result.reviews) {
        failed = true;
        console.error(`test-and-release.yml: NEEDS REVIEW: ${review}`);
    }
    for (const warning of result.warnings) {
        console.warn(`WARN  ${warning}`);
    }
}

// README code fences contain the canonical package scripts and executable paths.
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const readme of ['README.md', 'README.en.md']) {
    const content = fs.readFileSync(path.join(root, readme), 'utf8');
    const codeFences = [...content.matchAll(/```(?:bash|sh)\s*\n([\s\S]*?)```/g)].map((match) => match[1]);
    for (const block of codeFences) {
        for (const match of block.matchAll(/\bnpm\s+(?:run\s+)?([a-zA-Z0-9:_-]+)/g)) {
            const scriptName = match[1];
            if (['ci', 'install', 'test', 'start', 'publish', 'init', 'add', 'commit', 'branch', 'remote', 'push', 'run'].includes(scriptName)) continue;
            if (!Object.hasOwn(packageJson.scripts ?? {}, scriptName)) {
                failed = true;
                console.error(`${readme}: npm script "${scriptName}" из code block отсутствует в package.json.`);
            }
        }
        for (const match of block.matchAll(/(?:bash|node)\s+(\/path\/to\/skill\/)?([\w./-]+\.(?:sh|mjs|js))/g)) {
            const scriptPath = match[2];
            if (scriptPath.startsWith('/path/to/skill/')) continue;
            if (!fs.existsSync(path.join(root, scriptPath))) {
                failed = true;
                console.error(`${readme}: script "${scriptPath}" из code block не существует.`);
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

// 14. custom-approved не является обходом стандартного release workflow:
// release-preflight проверяет тот же test-and-release.yml и отклоняет npm-publish.yml.

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
    'test/fixtures/release/deploy-unsafe-or-branch'
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

// 19. Общие правила версий Actions и deploy condition вызываются release-preflight
// и validate-skill через publish-workflow; проверяем модульный контракт и отсутствие
// старого локального поиска refs/tags в обоих вызывающих скриптах.
const releaseContent = fs.readFileSync(path.join(root, 'scripts/release-preflight.mjs'), 'utf8');
if (!releaseContent.includes("'./lib/publish-workflow.mjs'") ||
    !fs.readFileSync(path.join(root, 'scripts/lib/publish-workflow.mjs'), 'utf8').includes('validateRequiredActions') ||
    !fs.readFileSync(path.join(root, 'scripts/lib/publish-workflow.mjs'), 'utf8').includes('validateDeployCondition') ||
    /ifCondition\.includes\(['"]refs\/tags['"]\)/.test(releaseContent + fs.readFileSync(path.join(root, 'scripts/validate-skill.mjs'), 'utf8'))) {
    failed = true;
    console.error('Проверка публикации должна выполняться общими валидаторами Action refs и deploy condition.');
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
