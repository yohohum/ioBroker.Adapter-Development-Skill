#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import JSON5 from 'json5';

const ROOT = path.resolve(process.argv[2] ?? '.');
const CLI_MODE = process.argv.includes('--mode=new')
  ? 'new'
  : process.argv.includes('--mode=existing')
    ? 'existing'
    : 'auto';

// Единый источник требований repochecker по языкам.
const REQUIRED_LANGS = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const HTML_LEGACY_MIGRATION =
  'устаревший формат admin/i18n/<lang>/translations.json распознан для совместимости; ' +
  'мигрируйте переводы на актуальный формат admin/i18n/<lang>.json (create-adapter/adapter-dev)';

// Единый контекст выполнения. Режим определяется один раз и больше не читается из глобальной переменной.
const context = {
  mode: 'auto',
  strict: false,
  autoUndetermined: false,
  errors: [],
  warnings: [],
  reviewNeeded: [],
  uiType: null,
  requiredLanguages: REQUIRED_LANGS,
};

const ioPackageCache = new Map();

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyString(value) {
  return typeof value === 'string' && value.trim() === '';
}

function report(message) {
  if (context.strict) context.errors.push(message);
  else context.warnings.push(message);
}

// repochecker требует en/de для существующих адаптеров; остальные языки — переходное расширение.
function mandatoryLanguagesForMode() {
  if (context.mode === 'new') return REQUIRED_LANGS;
  if (context.mode === 'existing') return ['en', 'de'];
  return [];
}

function warn(message) {
  context.warnings.push(message);
}

