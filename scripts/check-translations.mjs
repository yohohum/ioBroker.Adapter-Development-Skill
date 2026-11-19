#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import JSON5 from 'json5';

const { parse: parseJson5 } = JSON5;

const ROOT = process.argv[2] ?? '.';
const MODE = process.argv.includes('--mode=new')
  ? 'new'
  : process.argv.includes('--mode=existing')
    ? 'existing'
    : 'auto';

const errors = [];
const warnings = [];
const reviewNeeded = [];

// 11 обязательных языков для нового адаптера в ioBroker.repositories
const REQUIRED_LANGS = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

// --- Вспомогательные функции ---

function isEmpty(val) {
    return val === undefined || val === null ||
        (typeof val === 'string' && val.trim() === '') ||
        (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0);
}

function readJson5(file) {
    try {
        const text = fs.readFileSync(file, 'utf8');
        if (!text || !text.trim()) return null;
        return parseJson5(text);
    } catch (_e) {
        return null;
    }
}

function readJson(file) {
    try {
        const text = fs.readFileSync(file, 'utf8');
        if (!text || !text.trim()) return null;
        return JSON.parse(text);
    } catch (_e) {
        return null;
    }
}

function checkLocalizedObject(label, obj, pathPrefix) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        errors.push(`${label}: ${pathPrefix} должен быть объектом локализаций, а не ${typeof obj}`);
        return;
    }
    const langs = Object.keys(obj);
    const missing = REQUIRED_LANGS.filter(l => !langs.includes(l));
    if (missing.length > 0) {
        errors.push(`${label}: ${pathPrefix}: отсутствуют переводы для языков: ${missing.join(', ')}`);
    }
    // Сравниваем наборы ключей между языками — все языки должны иметь одинаковые ключи
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
                errors.push(`${label}: ${pathPrefix}[${lang}]: отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
            }
            const extraKeys = [...langKeys].filter(k => !baseKeys.has(k));
            if (extraKeys.length > 0) {
                warnings.push(`${label}: ${pathPrefix}[${lang}]: лишние ключи перевода: ${extraKeys.join(', ')}`);
            }
        }
    }
    for (const lang of REQUIRED_LANGS) {
        if (!langs.includes(lang)) continue;
        const val = obj[lang];
        if (isEmpty(val)) {
            errors.push(`${label}: ${pathPrefix}[${lang}]: пустой или отсутствующий перевод`);
        }
    }
}

// --- Обнаружение типа Admin UI (единая функция) ---

function detectAdminUI() {
    const jsonConfigJson = fs.existsSync(path.join(ROOT, 'admin', 'jsonConfig.json'));
    const jsonConfigJson5 = fs.existsSync(path.join(ROOT, 'admin', 'jsonConfig.json5'));
    const jsonConfigExists = jsonConfigJson || jsonConfigJson5;

    const reactLocalesDir = fs.existsSync(path.join(ROOT, 'src', 'locales'));
    const reactI18nDir = fs.existsSync(path.join(ROOT, 'src', 'i18n'));
    const reactSrcLocales = fs.existsSync(path.join(ROOT, 'src')) &&
        fs.readdirSync(path.join(ROOT, 'src'), { withFileTypes: true }).some(e => e.isDirectory() && e.name === 'locales');
    const reactExists = reactLocalesDir || reactI18nDir || reactSrcLocales;

    const htmlI18nExists = fs.existsSync(path.join(ROOT, 'admin', 'i18n'));

    // Определяем основной тип интерфейса
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
        ].filter(d => fs.existsSync(d)),
        htmlI18nPath: path.join(ROOT, 'admin', 'i18n'),
    };
}

// --- Рекурсивный сбор всех ключей перевода из вложенного объекта ---

function collectTranslationKeys(obj, prefix = '') {
    const keys = new Set();
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [key, val] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof val === 'string') {
                keys.add(fullKey);
            } else if (typeof val === 'object' && !Array.isArray(val)) {
                // Вложенный объект — рекурсивно собираем его ключи
                const nestedKeys = collectTranslationKeys(val, fullKey);
                for (const k of nestedKeys) keys.add(k);
            }
        }
    }
    return keys;
}

// --- 1. Проверка io-package.json ---

function checkIoPackageLocalized() {
    const ioPkgPath = path.join(ROOT, 'io-package.json');
    if (!fs.existsSync(ioPkgPath)) {
        errors.push('io-package.json не найден');
        return;
    }
    const ioPkg = readJson5(ioPkgPath);
    if (!ioPkg) {
        errors.push('io-package.json некорректный JSON/JSON5');
        return;
    }

    const common = ioPkg.common ?? {};

    // common.titleLang — ОБЯЗАТЕЛЬНЫЙ объект локализаций.
    // common.title не заменяет titleLang даже если содержит корректную строку.
    if (common.titleLang === undefined) {
        errors.push('io-package.json: отсутствует common.titleLang (обязательно для нового адаптера; common.title не является заменой)');
    } else if (typeof common.titleLang !== 'object' || Array.isArray(common.titleLang)) {
        errors.push('io-package.json: common.titleLang должен быть объектом локализаций');
    } else {
        checkLocalizedObject('io-package.json common.titleLang', common.titleLang, 'common.titleLang');
    }

    // common.desc — обязательный объект локализаций
    if (common.desc === undefined) {
        errors.push('io-package.json: отсутствует common.desc (обязательно для нового адаптера)');
    } else if (typeof common.desc !== 'object' || Array.isArray(common.desc)) {
        errors.push('io-package.json: common.desc должен быть объектом локализаций');
    } else {
        checkLocalizedObject('io-package.json common.desc', common.desc, 'common.desc');
    }

    // common.news — обязательный объект локализованных записей
    if (common.news === undefined) {
        if (MODE === 'new') {
            errors.push('io-package.json: отсутствует common.news (обязательно для нового адаптера)');
        } else {
            warnings.push('io-package.json: отсутствует common.news (рекомендуется для нового адаптера)');
        }
    } else if (typeof common.news !== 'object' || Array.isArray(common.news)) {
        errors.push('io-package.json: common.news должен быть объектом локализованных записей');
    } else {
        const newsCount = Object.keys(common.news).length;
        if (newsCount > 7) {
            errors.push(`io-package.json: common.news содержит ${newsCount} записей; лимит repochecker — не более 7`);
        }
        for (const version of Object.keys(common.news)) {
            const versionNews = common.news[version];
            if (typeof versionNews !== 'object' || Array.isArray(versionNews)) {
                errors.push(`io-package.json: common.news.${version} должен быть объектом локализаций`);
                continue;
            }
            checkLocalizedObject(`io-package.json common.news.${version}`, versionNews, `common.news.${version}`);
        }
    }
}

// --- 2. Проверка jsonConfig i18n ---

// Свойства jsonConfig, которые могут содержать локализованные значения по актуальной схеме
const JSON_CONFIG_LOCALIZABLE_PROPS = ['label', 'desc', 'validatorErrorText'];

function checkJsonConfigI18n(jsonConfigPath) {
    if (!jsonConfigPath) {
        if (MODE === 'new') {
            errors.push('jsonConfig.json(5) не найден в admin/ — обязателен для нового адаптера с jsonConfig UI');
        } else {
            warnings.push('jsonConfig.json(5) не найден в admin/ — проверь, используется ли jsonConfig для Admin UI');
        }
        return;
    }

    const config = readJson5(jsonConfigPath);
    if (!config) {
        errors.push(`${jsonConfigPath}: некорректный JSON/JSON5`);
        return;
    }

    if (typeof config !== 'object' || Array.isArray(config)) {
        errors.push(`${jsonConfigPath}: корень jsonConfig должен быть объектом`);
        return;
    }

    // Рекурсивно проверяем локализуемые свойства
    checkJsonConfigObjectLocalization(jsonConfigPath, config);
}

function checkJsonConfigObjectLocalization(filePath, obj, parentPath = '') {
    if (Array.isArray(obj)) {
        obj.forEach((item, idx) => checkJsonConfigObjectLocalization(filePath, item, `${parentPath}[${idx}]`));
        return;
    }
    if (obj && typeof obj === 'object') {
        // Проверяем локализуемые свойства текущего элемента
        for (const prop of JSON_CONFIG_LOCALIZABLE_PROPS) {
            if (prop in obj) {
                const val = obj[prop];
                const fullPath = `${parentPath}${parentPath ? '.' : ''}${prop}`;
                if (typeof val === 'string') {
                    if (MODE === 'new') {
                        errors.push(`${filePath}: ${fullPath}: строка вместо объекта локализаций (требуется для нового адаптера)`);
                    } else {
                        warnings.push(`${filePath}: ${fullPath}: строка вместо объекта локализаций`);
                    }
                } else if (typeof val === 'object' && !Array.isArray(val)) {
                    checkLocalizedObject(`${filePath} jsonConfig`, val, fullPath);
                }
            }
        }
        // Рекурсивно проверяем вложенные объекты и массивы
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

// --- 3. Проверка React Admin UI i18n ---

function checkReactI18n(reactLocalesPaths) {
    if (reactLocalesPaths.length === 0) {
        if (MODE === 'new') {
            warnings.push('React UI локали не найдены (src/locales/, admin/locales/ или src/i18n/) — проверь, используется ли React UI');
        } else {
            warnings.push('React UI локали не найдены — проверь, используется ли React UI');
        }
        return;
    }

    for (const dir of reactLocalesPaths) {
        if (!fs.existsSync(dir)) continue;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const langDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
        const langFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name.replace(/\.json$/, ''));
        const allLangs = new Set([...langDirs, ...langFiles]);

        const missingLangs = REQUIRED_LANGS.filter(l => !allLangs.has(l));
        if (missingLangs.length > 0) {
            errors.push(`React i18n (${dir}): отсутствуют переводы для языков: ${missingLangs.join(', ')}`);
        }

        // Собираем наборы ключей для каждого языка
        const langKeySets = new Map();
        for (const langEntry of [...langDirs, ...langFiles]) {
            const isDir = langDirs.includes(langEntry);
            let filePath;
            if (isDir) {
                // Директория языка — ищем файлы переводов внутри
                const dirContents = fs.readdirSync(path.join(dir, langEntry), { withFileTypes: true });
                const translationFiles = dirContents.filter(e => e.isFile() && e.name.endsWith('.json'));
                if (translationFiles.length === 0) continue;
                filePath = path.join(dir, langEntry, translationFiles[0].name);
            } else {
                filePath = path.join(dir, `${langEntry}.json`);
            }
            const content = readJson5(filePath);
            if (!content) {
                errors.push(`${filePath}: некорректный JSON/JSON5`);
                continue;
            }
            if (typeof content === 'object' && !Array.isArray(content)) {
                langKeySets.set(langEntry, collectTranslationKeys(content));
            }
        }

        // Сравниваем наборы ключей между языками
        if (langKeySets.size > 0) {
            const baseLang = [...langKeySets.keys()][0];
            const baseKeys = langKeySets.get(baseLang);
            for (const [lang, keys] of langKeySets.entries()) {
                const missingKeys = [...baseKeys].filter(k => !keys.has(k));
                if (missingKeys.length > 0) {
                    errors.push(`React i18n (${dir}): ${lang}: отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
                }
            }
        }
    }
}

