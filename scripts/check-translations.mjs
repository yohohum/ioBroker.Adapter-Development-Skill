#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import JSON5 from 'json5';

const ROOT = path.resolve(process.argv[2] ?? '.');
const CLI_MODE = process.argv.includes('--mode=new')
  ? 'new'
  : process.argv.includes('--mode=existing')
    ? 'existing'
    : 'auto';

const REQUIRED_LANGS = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-c\u006E'];

// Single shared context — mode is resolved once and passed to all checks
const context = {
  mode: null,
  modeAutoDetected: false,
  errors: [],
  warnings: [],
  reviewNeeded: [],
};

function isEmpty(val) {
  return val === undefined || val === null ||
    (typeof val === 'string' && val.trim() === '') ||
    (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0);
}

function readJson5(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text || !text.trim()) return null;
    return JSON5.parse(text);
  } catch (e) {
    context.errors.push(`${file}: некорректный JSON/JSON5: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  } catch (e) {
    context.errors.push(`${file}: некорректный JSON: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function checkLocalizedObject(label, obj, pathPrefix, mode) {
  const isStrict = mode === 'new' && !context.modeAutoDetected;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    if (isStrict) {
      context.errors.push(`${label}: ${pathPrefix} должен быть объектом локализаций, а не ${typeof obj}`);
    } else {
      context.warnings.push(`${label}: ${pathPrefix} должен быть объектом локализаций, а не ${typeof obj}`);
    }
    return;
  }
  const langs = Object.keys(obj);
  const missing = REQUIRED_LANGS.filter(l => !langs.includes(l));
  if (missing.length > 0) {
    if (isStrict) {
      context.errors.push(`${label}: ${pathPrefix}: отсутствуют переводы для языков: ${missing.join(', ')}`);
    } else {
      context.warnings.push(`${label}: ${pathPrefix}: отсутствуют переводы для языков: ${missing.join(', ')}`);
    }
  }
  if (langs.length > 0) {
    const baseLang = langs[0];
    const baseObj = obj[baseLang];
    const baseKeys = typeof baseObj === 'object' && !Array.isArray(baseObj)
      ? new Set(Object.keys(baseObj))
      : new Set();
    for (const lang of REQUIRED_LANGS) {
      if (!langs.includes(lang)) continue;
      const langObj = obj[lang];
      if (typeof langObj !== 'object' || Array.isArray(langObj)) continue;
      const langKeys = new Set(Object.keys(langObj));
      const missingKeys = [...baseKeys].filter(k => !langKeys.has(k));
      if (missingKeys.length > 0) {
        if (isStrict) {
          context.errors.push(`${label}: ${pathPrefix}[${lang}]: отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
        } else {
          context.warnings.push(`${label}: ${pathPrefix}[${lang}]: отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
        }
      }
      const extraKeys = [...langKeys].filter(k => !baseKeys.has(k));
      if (extraKeys.length > 0) {
        context.warnings.push(`${label}: ${pathPrefix}[${lang}]: лишние ключи перевода: ${extraKeys.join(', ')}`);
      }
    }
  }
  for (const lang of REQUIRED_LANGS) {
    if (!langs.includes(lang)) continue;
    const val = obj[lang];
    if (isEmpty(val)) {
      if (isStrict) {
        context.errors.push(`${label}: ${pathPrefix}[${lang}]: пустой или отсутствующий перевод`);
      } else {
        context.warnings.push(`${label}: ${pathPrefix}[${lang}]: пустой или отсутствующий перевод`);
      }
    }
  }
}

function detectAdminUI() {
  const jsonConfigJson = fs.existsSync(path.join(ROOT, 'admin', 'jsonConfig.json'));
  const jsonConfigJson5 = fs.existsSync(path.join(ROOT, 'admin', 'jsonConfig.json5'));
  const jsonConfigExists = jsonConfigJson || jsonConfigJson5;

  const reactLocalesDir = fs.existsSync(path.join(ROOT, 'src', 'locales'));
  const reactI18nDir = fs.existsSync(path.join(ROOT, 'src', 'i18n'));
  const reactAdminSrcI18nDir = fs.existsSync(path.join(ROOT, 'admin', 'src', 'i18n'));
  const reactSrcLocales = fs.existsSync(path.join(ROOT, 'src')) &&
    fs.readdirSync(path.join(ROOT, 'src'), { withFileTypes: true }).some(e => e.isDirectory() && e.name === 'locales');
  const reactExists = reactLocalesDir || reactI18nDir || reactAdminSrcI18nDir || reactSrcLocales;

  const htmlI18nExists = fs.existsSync(path.join(ROOT, 'admin', 'i18n'));

  let primaryType = 'none';
  if (jsonConfigExists && reactExists) primaryType = 'mixed';
  else if (jsonConfigExists) primaryType = 'jsonConfig';
  else if (reactExists) primaryType = 'react';
  else if (htmlI18nExists) primaryType = 'html';

  return {
    jsonConfigExists,
    reactExists,
    htmlI18nExists,
    primaryType,
    jsonConfigPath: jsonConfigJson
      ? path.join(ROOT, 'admin', 'jsonConfig.json')
      : jsonConfigJson5
        ? path.join(ROOT, 'admin', 'jsonConfig.json5')
        : null,
    reactLocalesPaths: [
      path.join(ROOT, 'src', 'locales'),
      path.join(ROOT, 'admin', 'locales'),
      path.join(ROOT, 'src', 'i18n'),
      path.join(ROOT, 'admin', 'src', 'i18n'),
    ].filter(d => fs.existsSync(d)),
    htmlI18nPath: path.join(ROOT, 'admin', 'i18n'),
  };
}

function collectTranslationKeys(obj, prefix = '') {
  const keys = new Set();
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [key, val] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof val === 'string') {
        keys.add(fullKey);
      } else if (typeof val === 'object' && !Array.isArray(val)) {
        const nestedKeys = collectTranslationKeys(val, fullKey);
        for (const k of nestedKeys) keys.add(k);
      }
    }
  }
  return keys;
}