function tryReadJson5(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text || !text.trim()) return { ok: false, value: null, error: 'пустой файл' };
    return { ok: true, value: JSON5.parse(text), error: null };
  } catch (error) {
    return { ok: false, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function loadIoPackage() {
  const file = path.join(ROOT, 'io-package.json');
  if (ioPackageCache.has(file)) return ioPackageCache.get(file);
  const result = { file, exists: fs.existsSync(file), ...tryReadJson5(file) };
  ioPackageCache.set(file, result);
  return result;
}

function normalizeComparisonKey(key) {
  return key.replace(PLURAL_SUFFIX, '');
}

// Возвращает строковые листья и нестроковые значения. Массивы обходятся рекурсивно,
// чтобы не пропустить пустые строки, но их индексы не участвуют в сравнении набора ключей
// (длины plural-массивов могут легально различаться между языками).
function collectLeaves(value, prefix = '', result = { values: new Map(), invalid: [], emptyContainers: [], arrayPaths: new Set() }) {
  if (typeof value === 'string') {
    result.values.set(prefix, value);
    return result;
  }
  if (Array.isArray(value)) {
    if (prefix) result.arrayPaths.add(prefix);
    if (value.length === 0) result.emptyContainers.push(prefix);
    value.forEach((item, index) => collectLeaves(item, `${prefix}[${index}]`, result));
    return result;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) result.emptyContainers.push(prefix);
    for (const key of keys) {
      collectLeaves(value[key], prefix ? `${prefix}.${key}` : key, result);
    }
    return result;
  }
  result.invalid.push({ path: prefix, value });
  return result;
}

function comparisonKeys(leaves) {
  const keys = new Set();
  for (const key of leaves.values.keys()) {
    if (!key.includes('[')) keys.add(normalizeComparisonKey(key));
  }
  for (const key of leaves.arrayPaths) keys.add(normalizeComparisonKey(key));
  return keys;
}

function checkLocalizedObject(label, obj, pathPrefix) {
  if (!isPlainObject(obj)) {
    report(`${label}: ${pathPrefix} должен быть объектом локализаций, а не ${Array.isArray(obj) ? 'array' : typeof obj}`);
    return;
  }

  const languages = Object.keys(obj);
  const mandatory = mandatoryLanguagesForMode();
  const missingMandatory = mandatory.filter(lang => !Object.prototype.hasOwnProperty.call(obj, lang));
  if (missingMandatory.length > 0) {
    context.errors.push(`${label}: ${pathPrefix}: отсутствуют обязательные переводы для языков: ${missingMandatory.join(', ')}`);
  }
  const missingOptional = REQUIRED_LANGS.filter(
    lang => !mandatory.includes(lang) && !Object.prototype.hasOwnProperty.call(obj, lang)
  );
  if (missingOptional.length > 0) {
    report(`${label}: ${pathPrefix}: отсутствуют переводы для языков: ${missingOptional.join(', ')}`);
  }

  const presentRequired = REQUIRED_LANGS.filter(lang => languages.includes(lang));
  if (presentRequired.length === 0) {
    report(`${label}: ${pathPrefix}: не содержит ни одного обязательного языка`);
    return;
  }

  const baseLang = presentRequired.includes('en') ? 'en' : presentRequired[0];
  const baseLeaves = collectLeaves(obj[baseLang]);
  const baseKeys = comparisonKeys(baseLeaves);

  for (const lang of presentRequired) {
    const leaves = collectLeaves(obj[lang]);
    if (leaves.values.size === 0) {
      report(`${label}: ${pathPrefix}[${lang}]: пустой объект локализации или отсутствуют строковые переводы`);
    }
    for (const [key, value] of leaves.values) {
      if (isEmptyString(value)) {
        report(`${label}: ${pathPrefix}[${lang}]: ключ "${key}" имеет пустое значение`);
      }
    }
    for (const pathName of leaves.emptyContainers) {
      if (pathName) report(`${label}: ${pathPrefix}[${lang}]: пустой объект/массив "${pathName}"`);
    }
    for (const invalid of leaves.invalid) {
      report(`${label}: ${pathPrefix}[${lang}]: значение "${invalid.path}" не является строкой (${typeof invalid.value})`);
    }

    if (lang === baseLang) continue;
    const langKeys = comparisonKeys(leaves);
    const missingKeys = [...baseKeys].filter(key => !langKeys.has(key));
    if (missingKeys.length > 0) {
      report(`${label}: ${pathPrefix}[${lang}]: отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
    }
    const extraKeys = [...langKeys].filter(key => !baseKeys.has(key));
    if (extraKeys.length > 0) {
      warn(`${label}: ${pathPrefix}[${lang}]: лишние ключи перевода: ${extraKeys.join(', ')}`);
    }
  }
}

function checkIoPackageLocalized() {
  const ioPkgResult = loadIoPackage();
  if (!ioPkgResult.exists) {
    if (!context.autoUndetermined) context.errors.push('io-package.json не найден');
    return;
  }
  if (!ioPkgResult.ok) {
    if (!context.autoUndetermined) context.errors.push(`io-package.json: некорректный JSON/JSON5: ${ioPkgResult.error}`);
    return;
  }
  const ioPkg = ioPkgResult.value;
  const common = ioPkg?.common ?? {};

  // common.titleLang — обязательный объект локализаций.
  // common.title не заменяет titleLang даже если содержит корректную строку.
  if (common.titleLang === undefined) {
    report('io-package.json: отсутствует common.titleLang (обязательно для нового адаптера; common.title не является заменой)');
  } else if (!isPlainObject(common.titleLang)) {
    report('io-package.json: common.titleLang должен быть объектом локализаций');
  } else {
    checkLocalizedObject('io-package.json common.titleLang', common.titleLang, 'common.titleLang');
  }

  if (common.desc === undefined) {
    report('io-package.json: отсутствует common.desc (обязательно для нового адаптера)');
  } else if (!isPlainObject(common.desc)) {
    report('io-package.json: common.desc должен быть объектом локализаций');
  } else {
    checkLocalizedObject('io-package.json common.desc', common.desc, 'common.desc');
  }

  if (common.news === undefined) {
    report('io-package.json: отсутствует common.news (обязательно для нового адаптера)');
  } else if (!isPlainObject(common.news)) {
    report('io-package.json: common.news должен быть объектом локализованных записей');
  } else {
    const newsCount = Object.keys(common.news).length;
    if (newsCount > 7) {
      context.errors.push(`io-package.json: common.news содержит ${newsCount} записей; лимит repochecker — не более 7`);
    }
    for (const version of Object.keys(common.news)) {
      const versionNews = common.news[version];
      if (!isPlainObject(versionNews)) {
        report(`io-package.json: common.news.${version} должен быть объектом локализаций`);
        continue;
      }
      checkLocalizedObject(`io-package.json common.news.${version}`, versionNews, `common.news.${version}`);
    }
  }
}

const JSON_CONFIG_LOCALIZABLE_PROPS = [
  'label',
  'desc',
  'textAlive',
  'textNotAlive',
  'tooltip',
  'help',
  'placeholder',
  'validatorErrorText',
];

function checkJsonConfigI18n(jsonConfigPath) {
  if (!jsonConfigPath) {
    report('jsonConfig.json(5) не найден в admin/ — обязателен для нового адаптера с jsonConfig UI');
    return;
  }

  const parsed = tryReadJson5(jsonConfigPath);
  if (!parsed.ok) {
    context.errors.push(`${jsonConfigPath}: некорректный JSON/JSON5: ${parsed.error}`);
    return;
  }
  if (!isPlainObject(parsed.value)) {
    context.errors.push(`${jsonConfigPath}: корень jsonConfig должен быть объектом`);
    return;
  }
  checkJsonConfigObjectLocalization(jsonConfigPath, parsed.value);
}

function checkJsonConfigObjectLocalization(filePath, obj, parentPath = '') {
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => checkJsonConfigObjectLocalization(filePath, item, `${parentPath}[${idx}]`));
    return;
  }
  if (!isPlainObject(obj)) return;

  for (const prop of JSON_CONFIG_LOCALIZABLE_PROPS) {
    if (!Object.prototype.hasOwnProperty.call(obj, prop)) continue;
    const val = obj[prop];
    const fullPath = `${parentPath}${parentPath ? '.' : ''}${prop}`;
    if (typeof val === 'string') {
      report(`${filePath}: ${fullPath}: строка вместо объекта локализаций (требуется для нового адаптера)`);
    } else if (isPlainObject(val)) {
      checkLocalizedObject(`${filePath} jsonConfig`, val, fullPath);
    }
  }

  for (const key of Object.keys(obj)) {
    if (JSON_CONFIG_LOCALIZABLE_PROPS.includes(key)) continue;
    const val = obj[key];
    const fullPath = `${parentPath}${parentPath ? '.' : ''}${key}`;
    if (isPlainObject(val) || Array.isArray(val)) {
      checkJsonConfigObjectLocalization(filePath, val, fullPath);
    }
  }
}

function listJsonFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.json5')))
    .map(entry => entry.name);
}

function resourceFromFile(filePath) {
  const parsed = tryReadJson5(filePath);
  if (!parsed.ok) {
    context.errors.push(`${filePath}: некорректный JSON/JSON5: ${parsed.error}`);
    return null;
  }
  if (!isPlainObject(parsed.value)) {
    context.errors.push(`${filePath}: корень файла переводов должен быть объектом`);
    return null;
  }
  const leaves = collectLeaves(parsed.value);
  return {
    file: filePath,
    values: leaves.values,
    invalid: leaves.invalid,
    emptyContainers: leaves.emptyContainers,
    arrayPaths: leaves.arrayPaths,
  };
}

function analyzeI18nDirectory(dir, label, options = {}) {
  const { languageDirsAreLegacy = false } = options;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.length === 0) {
    context.errors.push(`${label} (${dir}): пустая директория — нет языковых ресурсов`);
    return;
  }

  const flatFiles = new Map();
  const languageDirs = new Map();

  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.json5'))) {
      const lang = entry.name.replace(/\.json5?$/, '');
      flatFiles.set(lang, path.join(dir, entry.name));
    } else if (entry.isDirectory()) {
      languageDirs.set(entry.name, path.join(dir, entry.name));
    }
  }

  if (languageDirsAreLegacy) {
    const legacyLanguages = [...languageDirs.keys()].filter(lang => REQUIRED_LANGS.includes(lang));
    if (legacyLanguages.length > 0) {
      warn(`${label}: ${HTML_LEGACY_MIGRATION}; затронуты языки: ${legacyLanguages.join(', ')}`);
    }
  }

  // Map<lang, Map<namespace, resource>>
  const resourcesByLang = new Map();

  for (const lang of REQUIRED_LANGS) {
    const langDir = languageDirs.get(lang);
    const flatFile = flatFiles.get(lang);

    if (!langDir && !flatFile) {
      if (mandatoryLanguagesForMode().includes(lang)) {
        context.errors.push(`${label} (${dir}): отсутствуют обязательные переводы для языка: ${lang}`);
      } else {
        report(`${label} (${dir}): отсутствуют переводы для языка: ${lang}`);
      }
      continue;
    }

    if (langDir && flatFile) {
      context.errors.push(
        `${label} (${dir}): язык ${lang} представлен одновременно в двух форматах ` +
        `(${path.basename(langDir)}/translations.json и ${path.basename(flatFile)}). Используйте только один формат.`
      );
    }

    const namespaceMap = new Map();

    if (langDir) {
      const files = listJsonFiles(langDir);
      if (files.length === 0) {
        context.errors.push(`${label} (${dir}): языковая директория ${lang} не содержит файлов переводов`);
      } else {
        for (const fileName of files) {
          const namespace = fileName.replace(/\.json5?$/, '');
          const resource = resourceFromFile(path.join(langDir, fileName));
          if (resource) namespaceMap.set(namespace, resource);
        }
      }
    }

    if (flatFile) {
      const resource = resourceFromFile(flatFile);
      if (resource) namespaceMap.set('root', resource);
    }

    resourcesByLang.set(lang, namespaceMap);
  }

  // Проверяем каждый namespace отдельно во всех обязательных языках.
  const allNamespaces = new Set();
  for (const namespaceMap of resourcesByLang.values()) {
    for (const namespace of namespaceMap.keys()) allNamespaces.add(namespace);
  }

  for (const namespace of allNamespaces) {
    const languagesWithNamespace = REQUIRED_LANGS.filter(lang => resourcesByLang.get(lang)?.has(namespace));
    const missingLanguages = REQUIRED_LANGS.filter(lang => !languagesWithNamespace.includes(lang));
    const mandatoryMissing = missingLanguages.filter(lang => mandatoryLanguagesForMode().includes(lang));
    const optionalMissing = missingLanguages.filter(lang => !mandatoryLanguagesForMode().includes(lang));

    if (mandatoryMissing.length > 0) {
      context.errors.push(
        `${label} (${dir}): пространство имён "${namespace}" отсутствует в обязательных языках: ${mandatoryMissing.join(', ')}`
      );
    }
    if (optionalMissing.length > 0) {
      report(`${label} (${dir}): пространство имён "${namespace}" отсутствует в языках: ${optionalMissing.join(', ')}`);
    }
    if (languagesWithNamespace.length === 0) continue;

    const baseLang = languagesWithNamespace.includes('en') ? 'en' : languagesWithNamespace[0];
    const baseResource = resourcesByLang.get(baseLang).get(namespace);
    const baseKeys = comparisonKeys(baseResource);
    let totalStringLeaves = baseResource.values.size;

    for (const lang of languagesWithNamespace) {
      const resource = resourcesByLang.get(lang).get(namespace);
      totalStringLeaves += lang === baseLang ? 0 : resource.values.size;

      // Пустой namespace-файл (например, {}) в любом языке — не перевод.
      // Проверяем каждый язык отдельно, иначе пустой базовый файл маскируется содержимым других языков.
      if (resource.values.size === 0) {
        report(`${label} (${dir}): ${lang} в пространстве имён "${namespace}" не содержит строковых переводов`);
      }

      for (const [key, value] of resource.values) {
        if (isEmptyString(value)) {
          report(`${label} (${dir}): ${lang} в пространстве имён "${namespace}": ключ "${key}" имеет пустое значение`);
        }
      }
      for (const emptyPath of resource.emptyContainers) {
        if (emptyPath) report(`${label} (${dir}): ${lang} в пространстве имён "${namespace}": пустой объект/массив "${emptyPath}"`);
      }
      for (const invalid of resource.invalid) {
        report(`${label} (${dir}): ${lang} в пространстве имён "${namespace}": значение "${invalid.path}" не является строкой (${typeof invalid.value})`);
      }

      if (lang === baseLang) continue;
      const langKeys = comparisonKeys(resource);
      const missingKeys = [...baseKeys].filter(key => !langKeys.has(key));
      if (missingKeys.length > 0) {
        report(`${label} (${dir}): ${lang} в пространстве имён "${namespace}": отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
      }
    }

    if (totalStringLeaves === 0) {
      report(`${label} (${dir}): пространство имён "${namespace}" не содержит строковых переводов`);
    }
  }
}

function findFirstExisting(paths) {
  return paths.find(candidate => fs.existsSync(candidate)) ?? null;
}

function detectAdminUI() {
  const jsonConfigPath = findFirstExisting([
    path.join(ROOT, 'admin', 'jsonConfig.json'),
    path.join(ROOT, 'admin', 'jsonConfig.json5'),
  ]);

  const reactCandidates = [
    { dir: path.join(ROOT, 'admin', 'src', 'i18n'), label: 'React Admin i18n (admin/src/i18n/)' },
    { dir: path.join(ROOT, 'src', 'locales'), label: 'React i18n (src/locales/)' },
    { dir: path.join(ROOT, 'src', 'i18n'), label: 'React i18n (src/i18n/)' },
    { dir: path.join(ROOT, 'admin', 'locales'), label: 'React i18n (admin/locales/)' },
  ].filter(candidate => fs.existsSync(candidate.dir));

  const htmlI18nPath = path.join(ROOT, 'admin', 'i18n');
  const htmlI18nExists = fs.existsSync(htmlI18nPath);
  const reactExists = reactCandidates.length > 0;

  let primaryType = 'none';
  if (jsonConfigPath && reactExists) primaryType = 'mixed';
  else if (jsonConfigPath) primaryType = 'jsonConfig';
  else if (reactExists) primaryType = 'react';
  else if (htmlI18nExists) primaryType = 'html';

  return { jsonConfigPath, reactCandidates, htmlI18nPath, htmlI18nExists, reactExists, primaryType };
}

function determineMode() {
  if (CLI_MODE !== 'auto') {
    context.mode = CLI_MODE;
    context.strict = CLI_MODE === 'new';
    return;
  }

  const ioPkgResult = loadIoPackage();
  if (!ioPkgResult.exists) {
    context.mode = 'auto';
    context.strict = false;
    context.autoUndetermined = true;
    context.reviewNeeded.push('Не удаётся определить режим автоматически (new/existing): io-package.json не найден. Укажите --mode=new или --mode=existing.');
    return;
  }
  if (!ioPkgResult.ok) {
    context.mode = 'auto';
    context.strict = false;
    context.autoUndetermined = true;
    context.reviewNeeded.push('Не удаётся определить режим автоматически (new/existing): io-package.json некорректен. Укажите --mode=new или --mode=existing.');
    return;
  }

  const titleLang = ioPkgResult.value?.common?.titleLang;
  const hasCompleteTitleLang = isPlainObject(titleLang) &&
    REQUIRED_LANGS.every(lang =>
      Object.prototype.hasOwnProperty.call(titleLang, lang) &&
      typeof titleLang[lang] === 'string' &&
      titleLang[lang].trim() !== ''
    );

  if (hasCompleteTitleLang) {
    context.mode = 'new';
    context.strict = true;
    return;
  }

  // Наличие Git-коммитов, тегов или возраст проекта не используются как признак existing.
  // Без однозначного признака нового проекта режим не угадывается.
  context.mode = 'auto';
  context.strict = false;
  context.autoUndetermined = true;
  context.reviewNeeded.push(
    'Не удаётся определить режим автоматически (new/existing): нет полного common.titleLang на всех 11 языках. ' +
    'Укажите --mode=new или --mode=existing; режим existing не выбирается автоматически.'
  );
}

// --- Выполнение проверок ---

determineMode();

checkIoPackageLocalized();

const ui = detectAdminUI();
context.uiType = ui.primaryType;

if (ui.jsonConfigPath) {
  checkJsonConfigI18n(ui.jsonConfigPath);
}

for (const candidate of ui.reactCandidates) {
  analyzeI18nDirectory(candidate.dir, candidate.label, {
    languageDirsAreLegacy: false,
  });
}

if (ui.htmlI18nExists) {
  analyzeI18nDirectory(ui.htmlI18nPath, 'HTML Admin UI i18n (admin/i18n/)', {
    languageDirsAreLegacy: true,
  });
}

console.log(`\nПроверка переводов завершена (режим: ${context.mode}${context.autoUndetermined ? ', требуется проверка' : ''}):`);
console.log(`  Ошибок: ${context.errors.length}`);
console.log(`  Предупреждений: ${context.warnings.length}`);
if (context.reviewNeeded.length > 0) {
  console.log(`  Требуется проверки: ${context.reviewNeeded.length}`);
}
for (const warning of context.warnings) console.warn(`WARN  ${warning}`);
for (const review of context.reviewNeeded) console.warn(`REVIEW  ${review}`);
for (const error of context.errors) console.error(`ERROR ${error}`);

if (context.errors.length > 0) process.exitCode = 1;
else if (context.reviewNeeded.length > 0) process.exitCode = 2;
