#!/usr/bin/env node
// Structural validator for the custom tag-based Trusted Publishing release
// profile. It is intentionally separate from the standard create-adapter
// validator: the standard profile requires the official ioBroker template and
// Actions, while this profile allows a reviewed tag-driven workflow that
// publishes through npm Trusted Publishing (OIDC) without long-lived tokens.
//
// The validator does not replace the shared Action policy validator. Callers
// must still run validateWorkflowFile() first so that unknown Actions, floating
// refs, local reusable workflows, composite actions, symlinks, duplicate YAML
// keys and inputs/secrets are checked for both profiles.

import { validateDeployCondition } from './deploy-condition.mjs';

const PUBLISH_COMMAND = /\b(?:npm|pnpm|yarn)\s+(?:publish|stage\s+publish)\b/i;
const FORBIDDEN_EVENTS = [
    'workflow_dispatch',
    'schedule',
    'repository_dispatch',
    'workflow_run',
    'pull_request_target',
    'release',
];
const ALLOWED_PERMISSION_KEYS = new Set([
    'actions',
    'attestations',
    'checks',
    'contents',
    'deployments',
    'id-token',
    'issues',
    'models',
    'packages',
    'pull-requests',
    'security-events',
    'statuses',
]);
const TOKEN_VALUE_PATTERN = /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|npm[_-]?token/i;

function asArray(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function normalizeEvents(onValue) {
    if (typeof onValue === 'string') return { [onValue]: {} };
    if (onValue && typeof onValue === 'object' && !Array.isArray(onValue)) return onValue;
    return null;
}

function isReleaseTagPattern(pattern) {
    // GitHub filters are globs; only accept the broad prefix as an event
    // selector and require an exact SemVer check before deployment.
    return pattern === 'v*';
}

function jobText(job) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    return steps.map((step) => [
        typeof step?.run === 'string' ? step.run : '',
        typeof step?.uses === 'string' ? step.uses : '',
        JSON.stringify(step?.with ?? {}),
        JSON.stringify(step?.env ?? {}),
    ].join(' ')).join('\n');
}

function jobHasValidationContent(job) {
    const text = jobText(job);
    const strongCommands = /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|lint|test(?::[A-Za-z0-9_-]+)?)\b/i.test(text);
    const approvedTestActions = /ioBroker\/testing-action-(?:check|adapter)@(?:v1|v2)\b/i.test(text);
    return strongCommands || approvedTestActions;
}

function jobHasTestContent(job) {
    const text = jobText(job);
    return /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test(?::[A-Za-z0-9_-]+)?)\b/i.test(text) ||
        /ioBroker\/testing-action-adapter@v1\b/i.test(text);
}

function jobHasLintOrBuildContent(job) {
    const text = jobText(job);
    return /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|lint)\b/i.test(text) ||
        /ioBroker\/testing-action-check@v2\b/i.test(text);
}

function jobIsTagEligible(job) {
    if (job?.if === undefined || job?.if === null || String(job.if).trim() === '') return true;
    const condition = String(job.if);
    if (/(?:always|failure|cancelled)\s*\(/i.test(condition)) return false;
    const mentionsTag = /refs\/tags|ref_type\s*==\s*['"]tag|event_name\s*==\s*['"]push/i.test(condition);
    if (mentionsTag) return true;
    if (/pull_request|refs\/heads|head_ref|base_ref/i.test(condition)) return false;
    return false;
}

function isVersionConsistencyStep(step) {
    const run = typeof step?.run === 'string' ? step.run : '';
    if (!run) return false;
    const tagVersion = /TAG_VERSION\s*=\s*["'][^"']*GITHUB_REF_NAME[^"']*["']/i.test(run) ||
        /GITHUB_REF_NAME[^\n]*(?:replace|slice|substring)/i.test(run);
    const packageVersion = /(?:PKG_VERSION|PACKAGE_VERSION)\s*=\s*[^\n]*package\.json/i.test(run) ||
        /node\s+-p[^\n]*package\.json/i.test(run);
    const ioVersion = /(?:IO_VERSION|IO_PACKAGE_VERSION)\s*=\s*[^\n]*io-package\.json/i.test(run) ||
        /node\s+-p[^\n]*io-package\.json/i.test(run);
    const comparesVersions = /\[\[[\s\S]*?(?:TAG_VERSION|tagVersion)[\s\S]*?(?:PKG_VERSION|PACKAGE_VERSION)[\s\S]*?\|\|[\s\S]*?(?:IO_VERSION|IO_PACKAGE_VERSION)[\s\S]*?\]\]|(?:TAG_VERSION|tagVersion)[\s\S]*(?:PKG_VERSION|PACKAGE_VERSION)[\s\S]*(?:IO_VERSION|IO_PACKAGE_VERSION)/i.test(run);
    const failsClosed = /exit\s+1|::error|throw\s+new\s+Error|process\.exit\(1\)/i.test(run);
    const validatesSemverTag = /\^v\[0-9\].*\[0-9\].*\[0-9\]|semver\.valid|valid(?:ate)?\s+(?:release\s+)?tag/i.test(run);
    return tagVersion && packageVersion && ioVersion && comparesVersions && failsClosed && validatesSemverTag;
}

function collectTokenFindings(value, path = 'workflow') {
    const findings = [];
    if (typeof value === 'string') {
        if (TOKEN_VALUE_PATTERN.test(value)) findings.push(`${path}: значение содержит npm token или auth token`);
        return findings;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => findings.push(...collectTokenFindings(item, `${path}[${index}]`)));
        return findings;
    }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (TOKEN_VALUE_PATTERN.test(key)) findings.push(`${path}.${key}: недопустимый npm token input/переменная`);
            else findings.push(...collectTokenFindings(child, `${path}.${key}`));
        }
    }
    return findings;
}

