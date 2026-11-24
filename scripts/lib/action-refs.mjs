#!/usr/bin/env node
// Explicit allowlist for external GitHub Actions in the default profile.
// Refs and inputs are rechecked for every step and reusable-workflow use.
import fs from 'node:fs';
import path from 'node:path';
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml';
// A. Actions официального шаблона create-adapter-default (используются
// шаблоном test-and-release.yml). Только они считаются обязательными для
// стандартного профиля.
const OFFICIAL_TEMPLATE_ACTIONS = [
    {
        name: 'actions/checkout', allowedRefs: ['v6'], inputs: [
            'repository', 'ref', 'token', 'ssh-key', 'ssh-known-hosts', 'ssh-strict', 'ssh-user',
            'persist-credentials', 'path', 'clean', 'filter', 'sparse-checkout', 'sparse-checkout-cone-mode',
            'fetch-depth', 'fetch-tags', 'show-progress', 'lfs', 'submodules', 'set-safe-directory',
            'github-server-url', 'allow-unsafe-pr-checkout'
        ], requiredInputGroups: [], kind: 'step', tier: 'template',
    },
    {
        name: 'actions/setup-node', allowedRefs: ['v6'], inputs: [
            'node-version', 'node-version-file', 'architecture', 'check-latest', 'registry-url', 'scope', 'token',
            'cache', 'package-manager-cache', 'cache-dependency-path', 'mirror', 'mirror-token'
        ], requiredInputGroups: [], kind: 'step', tier: 'template',
    },
    {
        name: 'ioBroker/testing-action-check', job: 'check-and-lint', allowedRefs: ['v2'], inputs: [
            'node-version', 'install-command', 'package-cache', 'type-checking', 'type-checking-command',
            'lint', 'lint-command', 'test-command'
        ], requiredInputGroups: [['node-version']], kind: 'step', tier: 'template',
    },
    {
        name: 'ioBroker/testing-action-adapter', job: 'adapter-tests', allowedRefs: ['v1'], inputs: [
            'node-version', 'engine-strict', 'install-command', 'package-cache', 'os', 'build', 'build-command',
            'extra-tests', 'unit-test-check-pattern', 'unit-test-command', 'integration-test-command', 'screenshots-path'
        ], requiredInputGroups: [['node-version'], ['os']], kind: 'step', tier: 'template',
    },
    {
        name: 'ioBroker/testing-action-deploy', job: 'deploy', allowedRefs: ['v1'], inputs: [
            'node-version', 'install-command', 'package-cache', 'build', 'build-command', 'npm-token', 'tag',
            'github-token', 'sentry', 'sentry-token', 'sentry-url', 'sentry-org', 'sentry-project',
            'sentry-version-prefix', 'sentry-github-integration', 'sentry-sourcemap-paths'
        ], requiredInputGroups: [['node-version'], ['github-token']], kind: 'step', tier: 'template',
    },
];

// B. Дополнительные разрешённые Actions (не входят в официальный шаблон,
// разрешены для пользовательских и расширенных сценариев). Для каждого
// действия указано основание разрешения. Они не являются частью
// официального шаблона create-adapter-default и не требуются им.
const ADDITIONAL_ACTIONS = [
    {
        name: 'actions/upload-artifact', allowedRefs: ['v6'], inputs: [
            'name', 'path', 'if-no-files-found', 'retention-days', 'compression-level', 'overwrite', 'include-hidden-files'
        ], requiredInputGroups: [['path']], kind: 'step', tier: 'additional',
        rationale: 'Используется внутри ioBroker/testing-action-adapter@v1 для архивации скриншотов; может потребоваться для пользовательской публикации артефактов.',
    },
    {
        name: 'softprops/action-gh-release', allowedRefs: ['v3'], inputs: [
            'body', 'body_path', 'name', 'tag_name', 'draft', 'prerelease', 'preserve_order', 'files',
            'working_directory', 'overwrite_files', 'fail_on_unmatched_files', 'repository', 'token',
            'target_commitish', 'discussion_category_name', 'generate_release_notes', 'previous_tag',
            'append_body', 'make_latest'
        ], requiredInputGroups: [], kind: 'step', tier: 'additional',
        rationale: 'Используется внутри ioBroker/testing-action-deploy@v1 для создания GitHub-релиза; может потребоваться для пользовательских сценариев релиза.',
    },
];

