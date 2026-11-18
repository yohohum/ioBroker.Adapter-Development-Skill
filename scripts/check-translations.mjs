#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.argv[2] ?? '.';
const MODE = process.argv.includes('--mode=new') ? 'new' : process.argv.includes('--mode=existing') ? 'existing' : 'new';
const errors = [];
const warnings = [];

// 11 обязательных языков для нового адаптера в ioBroker.repositories
const REQUIRED_LANGS = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

// --- Вспомогательные функции ---

function isEmpty(val) {
    return val === undefined || val === null ||
        (typeof val === 'string' && val.trim() === '') ||
        (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0);
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
        const baseKeys = new Set(Object.keys(obj[baseLang] ?? {}));
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

// --- JSON5 парсер (упрощённый, без внешних зависимостей) ---

function parseJson5(text) {
    if (!text || !text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch (_e) {
        // Упрощённая предобработка JSON5: убрать комментарии и запятые перед закрывающими скобками
        let cleaned = text
            // Убрать однострочные комментарии // ...
            .replace(/\/\/[^\n\r]*/g, '')
            // Убрать многострочные комментарии /* ... */
            .replace(/\/\*[\s\S]*?\*\//g, '')
            // Убрать запятую перед закрывающей скобкой объекта или массива
            .replace(/,\s*([\]}])/g, '$1');
        try {
            return JSON.parse(cleaned);
        } catch (e2) {
            return null;
        }
    }
}

function readJson(file) {
    try {
        const text = fs.readFileSync(file, 'utf8');
        return parseJson5(text);
    } catch (_e) {
        return null;
    }
}

// --- 1. Проверка io-package.json ---

function checkIoPackageLocalized() {
    const ioPkgPath = path.join(ROOT, 'io-package.json');
    if (!fs.existsSync(ioPkgPath)) {
        errors.push('io-package.json не найден');
        return;
    }
    const ioPkg = readJson(ioPkgPath);
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

function checkJsonConfigI18n() {
    const jsonConfigPaths = [
        path.join(ROOT, 'admin', 'jsonConfig.json'),
        path.join(ROOT, 'admin', 'jsonConfig.json5'),
    ];
    let found = false;
    for (const p of jsonConfigPaths) {
        if (!fs.existsSync(p)) continue;
        found = true;
        const config = readJson(p);
        if (!config) {
            errors.push(`${p}: некорректный JSON/JSON5`);
            continue;
        }
        if (typeof config === 'object' && !Array.isArray(config)) {
            checkJsonConfigObjectLocalization(p, config);
        } else {
            errors.push(`${p}: корень jsonConfig должен быть объектом`);
        }
    }
    if (!found) {
        if (MODE === 'new') {
            errors.push('jsonConfig.json(5) не найден в admin/ — обязателен для нового адаптера с jsonConfig UI');
        } else {
            warnings.push('jsonConfig.json(5) не найден в admin/ — проверь, используется ли jsonConfig для Admin UI');
        }
    }
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

function checkReactI18n() {
    // Возможные пути к локалям React UI по шаблону create-adapter
    const possibleLocalesDirs = [
        path.join(ROOT, 'src', 'locales'),
        path.join(ROOT, 'admin', 'locales'),
        path.join(ROOT, 'src', 'i18n'),
    ];
    let found = false;
    for (const dir of possibleLocalesDirs) {
        if (!fs.existsSync(dir)) continue;
        found = true;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const langDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
        const langFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name.replace(/\.json$/, ''));
        const allLangs = new Set([...langDirs, ...langFiles]);
        const missing = REQUIRED_LANGS.filter(l => !allLangs.has(l));
        if (missing.length > 0) {
            errors.push(`React i18n (${dir}): отсутствуют переводы для языков: ${missing.join(', ')}`);
        }
        // Проверяем валидность JSON файлов переводов и наборы ключей
        const langKeySets = new Map();
        for (const file of entries.filter(e => e.isFile() && e.name.endsWith('.json'))) {
            const filePath = path.join(dir, file.name);
            const content = readJson(filePath);
            if (!content) {
                errors.push(`${filePath}: некорректный JSON/JSON5`);
                continue;
            }
            const langName = file.name.replace(/\.json$/, '');
            if (typeof content === 'object' && !Array.isArray(content)) {
                langKeySets.set(langName, new Set(Object.keys(content)));
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
    if (!found) {
        if (MODE === 'new') {
            warnings.push('React UI локали не найдены (src/locales/, admin/locales/ или src/i18n/) — проверь, используется ли React UI');
        } else {
            warnings.push('React UI локали не найдены — проверь, используется ли React UI');
        }
    }
}

// --- 4. Проверка HTML/JavaScript Admin UI i18n ---

function checkHtmlAdminI18n() {
    const i18nDir = path.join(ROOT, 'admin', 'i18n');
    if (!fs.existsSync(i18nDir)) {
        // HTML UI может не использоваться — не ошибка
        return;
    }
    const entries = fs.readdirSync(i18nDir, { withFileTypes: true });
    const langFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name.replace(/\.json$/, ''));
    const missing = REQUIRED_LANGS.filter(l => !langFiles.includes(l));
    if (missing.length > 0) {
        errors.push(`HTML Admin UI i18n (admin/i18n/): отсутствуют переводы для языков: ${missing.join(', ')}`);
    }
    // Проверяем валидность JSON и наборы ключей
    const langKeySets = new Map();
    for (const file of entries.filter(e => e.isFile() && e.name.endsWith('.json'))) {
        const filePath = path.join(i18nDir, file.name);
        const content = readJson(filePath);
        if (!content) {
            errors.push(`${filePath}: некорректный JSON/JSON5`);
            continue;
        }
        const langName = file.name.replace(/\.json$/, '');
        if (typeof content === 'object' && !Array.isArray(content)) {
            langKeySets.set(langName, new Set(Object.keys(content)));
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

// --- 5. Обнаружение используемой технологии Admin UI ---

function detectAdminUI() {
    const jsonConfigExists = fs.existsSync(path.join(ROOT, 'admin', 'jsonConfig.json')) ||
        fs.existsSync(path.join(ROOT, 'admin', 'jsonConfig.json5'));
    const reactSrcExists = fs.existsSync(path.join(ROOT, 'src')) &&
        (fs.existsSync(path.join(ROOT, 'src', 'locales')) ||
            fs.readdirSync(path.join(ROOT, 'src'), { withFileTypes: true }).some(e => e.isDirectory() && e.name === 'locales'));
    const htmlI18nExists = fs.existsSync(path.join(ROOT, 'admin', 'i18n'));
    return { jsonConfigExists, reactSrcExists, htmlI18nExists };
}

// --- Выполнение проверок ---

checkIoPackageLocalized();
checkJsonConfigI18n();

const ui = detectAdminUI();
if (ui.reactSrcExists) {
    checkReactI18n();
}
if (ui.htmlI18nExists) {
    checkHtmlAdminI18n();
}

console.log(`\nПроверка переводов завершена: ${errors.length} ошибок, ${warnings.length} предупреждений.`);
for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

if (errors.length > 0) process.exitCode = 1;