function collectTranslationValues(obj, prefix = '') {
  const values = new Map();
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [key, val] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof val === 'string') {
        values.set(fullKey, val);
      } else if (typeof val === 'object' && !Array.isArray(val)) {
        const nestedValues = collectTranslationValues(val, fullKey);
        for (const [k, v] of nestedValues) values.set(k, v);
      }
    }
  }
  return values;
}

function checkIoPackageLocalized() {
  const ioPkgPath = path.join(ROOT, 'io-package.json');
  if (!fs.existsSync(ioPkgPath)) {
    context.errors.push('io-package.json не найден');
    return;
  }
  const ioPkg = readJson5(ioPkgPath);
  if (!ioPkg) {
    context.errors.push('io-package.json некорректный JSON/JSON5');
    return;
  }

  const common = ioPkg.common ?? {};

  // common.titleLang — ОБЯЗАТЕЛЬНЫЙ объект локализаций.
  // common.title не заменяет titleLang даже если содержит корректную строку.
  if (common.titleLang === undefined) {
    if (context.mode === 'new') {
      context.errors.push('io-package.json: отсутствует common.titleLang (обязательно для нового адаптера; common.title не является заменой)');
    } else {
      context.warnings.push('io-package.json: отсутствует common.titleLang (рекомендуется для нового адаптера; common.title не является заменой)');
    }
  } else if (typeof common.titleLang !== 'object' || Array.isArray(common.titleLang)) {
    if (context.mode === 'new') {
      context.errors.push('io-package.json: common.titleLang должен быть объектом локализаций');
    } else {
      context.warnings.push('io-package.json: common.titleLang должен быть объектом локализаций');
    }
  } else {
    checkLocalizedObject('io-package.json common.titleLang', common.titleLang, 'common.titleLang', context.mode);
  }

  // common.desc — обязательный объект локализаций
  if (common.desc === undefined) {
    if (context.mode === 'new') {
      context.errors.push('io-package.json: отсутствует common.desc (обязательно для нового адаптера)');
    } else {
      context.warnings.push('io-package.json: отсутствует common.desc (рекомендуется для нового адаптера)');
    }
  } else if (typeof common.desc !== 'object' || Array.isArray(common.desc)) {
    if (context.mode === 'new') {
      context.errors.push('io-package.json: common.desc должен быть объектом локализаций');
    } else {
      context.warnings.push('io-package.json: common.desc должен быть объектом локализаций');
    }
  } else {
    checkLocalizedObject('io-package.json common.desc', common.desc, 'common.desc', context.mode);
  }

  // common.news — обязательный объект локализованных записей
  if (common.news === undefined) {
    if (context.mode === 'new') {
      context.errors.push('io-package.json: отсутствует common.news (обязательно для нового адаптера)');
    } else {
      context.warnings.push('io-package.json: отсутствует common.news (рекомендуется для нового адаптера)');
    }
  } else if (typeof common.news !== 'object' || Array.isArray(common.news)) {
    if (context.mode === 'new') {
      context.errors.push('io-package.json: common.news должен быть объектом локализованных записей');
    } else {
      context.warnings.push('io-package.json: common.news должен быть объектом локализованных записей');
    }
  } else {
    const newsCount = Object.keys(common.news).length;
    if (newsCount > 7) {
      context.errors.push(`io-package.json: common.news содержит ${newsCount} записей; лимит repochecker — не более 7`);
    }
    for (const version of Object.keys(common.news)) {
      const versionNews = common.news[version];
      if (typeof versionNews !== 'object' || Array.isArray(versionNews)) {
        if (context.mode === 'new') {
          context.errors.push(`io-package.json: common.news.${version} должен быть объектом локализаций`);
        } else {
          context.warnings.push(`io-package.json: common.news.${version} должен быть объектом локализаций`);
        }
        continue;
      }
      checkLocalizedObject(`io-package.json common.news.${version}`, versionNews, `common.news.${version}`, context.mode);
    }
  }
}

