#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { readVerifiedText, validateWorkflowActions, validateWorkflowFile } from '../scripts/lib/action-refs.mjs';

const TEST_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const SKILL_ROOT = path.resolve(TEST_ROOT, '..');
const FIXTURES_DIR = path.join(TEST_ROOT, 'fixtures');
const CHECK_TRANSLATIONS = path.join(SKILL_ROOT, 'scripts/check-translations.mjs');
const RELEASE_PREFLIGHT = path.join(SKILL_ROOT, 'scripts/release-preflight.mjs');

const testStats = createTestStats();

function runCommand(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd: cwd || TEST_ROOT, encoding: 'utf8', timeout: 120000 });
  if (result.error) {
    throw new Error(`Не удалось запустить ${cmd}: ${result.error.message}`);
  }
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function executeTest(fn) {
  try {
    const outcome = fn();
    if (outcome?.status === 'SKIP') return { status: 'SKIP', reason: outcome.reason || 'причина не указана' };
    return { status: 'PASS' };
  } catch (error) {
    return { status: 'FAIL', reason: error instanceof Error ? error.message : String(error) };
  }
}

function createTestStats() {
  return { total: 0, passed: 0, failed: 0, skipped: 0 };
}

function recordTest(stats, result) {
  stats.total++;
  if (result.status === 'PASS') stats.passed++;
  else if (result.status === 'FAIL') stats.failed++;
  else if (result.status === 'SKIP') stats.skipped++;
  else throw new Error(`Unknown test status: ${result.status}`);
}

function testExitCode(stats) {
  return stats.failed > 0 ? 1 : 0;
}

function formatTestResult(name, result) {
  if (result.status === 'SKIP') return `  SKIP: ${name} — ${result.reason}`;
  if (result.status === 'FAIL') return `  FAIL: ${name} — ${result.reason}`;
  return `  PASS: ${name}`;
}

