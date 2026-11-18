#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.argv[2] ?? '.';
const errors = [];
const warnings = [];

// 11 обязательных языков для нового адаптера в ioBroker.repositories
const REQUIRED_LANGS = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

// --- 1. Проверка io-package.json common.localized ---
function checkIoPackageLocalized() {
    const ioPkgPath = path.join(ROOT, 'io-package.json');
    if (!fs.existsSync(ioPkgPath)) {
        errors.push('io-package.json не найден');
        return;
    }
    let ioPkg;
    try { ioPkg = JSON.parse(fs.readFileSync(ioPkgPath, 'utf8')); }
    catch (e) { errors.push(`io-package.json некорректный JSON: ${e.message}`); return; }

    const common = ioPkg.common ?? {};
    const localizedKeys = ['title', 'desc', 'news'];

    for (const key of localizedKeys) {
        const val = common[key];
        if (!val) {
            warnings.push(`io-package.json common.${key} отсутствует (рекомендуется для новых адаптеров)`);
            continue;
        }
        if (typeof val === 'string') {
            // Не локализовано — только одна строка, допустимо для существующих адаптеров
            warnings.push(`io-package.json common.${key} не локализован (одна строка); для нового адаптера требуется объект с 11 языками`);
            continue;
        }
        if (typeof val !== 'object' || Array.isArray(val)) {
            errors.push(`io-package.json common.${key} должен быть объектом локализаций или строкой`);
            continue;
        }
        const langs = Object.keys(val);
        const missing = REQUIRED_LANGS.filter(l => !langs.includes(l));
        if (missing.length > 0) {
            errors.push(`io-package.json common.${key}: отсутствуют переводы для языков: ${missing.join(', ')}`);
        }
        const empty = langs.filter(l => !val[l] || String(val[l]).trim() === '');
        if (empty.length > 0) {
            errors.push(`io-package.json common.${key}: пустые переводы для языков: ${empty.join(', ')}`);
        }
    }
}

// --- 2. Проверка jsonConfig i18n ---
function checkJsonConfigI18n() {
    const jsonConfigPaths = [
        path.join(ROOT, 'admin', 'jsonConfig.json'),
        path.join(ROOT, 'admin', 'jsonConfig.json5'),
    ];
    let found = false;
    for (const p of jsonConfigPaths) {
        if (fs.existsSync(p)) {
            found = true;
            // Базовая проверка существования файла; детальная валидация схемы выполняется tests.packageFiles
            console.log(`INFO: найден jsonConfig: ${p}`);
        }
    }
    if (!found) {
        warnings.push('jsonConfig.json(5) не найден в admin/ — проверь, используется ли jsonConfig для Admin UI');
    }
}

// --- 3. Проверка React i18n (если используется React UI) ---
function checkReactI18n() {
    const localesDir = path.join(ROOT, 'src', 'locales');
    if (fs.existsSync(localesDir)) {
        const dirs = fs.readdirSync(localesDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
        const missing = REQUIRED_LANGS.filter(l => !dirs.includes(l));
        if (missing.length > 0) {
            errors.push(`React i18n: отсутствуют локали для языков: ${missing.join(', ')}`);
        }
    }
}

// --- 4. Проверка admin/i18n (устаревший путь, только предупреждение) ---
function checkLegacyAdminI18n() {
    const adminI18nDir = path.join(ROOT, 'admin', 'i18n');
    if (fs.existsSync(adminI18nDir)) {
        warnings.push('admin/i18n/ обнаружен — это устаревший путь переводов; для jsonConfig используй локали внутри jsonConfig.json(5), для React — src/locales/');
    }
}

checkIoPackageLocalized();
checkJsonConfigI18n();
checkReactI18n();
checkLegacyAdminI18n();

console.log(`\nПроверка переводов завершена: ${errors.length} ошибок, ${warnings.length} предупреждений.`);
for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

if (errors.length > 0) process.exitCode = 1;