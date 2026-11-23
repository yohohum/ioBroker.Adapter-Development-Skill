#!/usr/bin/env node
// Единая проверка workflow публикации. Вызывается из release-preflight.mjs
// и validate-skill.mjs, чтобы оба скрипта применяли одинаковые правила.

import { validateRequiredActions } from './action-refs.mjs';
import { validateDeployCondition, validateDeployNeeds } from './deploy-condition.mjs';

export const REQUIRED_JOBS = ['check-and-lint', 'adapter-tests', 'deploy'];
export const REQUIRED_NODE_VERSIONS = ['22', '24', '26'];
export const REQUIRED_OS = ['ubuntu-latest', 'windows-latest', 'macos-latest'];
export { validateWorkflowActions } from './action-refs.mjs';

function checkRequiredJobs(jobs, wfName, errors) {
    for (const jobName of REQUIRED_JOBS) {
        if (!jobs[jobName]) {
            errors.push(`${wfName}: отсутствует обязательный job "${jobName}".`);
        }
    }
}

function checkNodeMatrix(jobs, wfName, errors) {
    const job = jobs['adapter-tests'];
    if (!job) {
        errors.push(`${wfName}: отсутствует job "adapter-tests" — обязателен для кросс-платформенного тестирования.`);
        return;
    }
    const matrix = job.strategy?.matrix;
    if (!matrix) {
        errors.push(`${wfName}: job "adapter-tests": отсутствует strategy.matrix — обязательна для тестирования на нескольких версиях Node.js.`);
        return;
    }
    const nodeVersions = matrix['node-version'];
    if (!Array.isArray(nodeVersions)) {
        errors.push(`${wfName}: job "adapter-tests": matrix['node-version'] должен быть массивом, получен: ${typeof nodeVersions}.`);
        return;
    }
    const missing = REQUIRED_NODE_VERSIONS.filter((version) => !nodeVersions.includes(version));
    if (missing.length > 0) {
        errors.push(`${wfName}: job "adapter-tests": неполная матрица Node.js, отсутствуют версии: ${missing.join(', ')}.`);
    }
}

function checkOSMatrix(jobs, wfName, errors) {
    const job = jobs['adapter-tests'];
    if (!job) return;
    const matrix = job.strategy?.matrix;
    if (!matrix) {
        errors.push(`${wfName}: job "adapter-tests": отсутствует strategy.matrix — обязательна для тестирования на разных ОС.`);
        return;
    }
    const osList = matrix.os;
    if (!Array.isArray(osList)) {
        errors.push(`${wfName}: job "adapter-tests": matrix['os'] должен быть массивом, получен: ${typeof osList}.`);
        return;
    }
    const missing = REQUIRED_OS.filter((os) => !osList.includes(os));
    if (missing.length > 0) {
        errors.push(`${wfName}: job "adapter-tests": неполная матрица OS, отсутствуют: ${missing.join(', ')}.`);
    }
}

function checkNoManualPublish(jobs, wfName, errors) {
    for (const [jobName, job] of Object.entries(jobs)) {
        const steps = Array.isArray(job?.steps) ? job.steps : [];
        for (const step of steps) {
            if (typeof step?.run === 'string' && /\b(?:npm|pnpm|yarn)\s+publish\b/.test(step.run)) {
                errors.push(
                    `${wfName}: job "${jobName}" содержит прямой вызов "npm publish". ` +
                    'Используйте ioBroker/testing-action-deploy@v1 вместо ручной публикации.'
                );
            }
        }
    }
}

export function validatePublishWorkflow(jobs, options = {}) {
    const { wfName = 'workflow' } = options;
    const safeJobs = jobs && typeof jobs === 'object' && !Array.isArray(jobs) ? jobs : {};
    const errors = [];
    const warnings = [];
    const reviews = [];

    checkRequiredJobs(safeJobs, wfName, errors);

    const actionResult = validateRequiredActions(safeJobs, wfName);
    errors.push(...actionResult.errors);
    warnings.push(...actionResult.warnings);
    reviews.push(...actionResult.reviews);

    checkNodeMatrix(safeJobs, wfName, errors);
    checkOSMatrix(safeJobs, wfName, errors);

    if (safeJobs.deploy) {
        const needsResult = validateDeployNeeds(safeJobs, wfName);
        errors.push(...needsResult.errors);

        const conditionResult = validateDeployCondition(safeJobs.deploy.if);
        errors.push(...conditionResult.errors);
        reviews.push(...conditionResult.reviews);
    }

    checkNoManualPublish(safeJobs, wfName, errors);

    return { errors, warnings, reviews };
}