// --- 4. Проверка HTML/JavaScript Admin UI i18n ---

function checkHtmlAdminI18n(htmlI18nPath) {
    if (!htmlI18nPath || !fs.existsSync(htmlI18nPath)) {
        // HTML UI может не использоваться — не ошибка
        return;
    }

    const entries = fs.readdirSync(htmlI18nPath, { withFileTypes: true });
    const langFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name.replace(/\.json$/, ''));
    const missingLangs = REQUIRED_LANGS.filter(l => !langFiles.includes(l));
    if (missingLangs.length > 0) {
        errors.push(`HTML Admin UI i18n (admin/i18n/): отсутствуют переводы для языков: ${missingLangs.join(', ')}`);
    }

    // Проверяем валидность JSON и наборы ключей
    const langKeySets = new Map();
    for (const file of entries.filter(e => e.isFile() && e.name.endsWith('.json'))) {
        const filePath = path.join(htmlI18nPath, file.name);
        const content = readJson5(filePath);
        if (!content) {
            errors.push(`${filePath}: некорректный JSON/JSON5`);
            continue;
        }
        const langName = file.name.replace(/\.json$/, '');
        if (typeof content === 'object' && !Array.isArray(content)) {
            langKeySets.set(langName, collectTranslationKeys(content));
        }
    }

    if (langKeySets.size > 0) {
        const baseLang = [...langKeySets.keys()][0];
        const baseKeys = langKeySets.get(baseLang);
        for (const [lang, keys] of langKeySets.entries()) {
            const missingKeys = [...baseKeys].filter(k => !keys.has(k));
            if (missingKeys.length > 0) {
                errors.push(`HTML Admin UI i18n (admin/i18n/): ${lang}: отсутствуют ключи перевода: ${missingKeys.join(', ')}`);
            }
        }
    }
}

