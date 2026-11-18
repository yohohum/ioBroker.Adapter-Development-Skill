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
// Исключаем self-match: не проверяем содержимое этого файла自身
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

// 4. Нет вызовов repochecker без URL (исключая сам этот скрипт и строки с упоминанием URL в тексте)
const repocheckerNoUrlPattern = /npx\s+--yes\s+@iobroker\/repochecker(?:@latest)?\s+(?!https:\/\/github\.com\/)(?!$)/;
for (const file of markdownFiles.concat(nodeFiles.map(f => path.join(root, f)))) {
    const relPath = path.relative(root, file);
    if (skipFiles.has(relPath) || !fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    // Исключаем строки, где repochecker упоминается в тексте без вызова (например, в описании)
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

// 6. Нет устаревших упоминаний Admin3
for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (/\badmin3\b/i.test(content)) {
        failed = true;
        console.error(`Устаревшее упоминание Admin3 в ${path.relative(root, file)}`);
    }
}

// 7. Нет упоминания admin/i18n/*/translations.json как универсального пути
for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('admin/i18n/*/translations.json') && !content.includes('устаревший')) {
        failed = true;
        console.error(`Устаревший путь admin/i18n/*/translations.json без пометки об устаревании в ${path.relative(root, file)}`);
    }
}

// 8. test-and-release.yml содержит необходимые jobs и зависимости
const testReleaseContent = fs.readFileSync(path.join(root, 'templates/github-actions/test-and-release.yml'), 'utf8');
const requiredJobs = ['check-and-lint', 'adapter-tests', 'deploy'];
for (const job of requiredJobs) {
    if (!new RegExp(`^  ${job}:`, 'm').test(testReleaseContent)) {
        failed = true;
        console.error(`test-and-release.yml: отсутствует job ${job}`);
    }
}
if (!/needs:\s*\[.*check-and-lint.*\]/m.test(testReleaseContent)) {
    failed = true;
    console.error('test-and-release.yml: job adapter-tests не зависит от check-and-lint (needs)');
}
if (!/needs:\s*\[.*adapter-tests.*\]/m.test(testReleaseContent)) {
    failed = true;
    console.error('test-and-release.yml: job deploy не зависит от adapter-tests (needs)');
}
if (!/ioBroker\/testing-action-check@v1/.test(testReleaseContent)) {
    failed = true;
    console.error('test-and-release.yml: не используется ioBroker/testing-action-check@v1');
}
if (!/ioBroker\/testing-action-adapter@v1/.test(testReleaseContent)) {
    failed = true;
    console.error('test-and-release.yml: не используется ioBroker/testing-action-adapter@v1');
}
if (!/ioBroker\/testing-action-deploy@v1/.test(testReleaseContent)) {
    failed = true;
    console.error('test-and-release.yml: не используется ioBroker/testing-action-deploy@v1');
}

// 9. SKILL.md не требует обязательных DEVELOPMENT_NOTES.md после каждого этапа
const skillContent = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
if (skillContent.includes('обязательно') && skillContent.includes('DEVELOPMENT_NOTES.md') && skillContent.includes('каждом этапе')) {
    failed = true;
    console.error('SKILL.md всё ещё требует обязательных DEVELOPMENT_NOTES.md после каждого этапа');
}

// 10. Все 11 языков в политике переводов
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

// 11. Нет инструкций, противоречащих друг другу в SKILL.md, workflows и references
// Проверяем, что все repochecker вызовы используют URL
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

if (failed) process.exit(1);
console.log(`Skill validation passed. ${required.length} required files found; ${markdownFiles.length} Markdown files scanned.`);