function normalizePermissions(value, errors, location) {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${location}: permissions должны быть mapping с явными правами, а не "${String(value)}".`);
        return {};
    }
    const result = {};
    for (const [key, permission] of Object.entries(value)) {
        if (!ALLOWED_PERMISSION_KEYS.has(key)) {
            errors.push(`${location}: неизвестное permission "${key}".`);
            continue;
        }
        if (!['read', 'write', 'none'].includes(String(permission))) {
            errors.push(`${location}: permission "${key}" имеет недопустимое значение "${String(permission)}".`);
            continue;
        }
        if (String(permission) === 'write' && !['contents', 'id-token'].includes(key)) {
            errors.push(`${location}: избыточное permission "${key}: write" не допускается в custom-approved.`);
        }
        result[key] = String(permission);
    }
    return result;
}

function effectivePermissions(workflow, job, errors, wfName) {
    const top = normalizePermissions(workflow.permissions, errors, `${wfName}: permissions`);
    const jobPermissions = normalizePermissions(job.permissions, errors, `${wfName}: job "deploy" permissions`);
    const effective = { ...top, ...jobPermissions };
    if ((top.contents === 'write' || top['id-token'] === 'write') && job.permissions === undefined) errors.push(`${wfName}: write permissions contents/id-token должны быть ограничены deploy job, не workflow-wide.`);
    return effective;
}

function hasSetupNodeWithRegistry(job) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    return steps.some((step) => step?.uses === 'actions/setup-node@v6' &&
        typeof step?.with?.['registry-url'] === 'string' &&
        step.with['registry-url'].includes('registry.npmjs.org'));
}

function hasGitHubReleaseStep(job) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    return steps.some((step) =>
        step?.uses === 'softprops/action-gh-release@v3' ||
        (typeof step?.run === 'string' && /\bgh\s+release\s+create\b/i.test(step.run)));
}

function findPublishSteps(job) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    return steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => typeof step?.run === 'string' && /\b(?:npm|pnpm|yarn)\s+(?:publish|stage\s+publish)\b/i.test(step.run));
}

function hasVersionGuardBeforePublish(job, publishIndex) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    return steps.slice(0, publishIndex).some((step) => {
        const run = typeof step?.run === 'string' ? step.run : '';
        const checksRegistry = /\bnpm\s+view\b/i.test(run);
        const checksVersion = /GITHUB_REF_NAME|package\.json|npm\s+pkg\s+get\s+version/i.test(run);
        const rejectsExisting = /if\s+[^\n]*(?:npm\s+view|VERSION_EXISTS|already\s+published)[^\n]*;?\s*then[\s\S]*?(?:exit\s+1|::error)/i.test(run) ||
            /npm\s+view[\s\S]*?if\s+[^\n]*(?:npm\s+view|VERSION_EXISTS)[\s\S]*?exit\s+1/i.test(run);
        return checksRegistry && checksVersion && rejectsExisting;
    });
}

export function validateCustomReleaseWorkflow(workflow, { wfName = 'workflow' } = {}) {
    const errors = [];
    const warnings = [];
    const reviews = [];

    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
        return { errors: [`${wfName}: workflow должен быть mapping.`], warnings, reviews };
    }

    const events = normalizeEvents(workflow.on);
    if (!events) {
        errors.push(`${wfName}: отсутствует корректный блок on.`);
        return { errors, warnings, reviews };
    }
    for (const event of FORBIDDEN_EVENTS) {
        if (Object.hasOwn(events, event)) {
            errors.push(`${wfName}: событие "${event}" не допускается в профиле custom-approved. Публикация должна запускаться по push релизного тега.`);
        }
    }
    if (!Object.hasOwn(events, 'push')) {
        errors.push(`${wfName}: отсутствует событие push с фильтром релизных тегов.`);
    } else {
        const push = events.push;
        if (!push || typeof push !== 'object' || Array.isArray(push)) {
            errors.push(`${wfName}: on.push должен содержать фильтр tags с релизными тегами, а не запускаться на любые ветки.`);
        } else {
            const tags = push.tags;
            if (!Array.isArray(tags) || tags.length === 0) {
                errors.push(`${wfName}: on.push.tags должен быть непустым массивом релизных тегов (например "v[0-9]+.[0-9]+.[0-9]+").`);
            } else if (tags.length !== 1 || !tags.every(isReleaseTagPattern)) {
                errors.push(`${wfName}: on.push.tags должен содержать GitHub glob "v*" для релизных тегов vX.Y.Z. Получено: ${tags.map((tag) => JSON.stringify(tag)).join(', ')}.`);
            }
            if (Object.hasOwn(push, 'branches') || Object.hasOwn(push, 'branches-ignore')) {
                errors.push(`${wfName}: custom-approved workflow должен запускаться только по release tags; branch push trigger запрещён.`);
            }
            if (Object.hasOwn(push, 'tags-ignore')) {
                errors.push(`${wfName}: on.push.tags-ignore не допускается; используйте явный allowlist on.push.tags.`);
            }
        }
    }

    const jobs = workflow.jobs;
    if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) {
        errors.push(`${wfName}: отсутствует корректный mapping jobs.`);
        return { errors, warnings, reviews };
    }
    const jobNames = Object.keys(jobs);
    for (const [eventName, config] of Object.entries(events)) {
        if (!['push', 'pull_request'].includes(eventName)) errors.push(`${wfName}: событие "${eventName}" запрещено custom-approved.`);
        if (eventName === 'pull_request' && config?.branches !== undefined && (!Array.isArray(config.branches) || config.branches.length === 0 || config.branches.some((branch) => !['main', 'master'].includes(branch)))) errors.push(`${wfName}: pull_request branches разрешает только main/master.`);
    }
    if (!Object.hasOwn(jobs, 'deploy')) {
        errors.push(`${wfName}: отсутствует обязательный job "deploy".`);
        return { errors, warnings, reviews };
    }
    const deploy = jobs.deploy;
    if (!deploy || typeof deploy !== 'object' || Array.isArray(deploy)) {
        errors.push(`${wfName}: job "deploy" должен быть mapping.`);
        return { errors, warnings, reviews };
    }

    const postDeployJobs = jobNames.filter((name) => name !== 'deploy' && asArray(jobs[name]?.needs).includes('deploy'));
    if (postDeployJobs.length > 0) {
        errors.push(`${wfName}: jobs, зависящие от deploy (${postDeployJobs.join(', ')}), не поддерживаются профилем custom-approved. Создавайте GitHub Release внутри deploy или через ioBroker/testing-action-deploy.`);
    }

    const validationJobNames = jobNames.filter((name) => name !== 'deploy' && !postDeployJobs.includes(name));
    for (const name of validationJobNames) {
        const job = jobs[name];
        if (job?.needs !== undefined && !Array.isArray(job.needs) && typeof job.needs !== 'string') {
            errors.push(`${wfName}: job "${name}" needs должен быть строкой или массивом job ids.`);
        }
        for (const prerequisite of asArray(job?.needs)) {
            if (!Object.hasOwn(jobs, prerequisite)) errors.push(`${wfName}: job "${name}" зависит от отсутствующего job "${prerequisite}".`);
        }
        if (job?.['continue-on-error'] === true) errors.push(`${wfName}: validation job "${name}" не может использовать continue-on-error: true.`);
    }
    if (validationJobNames.length === 0) {
        errors.push(`${wfName}: должен быть хотя бы один job с обязательными build/lint/test проверками до deploy.`);
    }

    const needs = asArray(deploy.needs);
    for (const name of validationJobNames) {
        if (!needs.includes(name)) {
            errors.push(`${wfName}: job "deploy" не зависит от обязательного job "${name}". Публикация не должна выполняться при пропущенных или упавших проверках.`);
        }
    }
    for (const dependency of needs) {
        if (!Object.hasOwn(jobs, dependency)) {
            errors.push(`${wfName}: job "deploy" зависит от несуществующего job "${dependency}".`);
        }
    }

    for (const name of validationJobNames) {
        const job = jobs[name];
        if (!job || typeof job !== 'object' || Array.isArray(job)) {
            errors.push(`${wfName}: job "${name}" должен быть mapping.`);
            continue;
        }
        if (job['continue-on-error'] === true) {
            errors.push(`${wfName}: job "${name}" не может иметь continue-on-error: true — это скрывает провал обязательных проверок.`);
        }
        if (!jobHasValidationContent(job)) {
            errors.push(`${wfName}: job "${name}" не содержит распознаваемых build/lint/test проверок.`);
        }
        if (!jobIsTagEligible(job)) {
            errors.push(`${wfName}: job "${name}" имеет условие, которое может пропустить обязательную проверку при релизном теге: ${String(job.if)}.`);
        }
    }

    const testJobs = validationJobNames.filter((name) => jobHasTestContent(jobs[name]));
    const lintBuildJobs = validationJobNames.filter((name) => jobHasLintOrBuildContent(jobs[name]));
    if (testJobs.length === 0) {
        errors.push(`${wfName}: не найден job с обязательными тестами (npm test / test:package / test:integration или ioBroker/testing-action-adapter).`);
    }
    if (lintBuildJobs.length === 0) {
        errors.push(`${wfName}: не найден job с обязательными build/lint проверками (npm run build / npm run lint или ioBroker/testing-action-check).`);
    }
    const requiredGateNames = ['check-and-lint', 'adapter-tests'];
    for (const requiredName of requiredGateNames) {
        if (!Object.hasOwn(jobs, requiredName)) errors.push(`${wfName}: отсутствует обязательный release validation job "${requiredName}".`);
    }
    const requiredGatePaths = validationJobNames.filter((name) => requiredGateNames.includes(name));
    if (requiredGatePaths.length === requiredGateNames.length && requiredGatePaths.some((name) => !needs.includes(name))) {
        errors.push(`${wfName}: deploy needs должны включать обе обязательные группы проверки: check-and-lint и adapter-tests.`);
    }

    if (deploy['continue-on-error'] === true) {
        errors.push(`${wfName}: job "deploy" не может иметь continue-on-error: true.`);
    }
    if (deploy.environment && (typeof deploy.environment !== 'object' || typeof deploy.environment.name !== 'string' || !deploy.environment.name.trim())) {
        errors.push(`${wfName}: deploy environment должен иметь проверяемое статическое имя, если задан.`);
    }

    const permissions = effectivePermissions(workflow, deploy, errors, wfName);
    if (permissions['id-token'] !== 'write') {
        errors.push(`${wfName}: deploy требует permission "id-token: write" для npm Trusted Publishing через OIDC.`);
    }
    if (permissions.contents !== 'write') {
        errors.push(`${wfName}: deploy требует permission "contents: write" для GitHub Release.`);
    }
    for (const [name, job] of Object.entries(jobs)) {
        if (name === 'deploy') continue;
        const local = normalizePermissions(job?.permissions, errors, `${wfName}: job "${name}" permissions`);
        if (local['id-token'] === 'write' || local.contents === 'write' || local.packages === 'write') {
            errors.push(`${wfName}: validation job "${name}" не должен иметь write permissions.`);
        }
    }

    const conditionResult = validateDeployCondition(deploy.if);
    errors.push(...conditionResult.errors);
    reviews.push(...conditionResult.reviews);

    const tokenFindings = collectTokenFindings(workflow);
    errors.push(...tokenFindings);

    const allPublishSteps = [];
    for (const [name, job] of Object.entries(jobs)) {
        for (const publishStep of findPublishSteps(job)) {
            allPublishSteps.push({ jobName: name, ...publishStep });
        }
    }
    const nonDeployPublish = allPublishSteps.filter(({ jobName }) => jobName !== 'deploy');
    for (const { jobName, index } of nonDeployPublish) {
        errors.push(`${wfName}: прямой publish в job "${jobName}" step ${index + 1} запрещён. Публикация допускается только в job "deploy" по разрешённому контракту.`);
    }

    const deployPublishSteps = findPublishSteps(deploy);
    const deployActionSteps = (Array.isArray(deploy.steps) ? deploy.steps : [])
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step?.uses === 'ioBroker/testing-action-deploy@v1');
    for (const [name, job] of Object.entries(jobs)) {
        if (name === 'deploy') continue;
        for (const [index, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
            const run = typeof step?.run === 'string' ? step.run : '';
            if (/\b(?:npm|pnpm|yarn)\s+(?:publish|stage\s+publish)\b/i.test(run) ||
                step?.uses === 'ioBroker/testing-action-deploy@v1' || step?.uses === 'softprops/action-gh-release@v3' ||
                /\bgh\s+release\s+create\b/i.test(run)) {
                errors.push(`${wfName}: непредусмотренный publish/release step в job "${name}" step ${index + 1}.`);
            }
        }
    }
    const publishCount = deployPublishSteps.length + deployActionSteps.length;
    if (publishCount === 0) {
        errors.push(`${wfName}: job "deploy" не содержит разрешённого механизма публикации (ioBroker/testing-action-deploy@v1 или ограниченный npm publish --provenance).`);
    } else if (publishCount > 1) {
        errors.push(`${wfName}: job "deploy" содержит несколько publish step; повторная или параллельная публикация запрещена.`);
    }

    const deploySteps = Array.isArray(deploy.steps) ? deploy.steps : [];
    const versionCheckSteps = deploySteps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => isVersionConsistencyStep(step));
    if (versionCheckSteps.length === 0) {
        errors.push(`${wfName}: job "deploy" должен содержать step проверки соответствия тега версиям package.json и io-package.json до публикации (GITHUB_REF_NAME, package.json, io-package.json, fail closed).`);
    }

    const publishLikeSteps = [];
    for (const [jobName, job] of Object.entries(jobs)) {
        for (const [index, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
            const uses = typeof step?.uses === 'string' ? step.uses : '';
            const run = typeof step?.run === 'string' ? step.run : '';
            if (/\b(?:npm|pnpm|yarn)\s+(?:publish|stage\s+publish)\b/i.test(run)) publishLikeSteps.push({ jobName, step, index, kind: 'publish' });
            if (uses === 'ioBroker/testing-action-deploy@v1') publishLikeSteps.push({ jobName, step, index, kind: 'deploy-action' });
            if (uses === 'softprops/action-gh-release@v3' || /\bgh\s+release\s+create\b/i.test(run)) publishLikeSteps.push({ jobName, step, index, kind: 'release' });
        }
    }
    const githubReleaseSteps = deploySteps.filter((step) => step?.uses === 'softprops/action-gh-release@v3' || (typeof step?.run === 'string' && /\bgh\s+release\s+create\b/i.test(step.run)));
    if (publishLikeSteps.some(({ jobName }) => jobName !== 'deploy') || publishLikeSteps.filter(({ kind }) => kind === 'publish').length !== deployPublishSteps.length ||
        publishLikeSteps.filter(({ kind }) => kind === 'deploy-action').length !== deployActionSteps.length ||
        publishLikeSteps.filter(({ kind }) => kind === 'release').length !== githubReleaseSteps.length) {
        errors.push(`${wfName}: обнаружен непредусмотренный дополнительный publish/release path.`);
    }
    for (const { jobName, step, index } of publishLikeSteps) {
        if (jobName !== 'deploy') errors.push(`${wfName}: publish/release step в job "${jobName}" step ${index + 1} запрещён.`);
        if (step?.if !== undefined && step.if !== null && String(step.if).trim() !== '') {
            const stepCondition = validateDeployCondition(step.if);
            errors.push(...stepCondition.errors);
            reviews.push(...stepCondition.reviews);
        }
    }

    if (deployActionSteps.length === 1) {
        const deployStep = deployActionSteps[0].step;
        if (deployStep.if !== undefined && deployStep.if !== null && String(deployStep.if).trim() !== '') {
            errors.push(`${wfName}: ioBroker/testing-action-deploy publish step не должен иметь отдельное условие, обходящее deploy gate.`);
        }
        if (Object.hasOwn(deployStep.with ?? {}, 'npm-token') &&
            deployStep.with['npm-token'] !== null &&
            String(deployStep.with['npm-token']).trim() !== '') {
            errors.push(`${wfName}: ioBroker/testing-action-deploy@v1 не должен получать npm-token при Trusted Publishing.`);
        }
        if (versionCheckSteps.length > 0 && versionCheckSteps[0].index > deployActionSteps[0].index) {
            errors.push(`${wfName}: проверка версии должна выполняться до publish step.`);
        }
    }

    if (deployPublishSteps.length === 1) {
        const { step, index } = deployPublishSteps[0];
        const run = String(step.run);
        if (/--force\b/.test(run)) {
            errors.push(`${wfName}: npm publish не должен использовать --force.`);
        }
        if (/--no-provenance\b|NPM_CONFIG_PROVENANCE\s*=\s*false|provenance\s*=\s*false/i.test(run)) {
            errors.push(`${wfName}: npm publish не должен отключать provenance при Trusted Publishing.`);
        }
        if (TOKEN_VALUE_PATTERN.test(run)) {
            errors.push(`${wfName}: npm publish не должен ссылаться на npm token; используйте OIDC.`);
        }
        if (!hasSetupNodeWithRegistry(deploy)) {
            errors.push(`${wfName}: для ручного npm publish требуется actions/setup-node@v6 с registry-url: https://registry.npmjs.org.`);
        }
        if (!hasVersionGuardBeforePublish(deploy, index)) {
            errors.push(`${wfName}: перед ручным npm publish требуется fail-closed проверка отсутствия уже опубликованной версии (npm view + exit 1).`);
        }
        if (!hasGitHubReleaseStep(deploy)) {
            errors.push(`${wfName}: для ручного npm publish требуется step создания GitHub Release (gh release create или softprops/action-gh-release@v3).`);
        }
        if (versionCheckSteps.length > 0 && versionCheckSteps[0].index > index) {
            errors.push(`${wfName}: проверка версии должна выполняться до publish step.`);
        }
        const publishWith = step.with ?? {};
        const publishEnv = step.env ?? {};
        if (publishWith['access'] === 'public' || publishWith['provenance'] === false) {
            errors.push(`${wfName}: npm publish inputs не должны изменять public/provenance defaults bypass-значениями.`);
        }
        const setupNodeIndex = deploySteps.findIndex((candidate) => candidate?.uses === 'actions/setup-node@v6' && candidate?.with?.['registry-url'] === 'https://registry.npmjs.org');
        if (setupNodeIndex < 0 || setupNodeIndex > index) errors.push(`${wfName}: setup-node registry config должен быть до npm publish.`);
        const nodeVersions = deploySteps.filter((candidate) => candidate?.uses === 'actions/setup-node@v6').map((candidate) => candidate?.with?.['node-version']).filter(Boolean);
        if (!nodeVersions.some((version) => Number.parseInt(String(version), 10) >= 22)) errors.push(`${wfName}: npm Trusted Publishing требует Node.js >=22.14.0.`);
        const npmVersion = deploySteps.find((candidate) => typeof candidate?.run === 'string' && /npm\s+(?:install|ci).*npm@|npm\s+install\s+-g\s+npm/i.test(candidate.run));
        if (!npmVersion) errors.push(`${wfName}: ручной npm publish должен гарантировать npm CLI >=11.5.1 в deploy job.`);
    }

    if (deployActionSteps.length === 1) {
        // ioBroker/testing-action-deploy creates the GitHub Release itself and
        // npm rejects duplicate versions, so an extra release step is optional.
        if (!hasGitHubReleaseStep(deploy)) {
            warnings.push(`${wfName}: GitHub Release создаётся внутри ioBroker/testing-action-deploy@v1; отдельный release step не требуется.`);
        }
    }

    if (conditionResult.normalized && !/refs\/tags\/v|ref_type\s*==\s*['"]tag/i.test(conditionResult.normalized)) {
        errors.push(`${wfName}: условие deploy должно явно ограничивать публикацию релизным тегом.`);
    }

    return { errors, warnings, reviews };
}

export { isReleaseTagPattern, isVersionConsistencyStep };