const JSON_CONFIG_LOCALIZABLE_PROPS = ['label', 'desc', 'validatorErrorText'];

function checkJsonConfigI18n(jsonConfigPath) {
  if (!jsonConfigPath) {
    if (context.mode === 'new') {
      context.errors.push('jsonConfig.json(5) не найден в admin/ — обязателен для нового адаптера с jsonConfig UI');
    } else {
      context.warnings.push('jsonConfig.json(5) не найден в admin/ — проверь, используется ли jsonConfig для Admin UI');
    }
    return;
  }

  const config = readJson5(jsonConfigPath);
  if (!config) {
    context.errors.push(`${jsonConfigPath}: некорректный JSON/JSON5`);
    return;
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    context.errors.push(`${jsonConfigPath}: корень jsonConfig должен быть объектом`);
    return;
  }

  checkJsonConfigObjectLocalization(jsonConfigPath, config);
}

function checkJsonConfigObjectLocalization(filePath, obj, parentPath = '') {
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => checkJsonConfigObjectLocalization(filePath, item, `${parentPath}[${idx}]`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const prop of JSON_CONFIG_LOCALIZABLE_PROPS) {
      if (prop in obj) {
        const val = obj[prop];
        const fullPath = `${parentPath}${parentPath ? '.' : ''}${prop}`;
        if (typeof val === 'string') {
          if (context.mode === 'new') {
            context.errors.push(`${filePath}: ${fullPath}: строка вместо объекта локализаций (требуется для нового адаптера)`);
          } else {
            context.warnings.push(`${filePath}: ${fullPath}: строка вместо объекта локализаций`);
          }
        } else if (typeof val === 'object' && !Array.isArray(val)) {
          checkLocalizedObject(`${filePath} jsonConfig`, val, fullPath, context.mode);
        }
      }
    }
    for (const key of Object.keys(obj)) {
      if (JSON_CONFIG_LOCALIZABLE_PROPS.includes(key)) continue;
      const val = obj[key];
      const fullPath = `${parentPath}${parentPath ? '.' : ''}${key}`;
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        checkJsonConfigObjectLocalization(filePath, val, fullPath);
      } else if (Array.isArray(val)) {
        checkJsonConfigObjectLocalization(filePath, val, fullPath);
      }
    }
  }
}