function test(name, fn) {
  const result = executeTest(fn);
  recordTest(testStats, result);
  console.log(formatTestResult(name, result));
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

function assertContains(haystack, needle, msg) {
  if (!haystack.includes(needle)) throw new Error(`${msg}: expected to contain "${needle}"`);
}

function assertNotContains(haystack, needle, msg) {
  if (haystack.includes(needle)) throw new Error(`${msg}: expected NOT to contain "${needle}"`);
}

function assertExitCode(result, expectedCode, msg) {
  if (result.code !== expectedCode) {
    throw new Error(`${msg}: expected exit code ${expectedCode}, got ${result.code}. stdout: ${result.stdout}. stderr: ${result.stderr}`);
  }
}

function requireFixture(relativePath) {
  const fullPath = path.join(FIXTURES_DIR, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Отсутствует обязательная фикстура: ${relativePath}`);
  return fullPath;
}

function runTranslations(relativeFixture, mode, extraArgs = []) {
  const args = [CHECK_TRANSLATIONS, requireFixture(relativeFixture)];
  if (mode) args.push(`--mode=${mode}`);
  args.push(...extraArgs);
  return runCommand('node', args);
}

function runRelease(relativeFixture, profile = 'create-adapter-default') {
  return runCommand('node', [RELEASE_PREFLIGHT, requireFixture(relativeFixture), `--profile=${profile}`, '--no-git-check']);
}

function runReleaseWithWorkflowMutation(mutate) {
  const source = requireFixture('release/correct');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-release-'));
  fs.cpSync(source, temp, { recursive: true });
  const workflowPath = path.join(temp, '.github/workflows/test-and-release.yml');
  fs.writeFileSync(workflowPath, mutate(fs.readFileSync(workflowPath, 'utf8')));
  try {
    return runCommand('node', [RELEASE_PREFLIGHT, temp, '--profile=create-adapter-default', '--no-git-check']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function createGitFixture(sourceRelative, commitCount = 20) {
  const source = requireFixture(sourceRelative);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-git-'));
  fs.cpSync(source, temp, { recursive: true });
  runCommand('git', ['init', '-q'], temp);
  runCommand('git', ['config', 'user.email', 'test@example.invalid'], temp);
  runCommand('git', ['config', 'user.name', 'Regression Test'], temp);
  for (let index = 0; index < commitCount; index++) {
    fs.writeFileSync(path.join(temp, 'commit-marker.txt'), `${index}\n`);
    runCommand('git', ['add', '.'], temp);
    runCommand('git', ['commit', '-q', '-m', `commit ${index}`], temp);
  }
  return temp;
}

console.log('=== Регрессионные тесты translations ===\n');

test('01. Полностью переведённый новый адаптер — PASS', () => {
  const result = runTranslations('translations/full', 'new');
  assertExitCode(result, 0, 'Полностью переведённый адаптер должен пройти');
});

test('02. Нет titleLang, но есть title — FAIL', () => {
  const result = runTranslations('translations/no-titlelang', 'new');
  assertExitCode(result, 1, 'Отсутствие titleLang должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'titleLang', 'Сообщение должно упоминать titleLang');
});

test('03. Нет английского языка (en) — FAIL', () => {
  const result = runTranslations('translations/missing-en', 'new');
  assertExitCode(result, 1, 'Отсутствующий en должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'обязательные', 'Сообщение должно указывать на обязательный язык');
  assertContains(result.stdout + result.stderr, 'en', 'Сообщение должно упоминать отсутствующий язык en');
});

test('04. Нет zh-cn — FAIL', () => {
  const result = runTranslations('translations/missing-lang', 'new');
  assertExitCode(result, 1, 'Отсутствующий язык должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

test('05. Нет desc — FAIL', () => {
  const result = runTranslations('translations/no-desc', 'new');
  assertExitCode(result, 1, 'Отсутствие desc должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'common.desc', 'Сообщение должно упоминать common.desc');
});

test('06. Нет записи news — FAIL', () => {
  const result = runTranslations('translations/missing-news', 'new');
  assertExitCode(result, 1, 'Отсутствие news должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'common.news', 'Сообщение должно упоминать common.news');
});

test('07. JSON5 с https:// — PASS', () => {
  const result = runTranslations('translations/json5-valid', 'new');
  assertExitCode(result, 0, 'JSON5 с URL должен пройти через check-translations.mjs');
});

test('08. Некорректный JSON5 — FAIL', () => {
  const result = runTranslations('translations/json5-invalid', 'new');
  assertExitCode(result, 1, 'Некорректный JSON5 должен быть ошибкой');
});

test('09. React-only без jsonConfig, полные переводы — PASS', () => {
  const result = runTranslations('translations/react-only-full', 'new');
  assertExitCode(result, 0, 'React-only с полными переводами должен пройти');
});

test('10. React с отсутствующим языком — FAIL', () => {
  const result = runTranslations('translations/react-only-missing-lang', 'new');
  assertExitCode(result, 1, 'Отсутствующий язык в React должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

test('11. React с пустой языковой директорией — FAIL', () => {
  const result = runTranslations('translations/react-empty-dir', 'new');
  assertExitCode(result, 1, 'Пустая языковая директория в React должна быть ошибкой');
});

test('12. React с двумя namespace, один неполный — FAIL', () => {
  const result = runTranslations('translations/react-multi-ns-incomplete', 'new');
  assertExitCode(result, 1, 'Неполный второй namespace в React должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'settings', 'Сообщение должно упоминать namespace settings');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

test('13. React с пустым вложенным значением — FAIL', () => {
  const result = runTranslations('translations/react-empty-nested', 'new');
  assertExitCode(result, 1, 'Пустое вложенное значение в React должно быть ошибкой');
});

test('14. HTML i18n без одного языка — FAIL', () => {
  const result = runTranslations('translations/html-i18n-missing-lang', 'new');
  assertExitCode(result, 1, 'Отсутствующий язык в HTML i18n должен быть ошибкой');
});

test('15. HTML i18n с неполным набором ключей — FAIL', () => {
  const result = runTranslations('translations/html-i18n-missing-keys', 'new');
  assertExitCode(result, 1, 'Неполный набор ключей в HTML i18n должен быть ошибкой');
});

test('16. Корректный существующий адаптер — PASS', () => {
  const result = runTranslations('translations/existing-valid', 'existing');
  assertExitCode(result, 0, 'Корректный существующий адаптер должен пройти в режиме existing');
});

test('17. Auto: titleLang все языки, но нет news — FAIL', () => {
  const result = runTranslations('translations/auto-new-without-news', 'auto');
  assertExitCode(result, 1, 'Авто-режим с полным titleLang, но без news должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'common.news', 'Сообщение должно упоминать common.news');
});

test('18. Existing с разрешённым переходным состоянием — PASS', () => {
  const result = runTranslations('translations/existing-transitional', 'existing');
  assertExitCode(result, 0, 'Существующий адаптер с переходным состоянием должен пройти (только предупреждения)');
});

test('18b. Existing без обязательного en — FAIL', () => {
  const result = runTranslations('translations/missing-en', 'existing');
  assertExitCode(result, 1, 'Для existing обязательны en и de');
  assertContains(result.stdout + result.stderr, 'обязательные', 'Сообщение должно указывать на обязательный язык');
});

test('18c. Existing без необязательного zh-cn — PASS с предупреждением', () => {
  const result = runTranslations('translations/missing-lang', 'existing');
  assertExitCode(result, 0, 'Для existing отсутствие zh-cn является переходным предупреждением');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Должно быть предупреждение про zh-cn');
});

test('19. Auto не может определить режим — NEEDS REVIEW (exit 2)', () => {
  const result = runTranslations('translations/auto-undeterminable', 'auto');
  assertExitCode(result, 2, 'Авто-режим без однозначного признака должен быть NEEDS REVIEW');
  assertContains(result.stdout + result.stderr, 'REVIEW', 'Сообщение должно содержать REVIEW');
  assertNotContains(result.stdout + result.stderr, 'режим: existing', 'Авто-режим не должен выбирать existing');
});

test('20. Новый проект с 20 Git-коммитами и полными переводами — PASS', () => {
  const temp = createGitFixture('translations/full', 20);
  try {
    const result = runCommand('node', [CHECK_TRANSLATIONS, temp, '--mode=auto']);
    assertExitCode(result, 0, 'Количество Git-коммитов не должно переключать новый адаптер в existing');
    assertContains(result.stdout + result.stderr, 'режим: new', 'Должен быть выбран режим new');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('20a. Новый проект с одним Git-коммитом и полными переводами — PASS', () => {
  const temp = createGitFixture('translations/full', 1);
  try {
    const result = runCommand('node', [CHECK_TRANSLATIONS, temp, '--mode=auto']);
    assertExitCode(result, 0, 'Один коммит не должен мешать определению нового адаптера');
    assertContains(result.stdout + result.stderr, 'режим: new', 'Должен быть выбран режим new');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('21. 20 Git-коммитов и нет titleLang в --mode=new — FAIL', () => {
  const temp = createGitFixture('translations/no-titlelang', 20);
  try {
    const result = runCommand('node', [CHECK_TRANSLATIONS, temp, '--mode=new']);
    assertExitCode(result, 1, 'Отсутствие titleLang должно быть ошибкой независимо от числа коммитов');
    assertContains(result.stdout + result.stderr, 'titleLang', 'Сообщение должно упоминать titleLang');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('22. 20 Git-коммитов и нет titleLang в --mode=auto — NEEDS REVIEW, не existing', () => {
  const temp = createGitFixture('translations/no-titlelang', 20);
  try {
    const result = runCommand('node', [CHECK_TRANSLATIONS, temp, '--mode=auto']);
    assertExitCode(result, 2, 'Без titleLang auto должен вернуть NEEDS REVIEW');
    assertNotContains(result.stdout + result.stderr, 'режим: existing', 'Авто-режим не должен выбирать existing');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('23. 20 Git-коммитов и нет news в --mode=new — FAIL', () => {
  const temp = createGitFixture('translations/missing-news', 20);
  try {
    const result = runCommand('node', [CHECK_TRANSLATIONS, temp, '--mode=new']);
    assertExitCode(result, 1, 'Отсутствие news должно быть ошибкой независимо от числа коммитов');
    assertContains(result.stdout + result.stderr, 'common.news', 'Сообщение должно упоминать common.news');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('23b. Auto без io-package — NEEDS REVIEW (exit 2), не existing', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-empty-'));
  try {
    const result = runCommand('node', [CHECK_TRANSLATIONS, temp, '--mode=auto']);
    assertExitCode(result, 2, 'Без io-package auto должен вернуть NEEDS REVIEW');
    assertContains(result.stdout + result.stderr, 'REVIEW', 'Сообщение должно содержать REVIEW');
    assertNotContains(result.stdout + result.stderr, 'режим: existing', 'Авто-режим не должен выбирать existing');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

console.log('\n=== React namespace: обязательные фикстуры ===\n');

test('24. react-complete: все namespace во всех языках — PASS', () => {
  const result = runTranslations('translations/react-complete', 'new');
  assertExitCode(result, 0, 'Полный React namespace-набор должен пройти');
});

test('25. react-missing-namespace-file: settings.json отсутствует в zh-cn — FAIL', () => {
  const result = runTranslations('translations/react-missing-namespace-file', 'new');
  assertExitCode(result, 1, 'Отсутствие файла namespace в одном языке должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'settings', 'Сообщение должно упоминать namespace settings');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
});

test('26. react-missing-namespace-key: вложенный ключ отсутствует в zh-cn — FAIL', () => {
  const result = runTranslations('translations/react-missing-namespace-key', 'new');
  assertExitCode(result, 1, 'Отсутствие вложенного ключа в одном языке должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'settings', 'Сообщение должно упоминать namespace settings');
  assertContains(result.stdout + result.stderr, 'interval', 'Сообщение должно упоминать отсутствующий ключ interval');
});

test('27. react-empty-directory: пустой каталог языка — FAIL', () => {
  const result = runTranslations('translations/react-empty-directory', 'new');
  assertExitCode(result, 1, 'Пустой каталог обязательного языка должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать zh-cn');
  assertContains(result.stdout + result.stderr, 'не содержит файлов переводов', 'Сообщение должно указывать на пустой каталог');
});

test('28. react-empty-value: пустое значение, включая базовый en — FAIL', () => {
  const result = runTranslations('translations/react-empty-value', 'new');
  assertExitCode(result, 1, 'Пустое значение в любом языке должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'пустое значение', 'Сообщение должно указывать на пустое значение');
  assertContains(result.stdout + result.stderr, 'en', 'Пустое значение в базовом en тоже должно проверяться');
});

test('29. react-multi-namespace: несколько namespace полны — PASS', () => {
  const result = runTranslations('translations/react-multi-namespace', 'new');
  assertExitCode(result, 0, 'Несколько полных namespace должны пройти');
});

test('30. react-full: jsonConfig + несколько namespace — PASS', () => {
  const result = runTranslations('translations/react-full', 'new');
  assertExitCode(result, 0, 'jsonConfig и React namespace с полными переводами должны пройти');
});

test('31. admin/src/i18n: официальный React-формат — PASS', () => {
  const result = runTranslations('translations/react-admin-src-i18n', 'new');
  assertExitCode(result, 0, 'admin/src/i18n должен проверяться и проходить при полных переводах');
});

test('31a. react-empty-namespace-object: пустой файл namespace в базовом en — FAIL', () => {
  const result = runTranslations('translations/react-empty-namespace-object', 'new');
  assertExitCode(result, 1, 'Пустой namespace-файл в базовом языке должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'не содержит строковых переводов', 'Сообщение должно указывать на отсутствие переводов');
  assertContains(result.stdout + result.stderr, 'en', 'Пустой базовый en не должен маскироваться другими языками');
});

test('31b. react-invalid-value: нестроковое значение перевода — FAIL', () => {
  const result = runTranslations('translations/react-invalid-value', 'new');
  assertExitCode(result, 1, 'Нестроковое значение перевода должно быть ошибкой в строгом режиме');
  assertContains(result.stdout + result.stderr, 'не является строкой', 'Сообщение должно указывать на недопустимое значение');
});

console.log('\n=== HTML i18n: актуальный и устаревший форматы ===\n');

test('32. HTML i18n flat format (admin/i18n/<lang>.json) — PASS', () => {
  const result = runTranslations('translations/html-flat-i18n', 'new');
  assertExitCode(result, 0, 'HTML i18n в актуальном плоском формате должен пройти');
});

test('33. HTML legacy format: распознан, выдаётся миграция — PASS с предупреждением', () => {
  const result = runTranslations('translations/html-legacy-i18n', 'new');
  assertExitCode(result, 0, 'Поддерживаемый repochecker legacy-формат не должен ошибочно считаться отсутствием переводов');
  assertContains(result.stdout + result.stderr, 'translations.json', 'Сообщение должно указывать на legacy-файлы');
  assertContains(result.stdout + result.stderr, 'мигрируйте', 'Сообщение должно содержать инструкцию миграции');
  assertContains(result.stdout + result.stderr, 'WARN', 'Должно быть предупреждение, а не ошибка');
  assertNotContains(result.stdout + result.stderr, 'отсутствуют переводы для языков: en, de', 'Legacy-формат не должен классифицироваться как отсутствие всех переводов');
});

test('34. HTML legacy format в --mode=existing: совместимость с предупреждением — PASS', () => {
  const result = runTranslations('translations/html-legacy-i18n', 'existing');
  assertExitCode(result, 0, 'Для существующего адаптера legacy-формат допустим с предупреждением');
  assertContains(result.stdout + result.stderr, 'WARN', 'Должно быть предупреждение о миграции');
  assertContains(result.stdout + result.stderr, 'мигрируйте', 'Предупреждение должно содержать инструкцию миграции');
});

test('35. HTML legacy с отсутствующим языком — FAIL и миграция', () => {
  const result = runTranslations('translations/html-legacy-incomplete', 'new');
  assertExitCode(result, 1, 'HTML legacy с отсутствующим языком должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'zh-cn', 'Сообщение должно упоминать отсутствующий язык zh-cn');
  assertContains(result.stdout + result.stderr, 'мигрируйте', 'Сообщение должно содержать инструкцию миграции');
});

console.log('\n=== Регрессионные тесты release-preflight ===\n');

test('36. Корректный официальный workflow — PASS', () => {
  const result = runRelease('release/correct');
  assertExitCode(result, 0, 'Корректный workflow должен пройти');
});

test('37. Существующая job без обязательного Action — FAIL', () => {
  const result = runRelease('release/missing-check-action');
  assertExitCode(result, 1, 'Отсутствие обязательного Action в существующей job должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'testing-action-check', 'Сообщение должно упоминать отсутствующий Action');
  assertContains(result.stdout + result.stderr, 'не найден', 'Сообщение должно явно указывать, что Action не найден');
});

test('38. Существующая job с неполными inputs — FAIL', () => {
  const result = runRelease('release/missing-action-inputs');
  assertExitCode(result, 1, 'Отсутствие обязательных inputs в Action должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'node-version', 'Сообщение должно упоминать отсутствующий input');
});

test('39. Отсутствует node-version — FAIL', () => {
  const result = runRelease('release/missing-node-version');
  assertExitCode(result, 1, 'Отсутствие node-version должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'node-version', 'Сообщение должно упоминать node-version');
});

test('40. Отсутствует os — FAIL', () => {
  const result = runRelease('release/missing-os');
  assertExitCode(result, 1, 'Отсутствие os должно быть ошибкой');
  assertContains(result.stdout + result.stderr, 'os', 'Сообщение должно упоминать os');
});

test('41. Неправильная версия Action (@v1 вместо @v2) — FAIL', () => {
  const result = runRelease('release/wrong-action-version');
  assertExitCode(result, 1, 'Неправильная версия Action должна быть ошибкой');
});

test('42. Неполная Node.js matrix — FAIL', () => {
  const result = runRelease('release/incomplete-matrix');
  assertExitCode(result, 1, 'Неполная матрица Node.js должна быть ошибкой');
});

test('43. Неполная OS matrix — FAIL', () => {
  const result = runRelease('release/incomplete-os-matrix');
  assertExitCode(result, 1, 'Неполная матрица OS должна быть ошибкой');
});

test('44. Deploy без обязательных needs — FAIL', () => {
  const result = runRelease('release/deploy-without-needs');
  assertExitCode(result, 1, 'Deploy без needs должен быть ошибкой');
});

test('45. Deploy без условия тега — FAIL', () => {
  const result = runRelease('release/deploy-no-tag-condition');
  assertExitCode(result, 1, 'Deploy без условия тега должен быть ошибкой');
});

test('46. Ручной npm publish — FAIL', () => {
  const result = runRelease('release/manual-npm-publish');
  assertExitCode(result, 1, 'Ручной npm publish должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'npm publish', 'Сообщение должно упоминать npm publish');
});

test('47. Некорректный YAML — FAIL', () => {
  const result = runRelease('release/invalid-yaml');
  assertExitCode(result, 1, 'Некорректный YAML должен быть ошибкой');
});

test('48. Неизвестный профиль — FAIL', () => {
  const result = runRelease('release/correct', 'unknown-profile');
  assertExitCode(result, 1, 'Неизвестный профиль должен быть ошибкой');
});

test('49. Deploy с always() — FAIL', () => {
  const result = runRelease('release/deploy-always-or-tag');
  assertExitCode(result, 1, 'Deploy с always() в условии должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'always()', 'Сообщение должно упоминать always()');
});

test('50. Deploy с OR и веткой (обход tag-guard) — FAIL', () => {
  const result = runRelease('release/deploy-unsafe-or-branch');
  assertExitCode(result, 1, 'OR с веткой должен считаться небезопасным');
  assertContains(result.stdout + result.stderr, 'OR', 'Сообщение должно указывать на небезопасный OR');
  assertContains(result.stdout + result.stderr, 'refs/heads', 'Сообщение должно указывать на ветку');
});

test('51. Deploy только по ветке — FAIL', () => {
  const result = runRelease('release/deploy-branch-only');
  assertExitCode(result, 1, 'Deploy по ветке без тега должен быть ошибкой');
});

test('52. Официальное условие deploy (event_name push + tag) — PASS', () => {
  const result = runRelease('release/deploy-official-condition');
  assertExitCode(result, 0, 'Официальное безопасное условие deploy должно пройти');
});

test('53. Корректное официальное условие deploy — PASS', () => {
  const result = runRelease('release/correct-deploy-condition');
  assertExitCode(result, 0, 'Корректное условие deploy должно пройти');
});

test('53a. Deploy с отрицанием contains(tag) — FAIL', () => {
  const result = runRelease('release/deploy-negated-contains');
  assertExitCode(result, 1, 'Инверсия tag-guard через !contains должна быть небезопасной');
  assertContains(result.stdout + result.stderr, 'инвертирует', 'Сообщение должно указывать на инверсию tag-guard');
});

test('53b. Альтернативное условие с отрицанием ветки — NEEDS REVIEW', () => {
  const result = runRelease('release/deploy-negated-heads-safe');
  assertExitCode(result, 2, 'Непроверенная альтернативная схема требует ручной проверки');
});

test('53c. Ручной pnpm/yarn publish с лишними пробелами — FAIL', () => {
  const result = runRelease('release/manual-pnpm-publish');
  assertExitCode(result, 1, 'Ручной вызов publish через pnpm/yarn должен быть ошибкой');
  assertContains(result.stdout + result.stderr, 'npm publish', 'Сообщение должно указывать на ручную публикацию');
});

console.log('\n=== Интеграционные тесты локальных reusable workflows через release-preflight ===\n');

function runReleaseLocalReusable({ mutateMain, mutateReusable, extraFiles } = {}) {
  const source = requireFixture('release/local-reusable-correct');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-lr-'));
  fs.cpSync(source, temp, { recursive: true });
  const mainPath = path.join(temp, '.github/workflows/test-and-release.yml');
  if (mutateMain) fs.writeFileSync(mainPath, mutateMain(fs.readFileSync(mainPath, 'utf8')));
  const reusablePath = path.join(temp, '.github/workflows/reusable.yml');
  if (mutateReusable) fs.writeFileSync(reusablePath, mutateReusable(fs.readFileSync(reusablePath, 'utf8')));
  if (extraFiles) {
    for (const [relative, content] of Object.entries(extraFiles)) {
      const filePath = path.join(temp, relative);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
  }
  try {
    return runCommand('node', [RELEASE_PREFLIGHT, temp, '--profile=create-adapter-default', '--no-git-check']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function runReleaseWithCompositeMutation({ mutateMain, mutateAction, extraFiles, removeFiles, profile = 'create-adapter-default' } = {}) {
  const source = requireFixture('release/local-composite-correct');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-composite-'));
  fs.cpSync(source, temp, { recursive: true });
  const mainPath = path.join(temp, '.github/workflows/test-and-release.yml');
  const actionPath = path.join(temp, '.github/actions/my-composite/action.yml');
  if (mutateMain) fs.writeFileSync(mainPath, mutateMain(fs.readFileSync(mainPath, 'utf8')));
  if (mutateAction) fs.writeFileSync(actionPath, mutateAction(fs.readFileSync(actionPath, 'utf8')));
  for (const [relative, content] of Object.entries(extraFiles ?? {})) {
    const filePath = path.join(temp, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  for (const relative of removeFiles ?? []) fs.rmSync(path.join(temp, relative), { recursive: true, force: true });
  try {
    return runCommand('node', [RELEASE_PREFLIGHT, temp, `--profile=${profile}`, '--no-git-check']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('57. Локальный reusable workflow проходит полный release-preflight — PASS', () => {
  const result = runReleaseLocalReusable({});
  assertExitCode(result, 0, 'Корректный локальный reusable workflow должен пройти полный release-preflight');
  assertNotContains(result.stdout + result.stderr, 'требует validateWorkflowFile', 'Локальный reusable workflow не должен отклоняться повторным вызовом валидатора');
});

test('58. Локальный reusable workflow содержит неизвестный внешний Action — FAIL', () => {
  const result = runReleaseLocalReusable({ mutateReusable: (yaml) => yaml.replace('uses: actions/checkout@v6', 'uses: evil/not-approved@v1') });
  assertExitCode(result, 1, 'Неизвестный Action внутри локального reusable workflow должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'evil/not-approved', 'Сообщение должно упоминать неизвестный Action');
});

test('59. Локальный reusable workflow содержит Action с @main — FAIL', () => {
  const result = runReleaseLocalReusable({ mutateReusable: (yaml) => yaml.replace('actions/checkout@v6', 'actions/checkout@main') });
  assertExitCode(result, 1, 'Action с плавающим ref @main должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'неподтверждённый ref', 'Сообщение должно упоминать неподтверждённый ref');
});

test('60. Локальный reusable workflow содержит Action с отсутствующим ref — FAIL', () => {
  const result = runReleaseLocalReusable({ mutateReusable: (yaml) => yaml.replace('actions/checkout@v6', 'actions/checkout') });
  assertExitCode(result, 1, 'Action без ref должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'некорректный uses', 'Сообщение должно указывать на некорректный uses');
});

test('61. Локальный reusable workflow содержит неправильный input — FAIL', () => {
  const result = runReleaseLocalReusable({ mutateMain: (yaml) => yaml.replace('      mode: strict', '      mode: 123') });
  assertExitCode(result, 1, 'Неправильный тип input должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'must have type string', 'Сообщение должно указывать на неверный тип input');
});

test('62. Локальный reusable workflow содержит некорректный YAML — FAIL', () => {
  const result = runReleaseLocalReusable({ mutateReusable: () => 'name: [invalid\n' });
  assertExitCode(result, 1, 'Некорректный YAML локального reusable workflow должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'invalid/duplicate-key YAML', 'Сообщение должно упоминать некорректный YAML');
});

test('63. Локальный reusable workflow ссылается на отсутствующий файл — FAIL', () => {
  const result = runReleaseLocalReusable({ mutateMain: (yaml) => yaml.replace('uses: ./.github/workflows/reusable.yml', 'uses: ./.github/workflows/missing.yml') });
  assertExitCode(result, 1, 'Ссылка на отсутствующий локальный reusable workflow должна быть ошибкой');
  assertContains(result.stdout + result.stderr, 'does not exist', 'Сообщение должно указывать на отсутствующий файл');
});

test('64. Локальный reusable workflow содержит циклическую ссылку — FAIL', () => {
  const result = runReleaseLocalReusable({
    mutateReusable: () => 'name: cycle\non:\n  workflow_call:\n    inputs:\n      mode:\n        required: true\n        type: string\n    secrets:\n      token:\n        required: true\njobs:\n  inner:\n    uses: ./.github/workflows/reusable.yml\n    with:\n      mode: strict\n    secrets:\n      token: ${{ secrets.TOKEN }}\n',
  });
  assertExitCode(result, 1, 'Циклическая ссылка локального reusable workflow должна быть ошибкой');
  assertContains(result.stdout + result.stderr, 'cycle detected', 'Сообщение должно упоминать цикл');
});

test('65. Локальный reusable workflow пытается выйти за пределы корня репозитория — FAIL', () => {
  const result = runReleaseLocalReusable({ mutateMain: (yaml) => yaml.replace('uses: ./.github/workflows/reusable.yml', 'uses: ./../../../outside.yml') });
  assertExitCode(result, 1, 'Попытка выхода за пределы корня репозитория должна быть ошибкой');
  assertContains(result.stdout + result.stderr, 'escapes repository root', 'Сообщение должно указывать на обход пути');
});

test('66. Вложенный локальный reusable workflow содержит запрещённый Action — FAIL', () => {
  const result = runReleaseLocalReusable({
    mutateReusable: () => 'name: nested\non:\n  workflow_call:\njobs:\n  inner:\n    uses: ./.github/workflows/inner.yml\n',
    extraFiles: {
      '.github/workflows/inner.yml': 'name: inner\non:\n  workflow_call:\njobs:\n  bad:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: evil/not-approved@v1\n',
    },
  });
  assertExitCode(result, 1, 'Запрещённый Action во вложенном локальном reusable workflow должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'evil/not-approved', 'Сообщение должно упоминать запрещённый Action');
});

test('67. Корректный workflow не отклоняется повторной валидацией, проверки публикации сохранены — PASS/FAIL', () => {
  const ok = runReleaseLocalReusable({});
  assertExitCode(ok, 0, 'Корректный workflow должен пройти полный release-preflight');
  const broken = runReleaseLocalReusable({ mutateMain: (yaml) => yaml.replace("if: startsWith(github.ref, 'refs/tags/v')", 'if: always()') });
  assertExitCode(broken, 1, 'Проверка условия deploy должна всё ещё выполняться при повторной валидации');
  assertContains(broken.stdout + broken.stderr, 'always()', 'Сообщение должно указывать на небезопасное условие deploy');
});

console.log('\n=== Интеграционные тесты локальных composite actions ===\n');

test('68. Локальный composite action проходит полный release-preflight — PASS', () => {
  const result = runReleaseWithCompositeMutation();
  assertExitCode(result, 0, 'Корректный local composite action должен пройти полный release-preflight');
});

for (const [label, mutateAction, expected] of [
  ['unknown external Action', (yaml) => yaml.replace('actions/checkout@v6', 'evil/not-approved@v1'), 'evil/not-approved'],
  ['floating @main ref', (yaml) => yaml.replace('actions/checkout@v6', 'actions/checkout@main'), 'неподтверждённый ref'],
  ['missing Action ref', (yaml) => yaml.replace('actions/checkout@v6', 'actions/checkout'), 'некорректный uses'],
  ['invalid YAML', () => 'name: [invalid\n', 'invalid/duplicate-key action YAML'],
]) {
  test(`Composite action ${label} — FAIL`, () => {
    const result = runReleaseWithCompositeMutation({ mutateAction });
    assertExitCode(result, 1, `${label} должен быть отклонён`);
    assertContains(result.stdout + result.stderr, expected, `Диагностика должна указывать на ${label}`);
  });
}

test('Composite action с неправильным input — FAIL', () => {
  const result = runReleaseWithCompositeMutation({
    mutateMain: (yaml) => yaml.replace("          node-version: '22.x'\n\n  adapter-tests:", "          node-version: '22.x'\n          unknown-input: true\n\n  adapter-tests:"),
  });
  assertExitCode(result, 1, 'Непредусмотренный input composite action должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'undeclared input', 'Диагностика должна указывать на неизвестный input');
});

test('Composite action без action.yml/action.yaml — FAIL', () => {
  const result = runReleaseWithCompositeMutation({ removeFiles: ['.github/actions/my-composite/action.yml'] });
  assertExitCode(result, 1, 'Отсутствующая metadata composite action должна быть ошибкой');
  assertContains(result.stdout + result.stderr, 'has no action.yml/action.yaml', 'Диагностика должна указывать на отсутствующую metadata');
});

test('Composite action с отсутствующей локальной зависимостью — FAIL', () => {
  const result = runReleaseWithCompositeMutation({
    mutateAction: (yaml) => `${yaml}    - uses: ./.github/actions/missing\n`,
  });
  assertExitCode(result, 1, 'Отсутствующая локальная composite action должна быть ошибкой');
  assertContains(result.stdout + result.stderr, 'path does not exist', 'Диагностика должна указывать на отсутствующую локальную зависимость');
});

test('Две composite actions с циклической ссылкой — FAIL', () => {
  const result = runReleaseWithCompositeMutation({
    mutateAction: (yaml) => yaml.replace('    - name: Setup Node.js', '    - uses: ./.github/actions/second\n    - name: Setup Node.js'),
    extraFiles: {
      '.github/actions/second/action.yml': 'name: second\nruns:\n  using: composite\n  steps:\n    - uses: ./.github/actions/my-composite\n',
    },
  });
  assertExitCode(result, 1, 'Циклическая composite action dependency должна быть ошибкой');
  assertContains(result.stdout + result.stderr, 'cycle', 'Диагностика должна указывать на цикл');
});

test('Вложенный composite action с запрещённым Action — FAIL', () => {
  const result = runReleaseWithCompositeMutation({
    mutateAction: (yaml) => yaml.replace('    - name: Setup Node.js', '    - uses: ./.github/actions/inner\n    - name: Setup Node.js'),
    extraFiles: {
      '.github/actions/inner/action.yml': 'name: inner\nruns:\n  using: composite\n  steps:\n    - uses: evil/hidden-action@main\n',
    },
  });
  assertExitCode(result, 1, 'Запрещённый Action во вложенной composite action должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'evil/hidden-action', 'Диагностика должна указывать на запрещённый Action');
});

test('Composite action за пределами корня репозитория — FAIL', () => {
  const result = runReleaseWithCompositeMutation({
    mutateAction: (yaml) => yaml.replace('    - name: Setup Node.js', '    - uses: ./../../../outside-action\n    - name: Setup Node.js'),
  });
  assertExitCode(result, 1, 'Путь composite action за пределами корня должен быть отклонён');
  assertContains(result.stdout + result.stderr, 'escapes repository root', 'Диагностика должна указывать на выход за корень');
});

console.log('\n=== Интеграционные тесты symlink escape ===\n');

function withSymlinkFixture(name, configure, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `iob-skill-symlink-${name}-`));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), `iob-skill-outside-${name}-`));
  try {
    fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    fs.mkdirSync(path.join(root, '.github/actions'), { recursive: true });
    const supported = configure(root, outside);
    if (supported?.skipReason) {
      if (process.platform === 'linux') {
        throw new Error(`Linux CI must support symlink tests; ${supported.skipReason}`);
      }
      return { status: 'SKIP', reason: supported.skipReason };
    }
    if (supported !== true) {
      throw new Error('Symlink setup must return true or an explicit skip reason');
    }
    return fn(root, outside);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}-evil`, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

function createSymlinkOrSkip(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error?.code)) {
      return { skipReason: `${error.code}: ${error.message}` };
    }
    throw error;
  }
}