// Единый allowlist для внешних Actions: шаблонные + дополнительные.
// Проверка inputs ведётся строго по официальному контракту конкретной версии.
export const OFFICIAL_ACTIONS = [...OFFICIAL_TEMPLATE_ACTIONS, ...ADDITIONAL_ACTIONS];
export { OFFICIAL_TEMPLATE_ACTIONS, ADDITIONAL_ACTIONS };

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
        else if (value === null) errors.push(`${wfName}: Action ${parsed.repo} в ${context.label} имеет null для input "${key}".`);
        else if (!['string', 'number', 'boolean'].includes(typeof value)) errors.push(`${wfName}: input "${key}" Action ${parsed.repo} в ${context.label} должен быть скалярным значением.`);
        else if (String(value).includes('${{') && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim())) {
            errors.push(`${wfName}: input "${key}" Action ${parsed.repo} в ${context.label} содержит некорректное выражение GitHub Actions.`);
        }
        else if (key === 'node-version' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && !/^(?:v?\d+(?:\.\d+)*(?:\.x)?|(?:>=|<=|>|<|\^|~)?v?\d+(?:\.\d+)*(?:\.x)?|lts(?:\/[a-z0-9.*-]+)?|node|latest|current|\*)$/i.test(String(value).trim())) {
            errors.push(`${wfName}: input "node-version" Action ${parsed.repo} в ${context.label} не соответствует формату Node.js version spec.`);
        }
        else if ((key === 'fetch-depth' || key === 'compression-level' || key === 'retention-days') && String(value).trim() !== '' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && (!Number.isInteger(Number(value)) || Number(value) < (key === 'retention-days' ? 1 : 0) || (key === 'compression-level' && Number(value) > 9) || (key === 'retention-days' && Number(value) > 90))) {
            errors.push(`${wfName}: input "${key}" Action ${parsed.repo} в ${context.label} имеет недопустимое числовое значение.`);
        }
        else if (['check-latest', 'package-manager-cache', 'ssh-strict', 'persist-credentials', 'clean', 'fetch-tags', 'show-progress', 'lfs', 'sparse-checkout-cone-mode', 'set-safe-directory', 'allow-unsafe-pr-checkout', 'overwrite', 'include-hidden-files', 'draft', 'prerelease', 'preserve_order', 'overwrite_files', 'fail_on_unmatched_files', 'generate_release_notes', 'append_body'].includes(key) && String(value).trim() !== '' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && !['true', 'false'].includes(String(value).toLowerCase())) {
            errors.push(`${wfName}: input "${key}" Action ${parsed.repo} в ${context.label} должен быть true или false.`);
        }
        else if (key === 'submodules' && String(value).trim() !== '' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && !['true', 'false', 'recursive'].includes(String(value).toLowerCase())) errors.push(`${wfName}: input "submodules" Action ${parsed.repo} в ${context.label} принимает true, false или recursive.`);
        else if (key === 'cache' && String(value).trim() !== '' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && !['npm', 'yarn', 'pnpm'].includes(String(value).toLowerCase())) errors.push(`${wfName}: input "cache" Action ${parsed.repo} в ${context.label} принимает npm, yarn или pnpm.`);
        else if (parsed.repo === 'softprops/action-gh-release' && key === 'make_latest' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && !['true', 'false', 'legacy'].includes(String(value).toLowerCase())) errors.push(`${wfName}: input "make_latest" Action ${parsed.repo} в ${context.label} принимает true, false или legacy.`);
        else if (key === 'if-no-files-found' && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim()) && !['warn', 'error', 'ignore'].includes(String(value))) errors.push(`${wfName}: input "if-no-files-found" Action ${parsed.repo} в ${context.label} принимает warn, error или ignore.`);
    }
    return policy;
}

