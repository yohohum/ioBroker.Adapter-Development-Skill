#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const input = process.argv[2];
if (!input || input === '--help' || input === '-h') {
    console.log('Usage: node scripts/check-object-dump.mjs <OBJECTDUMP.json>');
    console.log('Accepts a JSON array of objects or a JSON object map keyed by object ID.');
    console.log('This is a supplemental structural check, not the official ioBroker schema validator.');
    process.exit(input ? 0 : 2);
}

const file = path.resolve(input);
let parsed;
try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
    console.error(`Cannot read/parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

let objects;
if (Array.isArray(parsed)) {
    objects = parsed;
} else if (parsed && typeof parsed === 'object') {
    const candidate = parsed.objects && typeof parsed.objects === 'object' ? parsed.objects : parsed;
    objects = Array.isArray(candidate)
        ? candidate
        : Object.entries(candidate).map(([id, object]) => ({ _id: id, ...object }));
} else {
    console.error('Unsupported dump format. Expected JSON array or object map.');
    process.exit(1);
}

const errors = [];
const warnings = [];
const seen = new Set();
let stateCount = 0;

for (const [index, object] of objects.entries()) {
    const label = object?._id ?? `index ${index}`;
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
        errors.push(`${label}: entry must be an object.`);
        continue;
    }
    if (typeof object._id !== 'string' || !object._id.trim()) {
        errors.push(`${label}: missing non-empty _id.`);
    } else if (seen.has(object._id)) {
        errors.push(`${label}: duplicate _id ${object._id}.`);
    } else {
        seen.add(object._id);
    }
    if (typeof object.type !== 'string') {
        errors.push(`${label}: missing string type.`);
        continue;
    }
    if (object.type !== 'state') continue;
    stateCount += 1;
    const common = object.common;
    if (!common || typeof common !== 'object') {
        errors.push(`${label}: state common must be an object.`);
        continue;
    }
    if (typeof common.type !== 'string' || !common.type) errors.push(`${label}: state common.type is missing.`);
    if (typeof common.role !== 'string' || !common.role.trim()) {
        errors.push(`${label}: state common.role is missing.`);
    } else if (common.role === 'state') {
        errors.push(`${label}: generic role "state" is not an acceptable substitute for a semantic role.`);
    }
    if (typeof common.read !== 'boolean') errors.push(`${label}: state common.read must be boolean.`);
    if (typeof common.write !== 'boolean') errors.push(`${label}: state common.write must be boolean.`);

    if (typeof common.role === 'string' && common.role.startsWith('indicator')) {
        if (common.type !== 'boolean') errors.push(`${label}: indicator role requires boolean type according to STATE_ROLES.md.`);
        if (common.read !== true) errors.push(`${label}: indicator role should be readable (common.read=true).`);
        if (common.write !== false) errors.push(`${label}: indicator role must be read-only (common.write=false).`);
    }
    if (common.role === 'button') {
        if (common.type !== 'boolean') errors.push(`${label}: button role is expected to use boolean type; verify current STATE_ROLES.md.`);
        if (common.read !== false || common.write !== true) errors.push(`${label}: role button should use read=false and write=true according to current repochecker checks; verify the current role documentation.`);
    }
    if (common.type === 'number') {
        if (common.min !== undefined && typeof common.min !== 'number') errors.push(`${label}: common.min must be numeric for number state.`);
        if (common.max !== undefined && typeof common.max !== 'number') errors.push(`${label}: common.max must be numeric for number state.`);
        if (typeof common.min === 'number' && typeof common.max === 'number' && common.min > common.max) errors.push(`${label}: common.min is greater than common.max.`);
    }
}

console.log(`Read ${objects.length} object(s), including ${stateCount} state(s).`);
for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) {
    console.error(`Structural check failed: ${errors.length} error(s).`);
    process.exit(1);
}
console.log('Structural check passed. Confirm all roles against the current official STATE_ROLES.md and run repochecker.');