for (const [label, configure, expected] of [
  ['workflow external target', (root, outside) => {
    fs.writeFileSync(path.join(outside, 'reusable.yml'), 'name: outside\njobs: {}\n');
    return createSymlinkOrSkip(path.join(outside, 'reusable.yml'), path.join(root, '.github/workflows/reusable.yml'), 'file');
  }, 'escapes repository root'],
  ['composite external target', (root, outside) => {
    fs.mkdirSync(path.join(outside, 'action'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'action/action.yml'), 'name: outside\nruns:\n  using: composite\n  steps: []\n');
    return createSymlinkOrSkip(path.join(outside, 'action'), path.join(root, '.github/actions/external'), 'dir');
  }, 'local Action path'],
  ['nested external target', (root, outside) => {
    fs.mkdirSync(path.join(root, '.github/actions/outer'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'inner.yml'), 'name: outside\nruns:\n  using: composite\n  steps: []\n');
    fs.writeFileSync(path.join(root, '.github/actions/outer/action.yml'), 'name: outer\nruns:\n  using: composite\n  steps:\n    - uses: ./.github/actions/outer/inner\n');
    return createSymlinkOrSkip(path.join(outside, 'inner.yml'), path.join(root, '.github/actions/outer/inner'), 'file');
  }, 'nested local Action path'],
  ['dangling target', (root, outside) => createSymlinkOrSkip(path.join(outside, 'missing.yml'), path.join(root, '.github/workflows/reusable.yml'), 'file'), 'path does not exist or is a dangling symlink'],
  ['symlink cycle', (root) => {
    const first = path.join(root, '.github/workflows/loop-a');
    const second = path.join(root, '.github/workflows/loop-b');
    const one = createSymlinkOrSkip(second, first, 'file');
    if (one !== true) return one;
    const two = createSymlinkOrSkip(first, second, 'file');
    if (two !== true) return two;
    return createSymlinkOrSkip(first, path.join(root, '.github/workflows/reusable.yml'), 'file');
  }, 'symlink cycle detected'],
  ['intermediate directory target', (root, outside) => {
    fs.mkdirSync(path.join(outside, 'workflow-dir'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'workflow-dir/reusable.yml'), 'name: outside\njobs: {}\n');
    const linkResult = createSymlinkOrSkip(path.join(outside, 'workflow-dir'), path.join(root, '.github/workflows/external-dir'), 'dir');
    if (linkResult !== true) return linkResult;
    return createSymlinkOrSkip(path.join(root, '.github/workflows/external-dir/reusable.yml'), path.join(root, '.github/workflows/reusable.yml'), 'file');
  }, 'escapes repository root'],
  ['similar directory name', (root, outside) => {
    const evil = `${root}-evil`;
    fs.mkdirSync(evil, { recursive: true });
    fs.writeFileSync(path.join(evil, 'reusable.yml'), 'name: outside\njobs: {}\n');
    return createSymlinkOrSkip(path.join(evil, 'reusable.yml'), path.join(root, '.github/workflows/reusable.yml'), 'file');
  }, 'escapes repository root'],
]) {
  test(`Symlink ${label} — FAIL`, () => {
    return withSymlinkFixture(label.replace(/\s+/g, '-'), configure, (root) => {
      const workflow = path.join(root, '.github/workflows/main.yml');
      let workflowText;
      if (label.includes('composite')) {
        workflowText = 'name: test\non:\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/external\n';
      } else if (label.includes('nested')) {
        workflowText = 'name: test\non:\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/outer\n';
      } else {
        workflowText = 'name: test\non:\n  workflow_dispatch:\njobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n';
      }
      fs.writeFileSync(workflow, workflowText);
      const result = validateWorkflowFile(workflow, { root });
      assertEqual(result.errors.length > 0, true, 'Symlink escape must never pass');
      assertContains(result.errors.join('\n'), expected, 'Symlink error should identify the reason');
    });
  });
}

