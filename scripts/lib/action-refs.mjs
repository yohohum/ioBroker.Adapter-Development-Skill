#!/usr/bin/env node
// Explicit allowlist for external GitHub Actions in the default profile.
// Refs and inputs are rechecked for every step and reusable-workflow use.
export const OFFICIAL_ACTIONS = [
    {
        name: 'actions/checkout', allowedRefs: ['v6'], inputs: [
            'repository', 'ref', 'token', 'ssh-key', 'ssh-known-hosts', 'ssh-strict', 'ssh-user',
            'persist-credentials', 'path', 'clean', 'filter', 'sparse-checkout', 'sparse-checkout-cone-mode',
            'fetch-depth', 'fetch-tags', 'show-progress', 'lfs', 'submodules', 'set-safe-directory',
            'github-server-url', 'allow-unsafe-pr-checkout'
        ], requiredInputGroups: [], kind: 'step',
    },
    {
        name: 'actions/setup-node', allowedRefs: ['v6'], inputs: [
            'node-version', 'node-version-file', 'architecture', 'check-latest', 'registry-url', 'scope', 'token',
            'cache', 'package-manager-cache', 'cache-dependency-path', 'mirror', 'mirror-token'
        ], requiredInputGroups: [['node-version', 'node-version-file']], kind: 'step',
    },
    {
        name: 'ioBroker/testing-action-check', job: 'check-and-lint', allowedRefs: ['v2'], inputs: [
            'node-version', 'install-command', 'package-cache', 'type-checking', 'type-checking-command',
            'lint', 'lint-command', 'test-command'
        ], requiredInputGroups: [['node-version']], kind: 'step',
    },
    {
        name: 'ioBroker/testing-action-adapter', job: 'adapter-tests', allowedRefs: ['v1'], inputs: [
            'node-version', 'engine-strict', 'install-command', 'package-cache', 'os', 'build', 'build-command',
            'extra-tests', 'unit-test-check-pattern', 'unit-test-command', 'integration-test-command', 'screenshots-path'
        ], requiredInputGroups: [['node-version'], ['os']], kind: 'step',
    },
    {
        name: 'ioBroker/testing-action-deploy', job: 'deploy', allowedRefs: ['v1'], inputs: [
            'node-version', 'install-command', 'package-cache', 'build', 'build-command', 'npm-token', 'tag',
            'github-token', 'sentry', 'sentry-token', 'sentry-url', 'sentry-org', 'sentry-project',
            'sentry-version-prefix', 'sentry-github-integration', 'sentry-sourcemap-paths'
        ], requiredInputGroups: [['node-version'], ['github-token']], kind: 'step',
    },
];

function splitUses(uses) {
    if (typeof uses !== 'string' || uses.trim() !== uses || uses.length === 0) return null;
    const at = uses.lastIndexOf('@');
    if (at < 1 || at === uses.length - 1) return { repo: at < 0 ? uses : uses.slice(0, at), ref: at < 0 ? null : '', raw: uses };
    return { repo: uses.slice(0, at), ref: uses.slice(at + 1), raw: uses };
}