// --- Определение режима (auto) ---

function determineMode() {
    if (MODE !== 'auto') return MODE;

    // Пытаемся определить режим на основе признаков проекта
    const ioPkgPath = path.join(ROOT, 'io-package.json');
    if (fs.existsSync(ioPkgPath)) {
        const ioPkg = readJson5(ioPkgPath);
        if (ioPkg && ioPkg.common) {
            // Если есть common.titleLang с полным набором языков — вероятно, новый адаптер
            const titleLang = ioPkg.common.titleLang;
            if (titleLang && typeof titleLang === 'object' && !Array.isArray(titleLang)) {
                const langs = Object.keys(titleLang);
                if (REQUIRED_LANGS.every(l => langs.includes(l))) {
                    return 'new';
                }
            }
        }
    }

    // Если есть git история с несколькими коммитами — скорее всего существующий адаптер
    try {
        const log = spawnSync('git', ['log', '--oneline', '-5'], { cwd: ROOT, encoding: 'utf8' });
        const commitCount = log.stdout.trim().split('\n').filter(l => l.trim()).length;
        if (commitCount > 1) return 'existing';
    } catch (_e) {
        // Git недоступен — не можем определить
    }

    // Не можем определить надёжно — требуется явный выбор
    reviewNeeded.push('Не удаётся определить режим автоматически (new/existing). Укажите --mode=new или --mode=existing.');
    return 'new'; // По умолчанию строгий режим для безопасности
}

// --- Выполнение проверок ---

const resolvedMode = determineMode();

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

// Для React-only адаптера без jsonConfig — проверка пройдена, если React переводы полные
// (ошибки уже добавлены в checkReactI18n, если они есть)

console.log(`\nПроверка переводов завершена (режим: ${resolvedMode}):`);
console.log(`  Ошибок: ${errors.length}`);
console.log(`  Предупреждений: ${warnings.length}`);
if (reviewNeeded.length > 0) {
    console.log(`  Требуется проверки: ${reviewNeeded.length}`);
}
for (const w of warnings) console.warn(`WARN  ${w}`);
for (const r of reviewNeeded) console.warn(`REVIEW  ${r}`);
for (const e of errors) console.error(`ERROR ${e}`);

if (errors.length > 0) process.exitCode = 1;
else if (reviewNeeded.length > 0) process.exitCode = 2;