test('Внутренний symlink разрешается только после проверки realpath — PASS', () => {
  return withSymlinkFixture('internal', (root) => {
    fs.mkdirSync(path.join(root, 'actions/real'), { recursive: true });
    fs.writeFileSync(path.join(root, 'actions/real/action.yml'), 'name: real\nruns:\n  using: composite\n  steps: []\n');
    return createSymlinkOrSkip(path.join(root, 'actions/real'), path.join(root, '.github/actions/internal'), 'dir');
  }, (root) => {
    const workflow = path.join(root, '.github/workflows/main.yml');
    fs.writeFileSync(workflow, 'name: test\non:\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/internal\n');
    const result = validateWorkflowFile(workflow, { root });
    assertEqual(result.errors.length, 0, 'Internal symlink should pass after realpath validation');
  });
});

console.log('\n=== Профили Action policy ===\n');

test('custom-approved не расширяет allowlist и не влияет на стандартный профиль', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-profile-'));
  try {
    const workflow = path.join(root, '.github/workflows/main.yml');
    fs.mkdirSync(path.dirname(workflow), { recursive: true });
    fs.writeFileSync(workflow, 'name: test\non:\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: evil/example@v1\n');
    const custom = validateWorkflowFile(workflow, { root, profile: 'custom-approved' });
    const standard = validateWorkflowFile(workflow, { root, profile: 'create-adapter-default' });
    assertEqual(custom.errors.length > 0, true, 'custom-approved must reject unknown Action without explicit policy support');
    assertEqual(standard.errors.length > 0, true, 'Standard profile must reject unknown Action');
    const after = validateWorkflowFile(workflow, { root, profile: 'create-adapter-default' });
    assertEqual(after.errors.length > 0, true, 'Custom profile must not leak permission to subsequent standard validation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('custom-approved принимает только стандартный test-and-release workflow', () => {
  const result = runRelease('release/correct', 'custom-approved');
  assertExitCode(result, 0, 'Корректный стандартный workflow должен пройти в custom-approved');
});

test('custom-approved отклоняет альтернативный npm-publish workflow', () => {
  const source = requireFixture('release/correct');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-custom-npm-publish-'));
  fs.cpSync(source, temp, { recursive: true });
  try {
    const alternate = path.join(temp, '.github/workflows/npm-publish.yml');
    fs.writeFileSync(alternate, 'name: npm publish\non:\n  push:\n    tags: ["v*"]\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n');
    const result = runCommand('node', [RELEASE_PREFLIGHT, temp, '--profile=custom-approved', '--no-git-check']);
    assertExitCode(result, 1, 'custom-approved должен отклонять альтернативный npm-publish.yml');
    assertContains(result.stdout + result.stderr, 'npm-publish.yml не поддерживается', 'Диагностика должна указывать на неподдерживаемый workflow');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Тестовый классификатор возвращает PASS, FAIL и SKIP с причиной', () => {
  const pass = executeTest(() => undefined);
  const fail = executeTest(() => { throw new Error('expected failure'); });
  const skip = executeTest(() => ({ status: 'SKIP', reason: 'explicit test reason' }));
  assertEqual(pass.status, 'PASS', 'Обычный тест должен классифицироваться как PASS');
  assertEqual(fail.status, 'FAIL', 'Исключение должно классифицироваться как FAIL');
  assertEqual(skip.status, 'SKIP', 'Явный результат skipped должен классифицироваться как SKIP');
  assertEqual(skip.reason, 'explicit test reason', 'Причина SKIP должна сохраняться');
  assertContains(formatTestResult('skip-case', skip), 'explicit test reason', 'Причина SKIP должна выводиться');
  assertEqual(pass.status === 'PASS' && skip.status !== 'PASS', true, 'SKIP не должен увеличивать PASS');
  const stats = createTestStats();
  recordTest(stats, pass);
  recordTest(stats, fail);
  recordTest(stats, skip);
  assertEqual(stats.total, 3, 'Общее количество должно включать PASS, FAIL и SKIP');
  assertEqual(stats.passed, 1, 'PASS учитывается отдельно');
  assertEqual(stats.failed, 1, 'FAIL учитывается отдельно');
  assertEqual(stats.skipped, 1, 'SKIP не включается в PASS');
  assertEqual(testExitCode(stats), 1, 'FAIL должен приводить к ненулевому exit code');
  assertEqual(testExitCode({ ...stats, failed: 0 }), 0, 'Допустимый SKIP без FAIL не должен проваливать suite');
});

test('Невозможно безопасно прочитать отсутствующий файл — FAIL, не PASS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-verified-read-'));
  try {
    let thrown = false;
    try { readVerifiedText(root, path.join(root, 'missing.yml')); }
    catch { thrown = true; }
    assertEqual(thrown, true, 'Ошибка безопасного чтения должна быть явной');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Verified reader читает обычный файл и внутренний symlink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-verified-internal-'));
  try {
    fs.writeFileSync(path.join(root, 'actual.yml'), 'name: checked\n');
    assertEqual(readVerifiedText(root, 'actual.yml'), 'name: checked\n', 'Обычный внутренний путь должен читаться');
    const link = path.join(root, 'linked.yml');
    try {
      fs.symlinkSync(path.join(root, 'actual.yml'), link, 'file');
    } catch (error) {
      if (process.platform === 'linux') throw error;
      return { status: 'SKIP', reason: `${error.code}: internal symlink unavailable on this platform` };
    }
    assertEqual(readVerifiedText(root, link), 'name: checked\n', 'Внутренний symlink должен разрешаться в проверенный realpath');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Verified reader отказывает внешнему symlink до чтения target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-verified-outside-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-verified-outside-file-'));
  try {
    const external = path.join(outside, 'secret.yml');
    const link = path.join(root, 'linked.yml');
    fs.writeFileSync(external, 'name: outside-content\n');
    try {
      fs.symlinkSync(external, link, 'file');
    } catch (error) {
      if (process.platform === 'linux') throw error;
      return { status: 'SKIP', reason: `${error.code}: symlink creation unavailable on this platform` };
    }
    let thrown = false;
    try { readVerifiedText(root, link); }
    catch { thrown = true; }
    assertEqual(thrown, true, 'Внешний symlink должен быть отклонён перед чтением target');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

for (const [name, expression] of [
  ['always()', "always() || startsWith(github.ref, 'refs/tags/v')"],
  ['failure()', "failure() || startsWith(github.ref, 'refs/tags/v')"],
  ['cancelled()', "cancelled() || startsWith(github.ref, 'refs/tags/v')"],
  ['!success()', "!success() && startsWith(github.ref, 'refs/tags/v')"],
  ['success() == false', "success() == false || startsWith(github.ref, 'refs/tags/v')"],
  ['always() || tag', "always() || contains(github.ref, 'refs/tags')"],
  ['complex status bypass', "(failure() && github.ref_type == 'tag') || startsWith(github.ref, 'refs/tags/v')"],
]) {
  test(`Deploy-condition regression ${name} — FAIL`, () => {
    const result = runReleaseWithWorkflowMutation((yaml) => yaml.replace(
      /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/,
      `if: \${{ ${expression} }}`
    ));
    assertExitCode(result, 1, `${name} не должен открывать публикацию`);
  });
}

test('Неизвестное deploy expression — NEEDS REVIEW (exit 2)', () => {
  const result = runReleaseWithWorkflowMutation((yaml) => yaml.replace(
    /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/,
    "if: ${{ startsWith(github.ref, 'refs/tags/v') && format('unexpected') }}"
  ));
  assertExitCode(result, 2, 'Неизвестная функция должна потребовать ручную проверку');
});

for (const [label, action, replacement] of [
  ['@main', 'ioBroker/testing-action-check@v2', 'ioBroker/testing-action-check@main'],
  ['@master', 'ioBroker/testing-action-adapter@v1', 'ioBroker/testing-action-adapter@master'],
  ['missing version', 'ioBroker/testing-action-deploy@v1', 'ioBroker/testing-action-deploy'],
  ['invalid major', 'ioBroker/testing-action-check@v2', 'ioBroker/testing-action-check@v3'],
  ['wrong repository', 'ioBroker/testing-action-check@v2', 'ioBroker/other-testing-action-check@v2'],
]) {
  test(`Action ref ${label} — FAIL`, () => {
    const result = runReleaseWithWorkflowMutation((yaml) => {
      if (label === 'missing version') {
        return yaml.replace(
          'ioBroker/testing-action-check@v2', 'ioBroker/testing-action-check'
        ).replace(action, replacement);
      }
      return yaml.replace(action, replacement);
    });
    assertExitCode(result, 1, `Непроверенный Action ref ${label} должен быть отклонён`);
  });
}

for (const [label, from, to] of [
  ['checkout @main', 'actions/checkout@v6', 'actions/checkout@main'],
  ['checkout @master', 'actions/checkout@v6', 'actions/checkout@master'],
  ['setup-node @main', 'actions/setup-node@v6', 'actions/setup-node@main'],
  ['setup-node @master', 'actions/setup-node@v6', 'actions/setup-node@master'],
  ['checkout missing ref', 'actions/checkout@v6', 'actions/checkout'],
  ['setup-node unknown major', 'actions/setup-node@v6', 'actions/setup-node@v99'],
]) {
  test(`Built-in Action ref ${label} — FAIL`, () => {
    const result = runReleaseWithWorkflowMutation((yaml) => yaml.replace(from, to));
    assertExitCode(result, 1, `${label} должен быть отклонён`);
  });
}

for (const [label, injection] of [
  ['unknown external action', '      - uses: evil/example-action@v1\n'],
  ['new external action in steps', '      - uses: actions/upload-artifact@v6\n        with:\n          name: release\n'],
]) {
  test(`${label} — FAIL`, () => {
    const result = runReleaseWithWorkflowMutation((yaml) => yaml.replace(
      '      - name: Checkout source\n', `${injection}      - name: Checkout source\n`
    ));
    assertExitCode(result, 1, `${label} должен быть отклонён`);
  });
}

for (const [label, uses] of [
  ['pinned reusable workflow', 'owner/repo/.github/workflows/release.yml@v1'],
  ['unpinned reusable workflow', 'owner/repo/.github/workflows/release.yml@main'],
]) {
  test(`${label} job-level uses — FAIL`, () => {
    const result = runReleaseWithWorkflowMutation((yaml) => yaml.replace(
      '  deploy:\n', `  nested:\n    uses: ${uses}\n\n  deploy:\n`
    ));
    assertExitCode(result, 1, `${label} должен быть отклонён`);
  });
}

test('Action с отсутствующим обязательным input — FAIL', () => {
  const result = runReleaseWithWorkflowMutation((yaml) => yaml.replace(
    "          node-version: '22.x'\n\n  adapter-tests:", '\n  adapter-tests:'
  ));
  assertExitCode(result, 1, 'Отсутствующий node-version у check action должен быть отклонён');
});

test('Action с неподдерживаемым input — FAIL', () => {
  const result = runReleaseWithWorkflowMutation((yaml) => yaml.replace(
    "          node-version: '22.x'\n\n  adapter-tests:", "          node-version: '22.x'\n          unsupported-input: value\n\n  adapter-tests:"
  ));
  assertExitCode(result, 1, 'Неподдерживаемый input должен быть отклонён');
});

test('Action с некорректным input value — FAIL', () => {
  const result = runReleaseWithWorkflowMutation((yaml) => yaml.replace(
    "node-version: '22.x'", "node-version: 'banana'"
  ));
  assertExitCode(result, 1, 'Некорректный node-version должен быть отклонён');
});

test('Все разрешённые Actions official workflow проходят общий allowlist — PASS', () => {
  const yaml = requireFixture('release/correct/.github/workflows/test-and-release.yml');
  const workflow = loadYaml(fs.readFileSync(yaml, 'utf8'));
  const result = validateWorkflowActions(workflow.jobs, 'positive official workflow', { requireIoBrokerActions: true });
  assertEqual(result.errors.length, 0, 'Разрешённые actions не должны давать ошибки');
});

test('softprops/action-gh-release rejects invalid constrained inputs — FAIL', () => {
  const result = validateWorkflowActions({ release: { steps: [{
    uses: 'softprops/action-gh-release@v3', with: { make_latest: 'sometimes', draft: 'yes', unknown: true },
  }] } }, 'workflow.yml');
  assertContains(result.errors.join('\n'), 'make_latest', 'Unsupported enum must be rejected');
  assertContains(result.errors.join('\n'), 'draft', 'Invalid boolean must be rejected');
  assertContains(result.errors.join('\n'), 'unknown', 'Unknown input must be rejected');
});

function withTempWorkflow(workflowText, extraFiles = {}, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iob-skill-workflow-'));
  try {
    const workflowPath = path.join(root, '.github/workflows/main.yml');
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, workflowText);
    for (const [relative, content] of Object.entries(extraFiles)) {
      const filePath = path.join(root, relative);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
    fn(validateWorkflowFile(workflowPath, { root }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Рекурсивный локальный reusable workflow ловит неизвестный Action на втором уровне — FAIL', () => {
  withTempWorkflow('name: test\non:\n  workflow_dispatch:\njobs:\n  one:\n    uses: ./.github/workflows/one.yml\n', {
    '.github/workflows/one.yml': 'name: one\non:\n  workflow_call:\njobs:\n  two:\n    uses: ./.github/workflows/two.yml\n',
    '.github/workflows/two.yml': 'name: two\non:\n  workflow_call:\njobs:\n  bad:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: evil/not-approved@v1\n',
  }, (result) => {
    assertContains(result.errors.join('\n'), 'evil/not-approved', 'Ошибка должна указать Action во вложенном reusable workflow');
  });
});

test('Локальный reusable workflow с обязательным input и secret проверяется — PASS', () => {
  withTempWorkflow('name: test\non:\n  workflow_dispatch:\njobs:\n  call:\n    uses: ./.github/workflows/child.yml\n    with:\n      mode: strict\n    secrets:\n      token: ${{ secrets.TOKEN }}\n', {
    '.github/workflows/child.yml': 'name: child\non:\n  workflow_call:\n    inputs:\n      mode:\n        required: true\n        type: string\n    secrets:\n      token:\n        required: true\njobs:\n  inner:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
  }, (result) => assertEqual(result.errors.length, 0, 'Корректный local workflow_call должен пройти'));
});

test('Локальный reusable workflow с отсутствующим input/secret отклоняется — FAIL', () => {
  withTempWorkflow('name: test\non:\n  workflow_dispatch:\njobs:\n  call:\n    uses: ./.github/workflows/child.yml\n', {
    '.github/workflows/child.yml': 'name: child\non:\n  workflow_call:\n    inputs:\n      mode:\n        required: true\n        type: string\n    secrets:\n      token:\n        required: true\njobs:\n  inner:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
  }, (result) => {
    assertContains(result.errors.join('\n'), 'required input "mode"', 'Missing input should be reported');
    assertContains(result.errors.join('\n'), 'required secret "token"', 'Missing secret should be reported');
  });
});

test('Локальный reusable workflow с неправильным input type отклоняется — FAIL', () => {
  withTempWorkflow('name: test\non:\n  workflow_dispatch:\njobs:\n  call:\n    uses: ./.github/workflows/child.yml\n    with:\n      enabled: 1\n', {
    '.github/workflows/child.yml': 'name: child\non:\n  workflow_call:\n    inputs:\n      enabled:\n        required: true\n        type: boolean\njobs:\n  inner:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
  }, (result) => assertContains(result.errors.join('\n'), 'must have type boolean', 'Wrong type should be reported'));
});

test('Remote reusable workflow без отдельного утверждения отклоняется — FAIL', () => {
  withTempWorkflow('name: test\non:\n  workflow_dispatch:\njobs:\n  call:\n    uses: owner/repo/.github/workflows/build.yml@v1\n', {}, (result) => {
    assertEqual(result.errors.length > 0, true, 'Remote reusable workflow must be rejected; result must never be PASS');
  });
});

test('Локальный reusable workflow за пределами root отклоняется — FAIL', () => {
  withTempWorkflow('name: test\non:\n  workflow_dispatch:\njobs:\n  call:\n    uses: ./../../../outside.yml\n', {}, (result) => {
    assertContains(result.errors.join('\n'), 'escapes repository root', 'Path traversal should be reported');
  });
});

test('Локальная composite action рекурсивно проверяется — FAIL', () => {
  withTempWorkflow('name: test\non:\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/outer\n', {
    '.github/actions/outer/action.yml': 'name: outer\nruns:\n  using: composite\n  steps:\n    - uses: ./.github/actions/inner\n',
    '.github/actions/inner/action.yml': 'name: inner\nruns:\n  using: composite\n  steps:\n    - uses: evil/hidden-action@main\n',
  }, (result) => assertContains(result.errors.join('\n'), 'evil/hidden-action', 'Непроверенный nested composite action должен быть обнаружен'));
});

test('Дублирующий YAML-ключ отклоняется — FAIL', () => {
  withTempWorkflow('name: duplicate\non:\n  workflow_dispatch:\njobs:\n  bad:\n    runs-on: ubuntu-latest\n    steps: []\n    steps: []\n', {}, (result) => {
    assertContains(result.errors.join('\n'), 'duplicate-key', 'Парсер должен сообщить duplicate YAML key');
  });
});

test('Некорректная структура workflow отклоняется — FAIL', () => {
  withTempWorkflow('name: invalid\non:\n  workflow_dispatch:\njobs: []\n', {}, (result) => {
    assertContains(result.errors.join('\n'), 'unsupported workflow structure', 'Структура jobs sequence вместо mapping должна быть отклонена');
  });
});

console.log('\n=== Защита от повторного появления дефектов ===\n');

test('54. check-translations.mjs не использует Git history для определения режима', () => {
  const source = fs.readFileSync(CHECK_TRANSLATIONS, 'utf8');
  for (const forbidden of ['git log', 'commitCount', 'rev-list', 'git rev-parse']) {
    assertNotContains(source, forbidden, `Определение режима не должно использовать "${forbidden}"`);
  }
  assertNotContains(source, 'const MODE =', 'Не должно быть глобальной константы MODE');
});

test('55. Все обязательные фикстуры React namespace присутствуют', () => {
  for (const fixture of [
    'translations/react-complete',
    'translations/react-missing-namespace-file',
    'translations/react-missing-namespace-key',
    'translations/react-empty-directory',
    'translations/react-empty-value',
    'translations/react-multi-namespace',
    'translations/react-full',
  ]) {
    requireFixture(fixture);
  }
});

test('56. run-adapter-checks.sh использует строгий --mode=new', () => {
  const source = fs.readFileSync(path.join(SKILL_ROOT, 'scripts/run-adapter-checks.sh'), 'utf8');
  assertContains(source, 'check-translations.mjs', 'Скрипт должен вызывать check-translations.mjs');
  assertContains(source, '--mode=new', 'Предрелизная проверка нового адаптера должна быть строгой');
});

console.log('\n=== Итог ===');
console.log(`  Всего: ${testStats.total}`);
console.log(`  PASS: ${testStats.passed}`);
console.log(`  FAIL: ${testStats.failed}`);
console.log(`  SKIP: ${testStats.skipped}`);
if (testExitCode(testStats) !== 0) process.exit(1);
console.log('\nВсе тесты пройдены!');
