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

function requireFixture(relativePath) {
  const fullPath = path.join(TESTS_DIR, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Отсутствует обязательная фикстура: ${relativePath}`);
  }
  return fullPath;
}

console.log('=== Регрессионные тесты translations ===\n');

// --- Тесты переводов ---

// 1. Полностью переведённый новый адаптер — PASS
test('1. Полностью переведённый новый адаптер — PASS', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/full'), '--mode=new']);
  assertExitCode(result, 0, 'Полностью переведённый адаптер должен пройти');
});

// 2. Нет titleLang, но есть title — FAIL
test('2. Нет titleLang, но есть title — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/no-titlelang'), '--mode=new']);
  assertExitCode(result, 1, 'Отсутствие titleLang должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'titleLang', 'Сообщение должно упоминать titleLang');
});

// 3. Нет en — FAIL
test('3. Нет en — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/missing-en'), '--mode=new']);
    assertExitCode(result, 1, 'Отсутствующий язык должен быть ошибкой');
    assertContains(result.stdout + result.stderr, 'en', 'Сообщение должно упоминать отсутствующий язык en');
});

// 4. Нет zh-cn — FAIL
test('4. Нет zh-cn — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/missing-lang'), '--mode=new']);
  assertExitCode(result, 1, 'Отсутствующий язык должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

// 5. Нет desc — FAIL
test('5. Нет desc — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/no-desc'), '--mode=new']);
  assertExitCode(result, 1, 'Отсутствие desc должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'common.desc', 'Сообщение должно упоминать common.desc');
});

// 6. Нет записи news — FAIL
test('6. Нет записи news — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/missing-news'), '--mode=new']);
  assertExitCode(result, 1, 'Отсутствие news должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'common.news', 'Сообщение должно упоминать common.news');
});

// 7. JSON5 с https:// через check-translations.mjs — PASS
test('7. JSON5 с https:// через check-translations.mjs — PASS', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/json5-valid'), '--mode=new']);
  assertExitCode(result, 0, 'JSON5 с URL должен пройти через check-translations.mjs');
});

// 8. Некорректный JSON5 через check-translations.mjs — FAIL
test('8. Некорректный JSON5 через check-translations.mjs — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/json5-invalid'), '--mode=new']);
  assertExitCode(result, 1, 'Некорректный JSON5 должен быть ошибкой через check-translations.mjs');
});

// 9. React-only без jsonConfig, все переводы presentes — PASS
test('9. React-only без jsonConfig, все переводы presentes — PASS', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/react-only-full'), '--mode=new']);
  assertExitCode(result, 0, 'React-only с полными переводами должен пройти');
});

// 10. React с отсутствующим языком — FAIL
test('10. React с отсутствующим языком — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/react-only-missing-lang'), '--mode=new']);
  assertExitCode(result, 1, 'Отсутствующий язык в React должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

// 11. React с пустой языковой директорией — FAIL
test('11. React с пустой языковой директорией — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/react-empty-dir'), '--mode=new']);
  assertExitCode(result, 1, 'Пустая языковая директория в React должна быть ошибкой');
});

// 12. React с двумя namespace, один неполный — FAIL
test('12. React с двумя namespace, один неполный — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/react-multi-ns-incomplete'), '--mode=new']);
  assertExitCode(result, 1, 'Неполный второй namespace в React должен быть ошибкой');
});

// 13. React с пустым вложенным значением — FAIL
test('13. React с пустым вложенным значением — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/react-empty-nested'), '--mode=new']);
  assertExitCode(result, 1, 'Пустое вложенное значение в React должно быть ошибкой');
});

// 14. HTML i18n без одного языка — FAIL
test('14. HTML i18n без одного языка — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/html-i18n-missing-lang'), '--mode=new']);
  assertExitCode(result, 1, 'Отсутствующий язык в HTML i18n должен быть ошибкой');
});

// 15. HTML i18n с неполным набором ключей — FAIL
test('15. HTML i18n с неполным набором ключей — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/html-i18n-missing-keys'), '--mode=new']);
  assertExitCode(result, 1, 'Неполный набор ключей в HTML i18n должен быть ошибкой');
});

// 16. Корректный существующий адаптер — PASS
test('16. Корректный существующий адаптер — PASS', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/existing-valid'), '--mode=existing']);
  assertExitCode(result, 0, 'Корректный существующий адаптер должен пройти в режиме existing');
});

// 17. Авто-режим: titleLang все языки, но нет news — FAIL
test('17. Авто-режим: titleLang все языки, но нет news — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/auto-new-without-news'), '--mode=auto']);
  assertExitCode(result, 1, 'Авто-режим с titleLang все языки, но без news должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'common.news', 'Сообщение должно упоминать common.news');
});

// 18. Существующий адаптер с разрешённым переходным состоянием (titleLang неполный) — PASS
test('18. Существующий адаптер с переходным состоянием — PASS', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/existing-transitional'), '--mode=existing']);
  assertExitCode(result, 0, 'Существующий адаптер с переходным состоянием должен пройти (только предупреждения)');
});

// 19. Авто-режим не может определить режим — NEEDS REVIEW (exit code 2)
test('19. Авто-режим не может определить режим — NEEDS REVIEW', () => {
    const autoUndeterminableDir = '/tmp/test-auto-undeterminable';
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), autoUndeterminableDir, '--mode=auto']);
    assertExitCode(result, 2, 'Авто-режим без возможности определить режим должен быть NEEDS REVIEW (exit 2)');
});

console.log('\n=== Регрессионные тесты translations (дополнительные) ===\n');

// 20. React: namespace отсутствует в zh-cn — FAIL
test('20. React: namespace отсутствует в zh-cn — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/react-multi-ns-incomplete'), '--mode=new']);
    assertExitCode(result, 1, 'Отсутствующий namespace в zh-cn должен быть ошибкой');
    assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
    assertContains(result.stdout + result.stderr, 'settings', 'Сообщение должно упоминать недостающий namespace');
});

// 21. React: namespace присутствует во всех языках — PASS
test('21. React: namespace присутствует во всех языках — PASS', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/full'), '--mode=new']);
    assertExitCode(result, 0, 'React с полными переводами во всех пространствах имён должен пройти');
});

// 22. HTML: flat format — корректная проверка → PASS
test('22. HTML i18n flat format — PASS', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/html-flat-i18n'), '--mode=new']);
    assertExitCode(result, 0, 'HTML i18n в плоском формате должен пройти');
});

// 23. HTML: legacy format — корректная проверка → PASS
test('23. HTML i18n legacy format — PASS', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/html-legacy-i18n'), '--mode=new']);
    assertExitCode(result, 0, 'HTML i18n в legacy формате должен пройти');
});

// 24. HTML: legacy format с отсутствующим переводом → FAIL
test('24. HTML i18n legacy с отсутствующим переводом — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/check-translations.mjs'), requireFixture('translations/html-legacy-incomplete'), '--mode=new']);
    assertExitCode(result, 1, 'HTML i18n legacy с отсутствующим переводом должен быть ошибкой');
    assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать отсутствующий язык zh-cn');
});

console.log('\n=== Регрессионные тесты release-preflight ===\n');

// --- Тесты release-preflight ---

// 17. Корректный официальный workflow — PASS
test('17. Корректный официальный workflow — PASS', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/correct'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 0, 'Корректный workflow должен пройти');
});

// 18. Нет обязательного testing-action-check — FAIL
test('18. Нет обязательного testing-action-check — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/missing-check-action'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Отсутствие testing-action-check должно быть ошибкой');
});

// 19. Отсутствует node-version — FAIL
test('19. Отсутствует node-version — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/missing-node-version'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Отсутствие node-version должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'node-version', 'Сообщение должно упоминать node-version');
});

// 20. Отсутствует os — FAIL
test('20. Отсутствует os — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/missing-os'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Отсутствие os должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'os', 'Сообщение должно упоминать os');
});

// 21. Неправильная версия Action — FAIL
test('21. Неправильная версия Action (@v1 вместо @v2) — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/wrong-action-version'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Неправильная версия Action должна быть ошибкой');
});

// 22. Неполная Node.js matrix — FAIL
test('22. Неполная Node.js matrix — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/incomplete-matrix'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Неполная матрица Node.js должна быть ошибкой');
});

// 23. Неполная OS matrix — FAIL
test('23. Неполная OS matrix — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/incomplete-os-matrix'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Неполная матрица OS должна быть ошибкой');
});

// 24. Deploy без обязательных needs — FAIL
test('24. Deploy без обязательных needs — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/deploy-without-needs'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Deploy без needs должен быть ошибкой');
});

// 25. Deploy без условия тега — FAIL
test('25. Deploy без условия тега — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/deploy-no-tag-condition'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Deploy без условия тега должен быть ошибкой');
});

// 26. Ручной npm publish — FAIL
test('26. Ручной npm publish — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/manual-npm-publish'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Ручной npm publish должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'npm publish', 'Сообщение должно упоминать npm publish');
});

// 27. Некорректный YAML — FAIL
test('27. Некорректный YAML — FAIL', () => {
  const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/invalid-yaml'), '--profile=create-adapter-default', '--no-git-check']);
  assertExitCode(result, 1, 'Некорректный YAML должен быть ошибкой');
});

// 28. Неизвестный профиль — FAIL
test('28. Неизвестный профиль — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/correct'), '--profile=unknown-profile', '--no-git-check']);
    assertExitCode(result, 1, 'Неизвестный профиль должен быть ошибкой');
});

// 29. Существующая job без обязательного Action — FAIL
test('29. Существующая job без обязательного Action — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/missing-check-action'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Отсутствие обязательного Action в существующей job должно быть ошибкой');
    assertContains(result.stdout + result.stderr, 'не найден', 'Сообщение должно упоминать отсутствие Action');
});

// 30. Существующая job с неполными inputs — FAIL
test('30. Существующая job с неполными inputs — FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/missing-action-inputs'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Отсутствие обязательных inputs в Action должно быть ошибкой');
    assertContains(result.stdout + result.stderr, 'node-version', 'Сообщение должно упоминать отсутствующий input');
});

// 31. Deploy с always() обходом тестов → FAIL
test('31. Deploy с always() обходом тестов → FAIL', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/deploy-always-or-tag'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 1, 'Deploy с always() в условии должен быть ошибкой');
    assertContains(result.stdout + result.stderr, 'always()', 'Сообщение должно упоминать always()');
});

// 32. Корректное официальное условие deploy → PASS
test('32. Корректное официальное условие deploy → PASS', () => {
    const result = runCommand('node', [path.join(SKILL_ROOT, 'scripts/release-preflight.mjs'), requireFixture('release/correct-deploy-condition'), '--profile=create-adapter-default', '--no-git-check']);
    assertExitCode(result, 0, 'Корректное условие deploy должно пройти');
});

console.log('\n=== Итог ===');
console.log(`  Пройдено: ${passed}`);
console.log(`  Провалено: ${failed}`);
if (failed > 0) {
    process.exit(1);
}
console.log('\nВсе тесты пройдены!');