function checkReactI18n(reactLocalesPaths) {
  if (reactLocalesPaths.length === 0) {
    if (context.mode === 'new') {
      context.warnings.push('React UI локали не найдены (src/locales/, admin/locales/, src/i18n/ или admin/src/i18n/) — проверь, используется ли React UI');
    } else {
      context.warnings.push('React UI локали не найдены — проверь, используется ли React UI');
    }
    return;
  }

  for (const dir of reactLocalesPaths) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Check for empty directory
    if (entries.length === 0) {
      context.errors.push(`React i18n (${dir}): пустая языковая директория — нет языковых ресурсов`);
      continue;
    }

    const langDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    const langFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name.replace(/\.json$/, ''));
    const allLangs = new Set([...langDirs, ...langFiles]);

    const missingLangs = REQUIRED_LANGS.filter(l => !allLangs.has(l));
    if (missingLangs.length > 0) {
      context.errors.push(`React i18n (${dir}): отсутствуют переводы для языков: ${missingLangs.join(', ')}`);
    }

    // Collect all namespace files per language
    // Structure: Map<lang, Map<namespace, {keys: Set<string>, values: Map<string, string>}>>
    const langNsData = new Map();

    for (const langEntry of [...langDirs, ...langFiles]) {
      const isDir = langDirs.includes(langEntry);
      if (isDir) {
        const dirPath = path.join(dir, langEntry);
        const dirContents = fs.readdirSync(dirPath, { withFileTypes: true });
        const translationFiles = dirContents.filter(e => e.isFile() && e.name.endsWith('.json'));
        if (translationFiles.length === 0) {
          context.errors.push(`React i18n (${dir}): языковая директория ${langEntry} не содержит файлов переводов`);
          continue;
        }
        for (const tf of translationFiles) {
          const nsFilePath = path.join(dirPath, tf.name);
          const content = readJson5(nsFilePath);
          if (!content) {
            context.errors.push(`${nsFilePath}: некорректный JSON/JSON5`);
            continue;
          }
          if (typeof content === 'object' && !Array.isArray(content)) {
            const nsKey = tf.name.replace(/\.json$/, '');
            if (!langNsData.has(langEntry)) {
              langNsData.set(langEntry, new Map());
            }
            const nsData = langNsData.get(langEntry);
            nsData.set(nsKey, {
              keys: collectTranslationKeys(content),
              values: collectTranslationValues(content),
            });
          }
        }
      } else {
        const filePath = path.join(dir, `${langEntry}.json`);
        const content = readJson5(filePath);
        if (!content) {
          context.errors.push(`${filePath}: некорректный JSON/JSON5`);
          continue;
        }
        if (typeof content === 'object' && !Array.isArray(content)) {
          const nsKey = 'root';
          if (!langNsData.has(langEntry)) {
            langNsData.set(langEntry, new Map());
          }
          const nsData = langNsData.get(langEntry);
          nsData.set(nsKey, {
            keys: collectTranslationKeys(content),
            values: collectTranslationValues(content),
          });
        }
      }
    }

    // Collect all namespaces across all languages
    const allNamespaces = new Set();
    for (const [lang, nsMap] of langNsData.entries()) {
      for (const ns of nsMap.keys()) {
        allNamespaces.add(ns);
      }
    }

    // Check each namespace across all 11 required languages
    for (const ns of allNamespaces) {
      // Check which languages have this namespace
      const langsWithNs = [...langNsData.keys()].filter(lang => langNsData.get(lang).has(ns));

      // Check missing languages for this namespace
      const missingLangForNs = REQUIRED_LANGS.filter(lang => !langsWithNs.includes(lang));
      if (missingLangForNs.length > 0) {
        context.errors.push(`React i18n (${dir}): пространство имён "${ns}" отсутствует в языках: ${missingLangForNs.join(', ')}`);
      }

      // Compare keys between languages that have this namespace
      if (langsWithNs.length >= 2) {
        const baseLang = langsWithNs[0];
        const baseKeys = langNsData.get(baseLang).get(ns).keys;
        const baseValues = langNsData.get(baseLang).get(ns).values;

        for (const lang of langsWithNs) {
          if (lang === baseLang) continue;
          const langData = langNsData.get(lang).get(ns);
          const langKeys = langData.keys;
          const langValues = langData.values;

          // Check missing keys
          const missingKeys = [...baseKeys].filter(k => !langKeys.has(k));
          if (missingKeys.length > 0) {
            context.errors.push(`React i18n (${dir}): ${lang} в пространстве имён "${ns}": отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
          }

          // Check empty values for keys present in both base and current language
          const commonKeys = [...baseKeys].filter(k => langKeys.has(k));
          for (const k of commonKeys) {
            const val = langValues.get(k);
            if (isEmpty(val)) {
              context.errors.push(`React i18n (${dir}): ${lang} в пространстве имён "${ns}": ключ "${k}" имеет пустое значение`);
            }
          }
        }
      }
    }
  }
}

function checkHtmlAdminI18n(htmlI18nPath) {
  if (!htmlI18nPath || !fs.existsSync(htmlI18nPath)) {
    return;
  }

  const entries = fs.readdirSync(htmlI18nPath, { withFileTypes: true });
  if (entries.length === 0) {
    context.errors.push(`HTML Admin UI i18n (admin/i18n/): пустая языковая директория — нет языковых ресурсов`);
    return;
  }

  // Collect language data: Map<lang, Map<namespace, {keys, values}>>
  // Supports both flat format (en.json) and legacy directory format (en/translations.json)
  const langNsData = new Map();

  for (const entry of entries) {
    const langName = entry.name.replace(/\.json$/, '');
    const entryPath = path.join(htmlI18nPath, entry.name);

    if (entry.isDirectory()) {
      // Legacy format: admin/i18n/en/translations.json
      const dirContents = fs.readdirSync(entryPath, { withFileTypes: true });
      const translationFiles = dirContents.filter(e => e.isFile() && e.name.endsWith('.json'));
      if (translationFiles.length === 0) {
        context.errors.push(`HTML Admin UI i18n (admin/i18n/): языковая директория ${langName} не содержит файлов переводов`);
        continue;
        }
        for (const tf of translationFiles) {
          const nsFilePath = path.join(entryPath, tf.name);
          const content = readJson5(nsFilePath);
          if (!content) {
            context.errors.push(`${nsFilePath}: некорректный JSON/JSON5`);
            continue;
          }
          if (typeof content === 'object' && !Array.isArray(content)) {
            const nsKey = tf.name.replace(/\.json$/, '');
            if (!langNsData.has(langName)) {
              langNsData.set(langName, new Map());
            }
            const nsData = langNsData.get(langName);
            nsData.set(nsKey, {
              keys: collectTranslationKeys(content),
              values: collectTranslationValues(content),
            });
          }
        }
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        // Flat format: admin/i18n/en.json
        const filePath = path.join(htmlI18nPath, entry.name);
        const content = readJson5(filePath);
        if (!content) {
          context.errors.push(`${filePath}: некорректный JSON/JSON5`);
          continue;
        }
        if (typeof content === 'object' && !Array.isArray(content)) {
          const nsKey = 'root';
          if (!langNsData.has(langName)) {
            langNsData.set(langName, new Map());
          }
          const nsData = langNsData.get(langName);
          nsData.set(nsKey, {
            keys: collectTranslationKeys(content),
            values: collectTranslationValues(content),
          });
        }
      }
    }

    // Check all 11 required languages are present
    const missingLangs = REQUIRED_LANGS.filter(l => !langNsData.has(l));
    if (missingLangs.length > 0) {
      context.errors.push(`HTML Admin UI i18n (admin/i18n/): отсутствуют переводы для языков: ${missingLangs.join(', ')}`);
    }

    // Collect all namespaces across all languages
    const allNamespaces = new Set();
    for (const [lang, nsMap] of langNsData.entries()) {
      for (const ns of nsMap.keys()) {
        allNamespaces.add(ns);
      }
    }

    // Check each namespace across all 11 required languages
    for (const ns of allNamespaces) {
      const langsWithNs = [...langNsData.keys()].filter(lang => langNsData.get(lang).has(ns));

      const missingLangForNs = REQUIRED_LANGS.filter(lang => !langsWithNs.includes(lang));
      if (missingLangForNs.length > 0) {
        context.errors.push(`HTML Admin UI i18n (admin/i18n/): пространство имён "${ns}" отсутствует в языках: ${missingLangForNs.join(', ')}`);
      }

      if (langsWithNs.length >= 2) {
        const baseLang = langsWithNs[0];
        const baseKeys = langNsData.get(baseLang).get(ns).keys;
        const baseValues = langNsData.get(baseLang).get(ns).values;

        for (const lang of langsWithNs) {
          if (lang === baseLang) continue;
          const langData = langNsData.get(lang).get(ns);
          const langKeys = langData.keys;
          const langValues = langData.values;

          const missingKeys = [...baseKeys].filter(k => !langKeys.has(k));
          if (missingKeys.length > 0) {
            context.errors.push(`HTML Admin UI i18n (admin/i18n/): ${lang} в пространстве имён "${ns}": отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
          }

          const commonKeys = [...baseKeys].filter(k => langKeys.has(k));
          for (const k of commonKeys) {
            const val = langValues.get(k);
            if (isEmpty(val)) {
              context.errors.push(`HTML Admin UI i18n (admin/i18n/): ${lang} в пространстве имён "${ns}": ключ "${k}" имеет пустое значение`);
            }
          }
        }
    }
  }
}