function validateEntry(uses, inputsValue, context, wfName, errors) {
    const parsed = splitUses(uses);
    if (!parsed || !parsed.ref || parsed.repo.split('/').length !== 2) {
        errors.push(`${wfName}: некорректный uses "${String(uses)}" в ${context}. Требуется owner/repository@разрешённый-ref.`);
        return null;
    }
    const policy = OFFICIAL_ACTIONS.find((item) => item.name === parsed.repo);
    if (!policy) {
        errors.push(`${wfName}: неизвестный или неразрешённый внешний Action/workflow "${uses}" в ${context}.`);
        return null;
    }
    if (!policy.allowedRefs.includes(parsed.ref)) {
        errors.push(`${wfName}: Action ${parsed.repo} в ${context} использует неподтверждённый ref "${parsed.ref}"; разрешены ${policy.allowedRefs.map((ref) => `@${ref}`).join(', ')}.`);
    }
    if (policy.job && context.jobName !== policy.job) {
        errors.push(`${wfName}: Action ${parsed.repo} размещён в job "${context.jobName}"; требуется "${policy.job}".`);
    }
    const inputs = inputsValue === undefined ? {} : inputsValue;
    if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) {
        errors.push(`${wfName}: inputs Action ${parsed.repo} в ${context.label} должны быть объектом.`);
        return policy;
    }
    for (const group of policy.requiredInputGroups) {
        const present = group.some((key) => Object.hasOwn(inputs, key) && inputs[key] !== null && String(inputs[key]).trim() !== '');
        if (!present) errors.push(`${wfName}: Action ${parsed.repo} в ${context.label} требует input ${group.join(' или ')}.`);
    }
    for (const [key, value] of Object.entries(inputs)) {
        if (!policy.inputs.includes(key)) errors.push(`${wfName}: Action ${parsed.repo} в ${context.label} имеет неподдерживаемый input "${key}".`);
        else if (value === null || String(value).trim() === '') errors.push(`${wfName}: Action ${parsed.repo} в ${context.label} имеет пустой input "${key}".`);
        else if (!['string', 'number', 'boolean'].includes(typeof value)) errors.push(`${wfName}: input "${key}" Action ${parsed.repo} в ${context.label} должен быть скалярным значением.`);
        else if (key === 'node-version' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && !/^v?\d+(?:\.\d+)?(?:\.x|\.\d+)?$/.test(String(value).trim())) {
            errors.push(`${wfName}: input "node-version" Action ${parsed.repo} в ${context.label} имеет некорректное значение "${value}".`);
        }
        else if (key === 'fetch-depth' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && (!Number.isInteger(Number(value)) || Number(value) < 0)) {
            errors.push(`${wfName}: input "fetch-depth" Action ${parsed.repo} в ${context.label} должен быть неотрицательным целым числом.`);
        }
        else if (['check-latest', 'package-manager-cache', 'ssh-strict', 'persist-credentials', 'clean', 'fetch-tags', 'show-progress', 'lfs', 'sparse-checkout-cone-mode', 'set-safe-directory', 'allow-unsafe-pr-checkout'].includes(key) && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && !['true', 'false'].includes(String(value).toLowerCase())) {
            errors.push(`${wfName}: input "${key}" Action ${parsed.repo} в ${context.label} должен быть true или false.`);
        }
    }
    return policy;
}

export function validateWorkflowActions(jobs, wfName = 'workflow', { requireIoBrokerActions = false, allowReusableWorkflows = false } = {}) {
    const errors = [];
    const warnings = [];
    const reviews = [];
    const safeJobs = jobs && typeof jobs === 'object' && !Array.isArray(jobs) ? jobs : {};
    const found = new Map();

    for (const [jobName, job] of Object.entries(safeJobs)) {
        if (Object.hasOwn(job ?? {}, 'uses')) {
            const context = { label: `job "${jobName}"`, jobName };
            const policy = validateEntry(job.uses, job.with, context, wfName, errors);
            if (!allowReusableWorkflows || policy?.kind !== 'reusable-workflow') {
                errors.push(`${wfName}: reusable workflow job-level uses в job "${jobName}" не разрешён стандартной политикой.`);
            }
        }
        for (const [index, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
            if (!Object.hasOwn(step ?? {}, 'uses')) continue;
            const context = { label: `job "${jobName}", step ${index + 1}`, jobName };
            const policy = validateEntry(step.uses, step.with, context, wfName, errors);
            if (policy) {
                const list = found.get(policy.name) ?? [];
                list.push({ jobName, uses: step.uses });
                found.set(policy.name, list);
            }
        }
    }

    if (requireIoBrokerActions) {
        for (const policy of OFFICIAL_ACTIONS.filter((item) => item.name.startsWith('ioBroker/'))) {
            const occurrences = (found.get(policy.name) ?? []).filter((entry) => entry.jobName === policy.job);
            if (occurrences.length === 0) errors.push(`${wfName}: обязательный Action ${policy.name} не найден в job "${policy.job}".`);
            if (occurrences.length > 1) errors.push(`${wfName}: Action ${policy.name} должен вызываться ровно один раз в job "${policy.job}".`);
        }
    }
    return { errors, warnings, reviews };
}

export function validateRequiredActions(jobs, wfName = 'workflow') {
    return validateWorkflowActions(jobs, wfName, { requireIoBrokerActions: true, allowReusableWorkflows: false });
}