export function validateWorkflowActions(jobs, wfName = 'workflow', { requireIoBrokerActions = false, allowReusableWorkflows = false, allowLocalJobUses = false, allowLocalStepUses = false } = {}) {
    const errors = [];
    const warnings = [];
    const reviews = [];
    const safeJobs = jobs && typeof jobs === 'object' && !Array.isArray(jobs) ? jobs : {};
    const found = new Map();

    for (const [jobName, job] of Object.entries(safeJobs)) {
        if (!job || typeof job !== 'object' || Array.isArray(job)) {
            errors.push(`${wfName}: job "${jobName}" must be a mapping.`);
            continue;
        }
        if (Object.hasOwn(job, 'steps') && !Array.isArray(job.steps)) errors.push(`${wfName}: job "${jobName}" steps must be a sequence.`);
        if (Object.hasOwn(job ?? {}, 'uses')) {
            const context = { label: `job "${jobName}"`, jobName };
            if (typeof job.uses === 'string' && job.uses.startsWith('./')) {
                if (!allowLocalJobUses) errors.push(`${wfName}: локальный reusable workflow ${job.uses} требует validateWorkflowFile() с корнем репозитория; jobs-only проверка не может подтвердить его содержимое.`);
            } else {
                const policy = validateEntry(job.uses, job.with, context, wfName, errors);
                if (!allowReusableWorkflows || policy?.kind !== 'reusable-workflow') {
                    errors.push(`${wfName}: reusable workflow job-level uses в job "${jobName}" не разрешён стандартной политикой.`);
                }
            }
        }
        for (const [index, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
            if (!step || typeof step !== 'object' || Array.isArray(step)) {
                errors.push(`${wfName}: job "${jobName}" step ${index + 1} must be a mapping.`);
                continue;
            }
            if (!Object.hasOwn(step ?? {}, 'uses')) continue;
            const context = { label: `job "${jobName}", step ${index + 1}`, jobName };
            if (allowLocalStepUses && typeof step.uses === 'string' && step.uses.startsWith('./')) continue;
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

/**
 * Validate an on-disk workflow and recursively inspect local reusable workflows
 * and local composite actions. Remote reusable workflows are rejected unless
 * an exact, separately reviewed reusable-workflow policy is added.
 */
export function validateWorkflowFile(workflowPath, { root = process.cwd(), requireIoBrokerActions = false, profile = 'create-adapter-default' } = {}) {
    const errors = [];
    const warnings = [];
    const reviews = [];
    const visited = new Set();
    const approvedProfile = profile === 'create-adapter-default' || profile === 'custom-approved';
    if (!approvedProfile) return { errors: [`Unknown Action policy profile: ${profile}`], warnings, reviews };

    function readWorkflow(filePath, chain = []) {
        const resolved = path.resolve(filePath);
        const relative = path.relative(path.resolve(root), resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            errors.push(`${filePath}: workflow path escapes repository root.`);
            return;
        }
        if (chain.includes(resolved)) {
            errors.push(`${path.relative(root, resolved)}: reusable workflow cycle detected: ${chain.map((item) => path.relative(root, item)).join(' -> ')} -> ${path.relative(root, resolved)}.`);
            return;
        }
        if (visited.has(resolved)) return;
        visited.add(resolved);
        let workflow;
        try {
            workflow = loadYaml(fs.readFileSync(resolved, 'utf8'), { schema: JSON_SCHEMA });
        } catch (error) {
            errors.push(`${path.relative(root, resolved)}: invalid/duplicate-key YAML: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || !workflow.jobs || typeof workflow.jobs !== 'object' || Array.isArray(workflow.jobs)) {
            errors.push(`${path.relative(root, resolved)}: unsupported workflow structure; expected mapping with jobs.`);
            return;
        }
        if (workflow.jobs === null || Object.keys(workflow).some((key) => !['name', 'on', 'env', 'defaults', 'permissions', 'concurrency', 'jobs'].includes(key))) {
            errors.push(`${path.relative(root, resolved)}: workflow has unsupported top-level keys or invalid jobs mapping.`);
        }
        const wfName = path.relative(root, resolved);
        const result = validateWorkflowActions(workflow.jobs, wfName, { requireIoBrokerActions: requireIoBrokerActions && chain.length === 0, allowLocalJobUses: true });
        errors.push(...result.errors);
        warnings.push(...result.warnings);
        reviews.push(...result.reviews);

        for (const [jobName, job] of Object.entries(workflow.jobs)) {
            for (const key of Object.keys(job)) {
                if (key === 'uses' || key === 'steps' || key === 'with' || key === 'secrets') continue;
                if (['name', 'needs', 'if', 'permissions', 'concurrency', 'strategy', 'runs-on', 'environment', 'container', 'services', 'env', 'defaults', 'timeout-minutes', 'continue-on-error', 'outputs'].includes(key)) continue;
                errors.push(`${wfName}: job "${jobName}" has unsupported key "${key}".`);
            }
            if (job?.uses && typeof job.uses === 'string' && job.uses.startsWith('./')) {
                const local = resolveLocalWorkflow(root, resolved, job.uses, wfName, jobName, errors);
                if (local) {
                    validateReusableInputs(job, local, wfName, jobName, errors);
                    readWorkflow(local, [...chain, resolved]);
                }
            }
            for (const [index, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
                if (typeof step?.uses === 'string' && step.uses.startsWith('./')) {
                    const actionDir = path.resolve(root, step.uses);
                    if (!isInside(root, actionDir)) {
                        errors.push(`${wfName}: local Action path ${step.uses} in job "${jobName}" step ${index + 1} escapes repository root.`);
                        continue;
                    }
                    const metadata = ['action.yml', 'action.yaml'].map((name) => path.join(actionDir, name)).find(fs.existsSync);
                    if (!metadata) {
                        errors.push(`${wfName}: local Action ${step.uses} in job "${jobName}" step ${index + 1} has no action.yml/action.yaml.`);
                        continue;
                    }
                    inspectCompositeAction(metadata, wfName, `${jobName}/step-${index + 1}`, [...chain, resolved]);
                }
            }
        }
    }

    function inspectCompositeAction(metadataPath, sourceWorkflow, location, chain) {
        let metadata;
        try { metadata = loadYaml(fs.readFileSync(metadataPath, 'utf8'), { schema: JSON_SCHEMA }); }
        catch (error) {
            errors.push(`${path.relative(root, metadataPath)}: invalid/duplicate-key action YAML: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (metadata?.runs?.using !== 'composite' || !Array.isArray(metadata.runs.steps)) {
            errors.push(`${path.relative(root, metadataPath)}: local actions must declare runs.using: composite and runs.steps for recursive validation.`);
            return;
        }
        const jobs = { [location]: { steps: metadata.runs.steps } };
        const result = validateWorkflowActions(jobs, sourceWorkflow, { allowLocalStepUses: true });
        errors.push(...result.errors);
        for (const [index, step] of metadata.runs.steps.entries()) {
            if (typeof step?.uses === 'string' && step.uses.startsWith('./')) {
                const localActionDir = path.resolve(root, step.uses);
                if (!isInside(root, localActionDir)) {
                    errors.push(`${path.relative(root, metadataPath)}: nested local Action path escapes repository root.`);
                    continue;
                }
                const nestedMetadata = ['action.yml', 'action.yaml'].map((name) => path.join(localActionDir, name)).find(fs.existsSync);
                if (!nestedMetadata) errors.push(`${path.relative(root, metadataPath)}: nested local Action ${step.uses} has no action.yml/action.yaml.`);
                else if (chain.includes(nestedMetadata)) errors.push(`${path.relative(root, nestedMetadata)}: local composite Action cycle detected.`);
                else inspectCompositeAction(nestedMetadata, sourceWorkflow, `${location}/nested-${index + 1}`, [...chain, metadataPath]);
            }
        }
    }

    readWorkflow(workflowPath);
    return { errors, warnings, reviews };
}

function resolveLocalWorkflow(root, fromWorkflow, reference, wfName, jobName, errors) {
    const target = path.resolve(root, reference);
    if (!isInside(root, target)) {
        errors.push(`${wfName}: local reusable workflow ${reference} in job "${jobName}" escapes repository root.`);
        return null;
    }
    if (!fs.existsSync(target)) {
        errors.push(`${wfName}: local reusable workflow ${reference} in job "${jobName}" does not exist.`);
        return null;
    }
    return target;
}

function validateReusableInputs(job, target, wfName, jobName, errors) {
    let child;
    try { child = loadYaml(fs.readFileSync(target, 'utf8'), { schema: JSON_SCHEMA }); }
    catch (error) {
        errors.push(`${wfName}: local reusable workflow job "${jobName}" has invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    const workflowCall = child?.on?.workflow_call ?? child?.['on']?.workflow_call;
    if (!workflowCall || typeof workflowCall !== 'object' || Array.isArray(workflowCall)) {
        errors.push(`${wfName}: local reusable workflow job "${jobName}" target must declare on.workflow_call.`);
        return;
    }
    const declared = workflowCall.inputs ?? {};
    const supplied = job.with ?? {};
    if (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied)) {
        errors.push(`${wfName}: reusable workflow job "${jobName}" with must be a mapping.`);
        return;
    }
    for (const [name, definition] of Object.entries(declared)) {
        if (definition?.required === true && (!Object.hasOwn(supplied, name) || supplied[name] === null || String(supplied[name]).trim() === '')) {
            errors.push(`${wfName}: reusable workflow job "${jobName}" misses required input "${name}".`);
        }
    }
    for (const name of Object.keys(supplied)) {
        if (!Object.hasOwn(declared, name)) errors.push(`${wfName}: reusable workflow job "${jobName}" supplies undeclared input "${name}".`);
        else {
            const value = supplied[name];
            const type = declared[name]?.type ?? 'string';
            if (typeof value !== type && !/^\$\{\{[\s\S]+\}\}$/.test(String(value).trim())) {
                errors.push(`${wfName}: reusable workflow job "${jobName}" input "${name}" must have type ${type}.`);
            }
        }
    }
    const secretDeclarations = workflowCall.secrets ?? {};
    const suppliedSecrets = job.secrets ?? {};
    if (suppliedSecrets !== 'inherit' && (suppliedSecrets === null || typeof suppliedSecrets !== 'object' || Array.isArray(suppliedSecrets))) {
        errors.push(`${wfName}: reusable workflow job "${jobName}" secrets must be a mapping or "inherit".`);
    } else if (suppliedSecrets === 'inherit') {
        errors.push(`${wfName}: reusable workflow job "${jobName}" uses secrets: inherit; inheritance cannot be validated statically.`);
    } else {
        for (const [name, definition] of Object.entries(secretDeclarations)) {
            if (definition?.required === true && (!Object.hasOwn(suppliedSecrets, name) || suppliedSecrets[name] === null || String(suppliedSecrets[name]).trim() === '')) {
                errors.push(`${wfName}: reusable workflow job "${jobName}" misses required secret "${name}".`);
            }
        }
        for (const name of Object.keys(suppliedSecrets)) {
            if (!Object.hasOwn(secretDeclarations, name)) errors.push(`${wfName}: reusable workflow job "${jobName}" supplies undeclared secret "${name}".`);
        }
    }
}

function isInside(root, target) {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateRequiredActions(jobs, wfName = 'workflow', options = {}) {
    return validateWorkflowActions(jobs, wfName, {
        requireIoBrokerActions: true,
        allowReusableWorkflows: false,
        ...options,
    });
}