function determineMode() {
  if (CLI_MODE !== 'auto') return CLI_MODE;

  const ioPkgPath = path.join(ROOT, 'io-package.json');
  if (fs.existsSync(ioPkgPath)) {
    const ioPkg = readJson5(ioPkgPath);
    if (ioPkg && ioPkg.common) {
      const titleLang = ioPkg.common.titleLang;
      if (titleLang && typeof titleLang === 'object' && !Array.isArray(titleLang)) {
        const langs = Object.keys(titleLang);
        if (REQUIRED_LANGS.every(l => langs.includes(l))) {
          return 'new';
        }
      }
    }
  }

  context.reviewNeeded.push('Не удаётся определить режим автоматически (new/existing). Укажите --mode=new или --mode=existing.');
  context.modeAutoDetected = true;
  return 'new';
}

// --- Выполнение проверок ---

context.mode = determineMode();

checkIoPackageLocalized();

const ui = detectAdminUI();

if (ui.primaryType === 'jsonConfig' || ui.primaryType === 'mixed') {
  checkJsonConfigI18n(ui.jsonConfigPath);
}

if (ui.reactExists) {
  checkReactI18n(ui.reactLocalesPaths);
}

if (ui.htmlI18nExists) {
  checkHtmlAdminI18n(ui.htmlI18nPath);
}

console.log(`\nПроверка переводов завершена (режим: ${context.mode}):`);
console.log(`  Ошибок: ${context.errors.length}`);
console.log(`  Предупреждений: ${context.warnings.length}`);
if (context.reviewNeeded.length > 0) {
  console.log(`  Требуется проверки: ${context.reviewNeeded.length}`);
}
for (const w of context.warnings) console.warn(`WARN  ${w}`);
for (const r of context.reviewNeeded) console.warn(`REVIEW  ${r}`);
for (const e of context.errors) console.error(`ERROR ${e}`);

if (context.errors.length > 0) process.exitCode = 1;
else if (context.reviewNeeded.length > 0) process.exitCode = 2;
