#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const SKILL_ROOT = path.resolve(ROOT, '..');
const TESTS_DIR = path.join(ROOT, 'fixtures');

let passed = 0;
let failed = 0;
let skipped = 0;

function runCommand(cmd, args, cwd) {
    const result = spawnSync(cmd, args, { cwd: cwd || ROOT, encoding: 'utf8', timeout: 60000 });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL: ${name} — ${e.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg}: expected ${expected}, got ${actual}`);
    }
}

function assertContains(haystack, needle, msg) {
    if (!haystack.includes(needle)) {
        throw new Error(`${msg}: expected to contain "${needle}"`);
    }
}

function assertNotContains(haystack, needle, msg) {
    if (haystack.includes(needle)) {
        throw new Error(`${msg}: expected NOT to contain "${needle}"`);
    }
}

function assertExitCode(result, expectedCode, msg) {
    if (result.code !== expectedCode) {
        throw new Error(`${msg}: expected exit code ${expectedCode}, got ${result.code}. stdout: ${result.stdout}. stderr: ${result.stderr}`);
    }
}

console.log('=== Регрессионные тесты translations ===\n');

// --- Тесты переводов ---

// 1. Полностью переведённый новый адаптер — PASS
test('1. Полностью переведённый новый адаптер — PASS', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), path.join(TESTS_DIR, 'translations/full'), '--mode=new']);
    assertExitCode(result, 0, 'Полностью переведённый адаптер должен пройти');
});

// 2. Только title, без titleLang — FAIL
test('2. Только title, без titleLang — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), path.join(TESTS_DIR, 'translations/no-titlelang'), '--mode=new']);
    assertExitCode(result, 1, 'Отсутствие titleLang должно быть ошибкой');
    assertContains(result.stdout + result.stderr, 'titleLang', 'Сообщение должно упоминать titleLang');
});

// 3. Отсутствует один из 11 языков — FAIL
test('3. Отсутствует один из 11 языков — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), path.join(TESTS_DIR, 'translations/missing-lang'), '--mode=new']);
    assertExitCode(result, 1, 'Отсутствующий язык должен быть ошибкой');
    assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

// 4. Пустой desc — FAIL
test('4. Пустой desc — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), path.join(TESTS_DIR, 'translations/empty-desc'), '--mode=new']);
    assertExitCode(result, 1, 'Пустой desc должен быть ошибкой');
});

// 5. Неполный news — FAIL
test('5. Неполный news (отсутствует zh-cn) — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), path.join(TESTS_DIR, 'translations/missing-lang'), '--mode=new']);
    assertExitCode(result, 1, 'Отсутствующий перевод в news должен быть ошибкой');
});

// 6. Отсутствует обязательный ключ jsonConfig — FAIL
test('6. jsonConfig без переводов zh-cn — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), path.join(TESTS_DIR, 'translations/missing-jsonconfig'), '--mode=new']);
    assertExitCode(result, 1, 'Отсутствующие переводы в jsonConfig должны быть ошибкой');
    assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

// 7. JSON5 с URL и одинарными кавычками — PASS
test('7. JSON5 с URL и одинарными кавычками — PASS', () => {
    const result = runCommand('node', ['-e', `
        import JSON5 from 'json5';
        const fs = await import('node:fs');
        const text = fs.readFileSync('${path.join(TESTS_DIR, 'translations/json5-valid/config.json5')}', 'utf8');
        const data = JSON5.parse(text);
        console.log(JSON.stringify(data));
    `], SKILL_ROOT);
    assertExitCode(result, 0, 'JSON5 с URL должен парситься');
    assertContains(result.stdout, 'https://example.com', 'URL должен сохраниться');
});

// 8. Некорректный JSON5 — FAIL
test('8. Некорректный JSON5 — FAIL', () => {
    const result = runCommand('node', ['-e', `
        import JSON5 from 'json5';
        const fs = await import('node:fs');
        const text = fs.readFileSync('${path.join(TESTS_DIR, 'translations/json5-invalid/config.json5')}', 'utf8');
        try {
            JSON5.parse(text);
            console.log('PARSED (should not happen)');
            process.exit(0);
        } catch (e) {
            console.log('REJECTED');
            process.exit(1);
        }
    `], SKILL_ROOT);
    assertExitCode(result, 1, 'Некорректный JSON5 должен отклоняться');
});

// 9. React-only без jsonConfig, переводы полные — PASS
test('9. React-only без jsonConfig, переводы полные — PASS', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), path.join(TESTS_DIR, 'translations/react-only-full'), '--mode=new']);
    assertExitCode(result, 0, 'React-only с полными переводами должен пройти');
});

// 10. React-only с отсутствующим языком — FAIL
test('10. React-only с отсутствующим языком — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), path.join(TESTS_DIR, 'translations/react-only-missing-lang'), '--mode=new']);
    assertExitCode(result, 1, 'Отсутствующий язык в React должен быть ошибкой');
    assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

// 11. React с отсутствующим вложенным ключом — FAIL
test('11. HTML i18n с отсутствующим ресурсом — FAIL', () => {
    // HTML i18n test would need a fixture with admin/i18n directory
    // For now, skip if not available
    const htmlDir = path.join(TESTS_DIR, 'translations/html-i18n-missing');
    if (!fs.existsSync(htmlDir)) {
        console.log(`  SKIP: HTML i18n fixture не найден`);
        skipped++;
        return;
    }
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), htmlDir, '--mode=new']);
    assertExitCode(result, 1, 'Отсутствующий HTML i18n ресурс должен быть ошибкой');
});

console.log('\n=== Регрессионные тесты release-preflight ===\n');

// --- Тесты release-preflight ---

// 12. Корректный официальный workflow — PASS
test('12. Корректный официальный workflow — PASS', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/correct'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 0, 'Корректный workflow должен пройти');
});

// 13. Отсутствует node-version в check-action — FAIL
test('13. Отсутствует node-version в check-action — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/missing-node-version'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Отсутствие node-version должно быть ошибкой');
    assertContains(result.stdout + result.stderr, 'node-version', 'Сообщение должно упоминать node-version');
});

// 14. Отсутствует os в adapter action — FAIL
test('14. Отсутствует os в adapter action — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/missing-os'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Отсутствие os должно быть ошибкой');
    assertContains(result.stdout + result.stderr, 'os', 'Сообщение должно упоминать os');
});

// 15. Неправильная версия Action — FAIL
test('15. Неправильная версия Action (@v1 вместо @v2) — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/wrong-action-version'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Неправильная версия Action должна быть ошибкой');
});

// 16. Неполная Node.js matrix — FAIL
test('16. Неполная Node.js matrix — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/incomplete-matrix'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Неполная матрица Node.js должна быть ошибкой');
});

// 17. Неполная OS matrix — FAIL
test('17. Неполная OS matrix — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/incomplete-os-matrix'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Неполная матрица OS должна быть ошибкой');
});

// 18. Deploy без обязательных needs — FAIL
test('18. Deploy без обязательных needs — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/deploy-without-needs'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Deploy без needs должен быть ошибкой');
    assertContains(result.stdout + result.stderr, 'задач', 'Сообщение должно упоминать задачи');
});

// 19. Deploy без условия тега — FAIL
test('19. Deploy без условия тега — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/deploy-no-tag-condition'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Deploy без условия тега должен быть ошибкой');
});

// 20. Ручной npm publish — FAIL
test('20. Ручной npm publish — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/manual-npm-publish'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Ручной npm publish должен быть ошибкой');
    assertContains(result.stdout + result.stderr, 'npm publish', 'Сообщение должно упоминать npm publish');
});

// 21. Некорректный YAML — FAIL
test('21. Некорректный YAML — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/invalid-yaml'), '--profile=create-adapter-default']);
    assertExitCode(result, 1, 'Некорректный YAML должен быть ошибкой');
});

// 22. Неизвестный профиль — FAIL
test('22. Неизвестный профиль — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), path.join(TESTS_DIR, 'release/correct'), '--profile=unknown-profile']);
    assertExitCode(result, 1, 'Неизвестный профиль должен быть ошибкой');
});

console.log('\n=== Итог ===');
console.log(`  Пройдено: ${passed}`);
console.log(`  Провалено: ${failed}`);
console.log(`  Пропущено: ${skipped}`);
if (failed > 0) {
    process.exit(1);
}
console.log('\nВсе тесты пройдены!');
