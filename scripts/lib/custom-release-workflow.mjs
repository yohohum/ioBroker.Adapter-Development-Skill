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

import path from 'node:path';
import semver from 'semver';
import { readVerifiedText } from './action-refs.mjs';
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
const MIN_NODE = '22.14.0';
const MIN_NPM = '11.5.1';

// The custom profile does not interpret arbitrary shell. It requires one exact,
// reviewed guard script with a versioned contract header. Any deviation (extra
// fields, different comparisons, comments-only guards, wrong versions) is
// rejected instead of being accepted through token matching.
export const RELEASE_GUARD_CONTRACT_VERSION = 'v1';
export function normalizeReleaseGuardScript(text) {
    return String(text)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '');
}
export const RELEASE_GUARD_SCRIPT = normalizeReleaseGuardScript([
    'set -euo pipefail',
    `# release-guard-contract: ${RELEASE_GUARD_CONTRACT_VERSION}`,
    'TAG_VERSION="${GITHUB_REF_NAME#v}"',
    '[[ "$GITHUB_REF_NAME" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "::error::Invalid release tag"; exit 1; }',
    'PKG_VERSION="$(node -p "require(\'./package.json\').version")"',
    'IO_VERSION="$(node -p "require(\'./io-package.json\').common.version")"',
    'if [ "$TAG_VERSION" != "$PKG_VERSION" ] || [ "$TAG_VERSION" != "$IO_VERSION" ]; then',
    '  echo "::error::Release versions do not match"',
    '  exit 1',
    'fi',
    'PACKAGE_NAME="$(node -p "require(\'./package.json\').name")"',
    'set +e',
    'NPM_VIEW_OUTPUT="$(npm view "$PACKAGE_NAME@$PKG_VERSION" version 2>&1)"',
    'NPM_VIEW_STATUS=$?',
    'set -e',
    'if [ "$NPM_VIEW_STATUS" -eq 0 ]; then',
    '  echo "::error::Package version already exists"',
    '  exit 1',
    'fi',
    'if ! printf \'%s\' "$NPM_VIEW_OUTPUT" | grep -Eq \'E404|404 Not Found|is not in (this|the) npm registry|No match found for version\'; then',
    '  echo "::error::Unable to verify npm publication state: $NPM_VIEW_OUTPUT"',
    '  exit 1',
    'fi',
].join('\n'));

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

function normalizeExpression(condition) {
    return String(condition ?? '').replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
}

function isDeployConditionFailClosed(condition) {
    const normalized = normalizeExpression(condition);
    return normalized === "startsWith(github.ref, 'refs/tags/v')" || normalized === 'startsWith(github.ref, "refs/tags/v")';
}

export function isStaticNodeRequirement(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    const spec = String(value).trim();
    if (!spec || /\$\{|\}|\b(?:latest|current|node|lts)\b/i.test(spec)) return false;
    const range = semver.validRange(spec);
    const minimum = range === null ? null : semver.minVersion(range);
    return minimum !== null && semver.gte(minimum, MIN_NODE);
}

function getNpmPin(command) {
    const match = String(command).trim().match(/^npm\s+install\s+(?:-g|--global)\s+npm@([0-9]+\.[0-9]+\.[0-9]+)$/i);
    if (!match || semver.valid(match[1]) === null || !semver.gte(match[1], MIN_NPM)) return null;
    return match[1];
}

function isNpmVersionSufficient(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    const version = semver.valid(String(value).trim());
    return version !== null && semver.gte(version, MIN_NPM);
}

export function isNpmCliPinSufficient(command) {
    return getNpmPin(command) !== null;
}

function resolveNodeVersionFile(root, relative, errors, location) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
        errors.push(`${location}: node-version-file must be repository-relative and cannot escape the repository.`);
        return null;
    }
    try {
        const content = readVerifiedText(root, relative).trim();
        if (relative === 'package.json') return JSON.parse(content).engines?.node ?? null;
        if (relative === '.tool-versions') {
            return content.split(/\r?\n/).map((line) => line.trim()).find((line) => /^nodejs\s+/.test(line))?.split(/\s+/)[1] ?? null;
        }
        if (['.nvmrc', '.node-version', '.npmrc-node-version'].includes(relative)) {
            return content.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('#'))?.trim() ?? null;
        }
        errors.push(`${location}: node-version-file "${relative}" is unsupported; accepted files are package.json (engines.node), .nvmrc, .node-version, or .tool-versions.`);
        return null;
    } catch (error) {
        errors.push(`${location}: cannot safely resolve node-version-file (${error instanceof Error ? error.message : String(error)}).`);
        return null;
    }
}

function nodeSetupIsCompliant(step, errors, location, root) {
    const values = step?.with ?? {};
    if (values['node-version'] !== undefined && values['node-version-file'] !== undefined) {
        errors.push(`${location}: set only one of node-version and node-version-file.`);
        return false;
    }
    const spec = values['node-version-file'] !== undefined
        ? resolveNodeVersionFile(root, values['node-version-file'], errors, location)
        : values['node-version'];
    if (!isStaticNodeRequirement(spec)) {
        errors.push(`${location}: resolved Node.js version must have a provable minimum >=${MIN_NODE}; ranges, aliases or dynamic expressions below/unknown to this threshold are rejected.`);
        return false;
    }
    return true;
}

function hasUnconditionalCommand(job, command) {
    return (Array.isArray(job?.steps) ? job.steps : []).some((step) =>
        step?.if === undefined && step?.['continue-on-error'] !== true && typeof step?.run === 'string' && command.test(step.run.trim()));
}

function jobContainsRequiredStep(job, matcher) {
    return hasUnconditionalCommand(job, matcher);
}

function jobHasValidationContent(job) {
    return jobHasTestContent(job) || jobHasLintOrBuildContent(job);
}

function jobHasTestContent(job) {
    return hasUnconditionalCommand(job, /^npm (?:test|run test(?::[A-Za-z0-9_-]+)?)$/i) ||
        hasUnconditionalAction(job, /^ioBroker\/testing-action-adapter@v1$/);
}

function jobHasLintOrBuildContent(job) {
    return hasUnconditionalCommand(job, /^npm run (?:build|lint)$/i) ||
        hasUnconditionalAction(job, /^ioBroker\/testing-action-check@v2$/);
}

function hasUnconditionalAction(job, actionPattern) {
    return (Array.isArray(job?.steps) ? job.steps : []).some((step) =>
        step?.if === undefined && step?.['continue-on-error'] !== true && typeof step?.uses === 'string' && actionPattern.test(step.uses.trim()));
}

function jobIsTagEligible(job) {
    // Required validation jobs must run unconditionally whenever the workflow
    // is triggered. GitHub's default success() semantics then gate downstream
    // jobs; arbitrary expressions are not statically interpreted here.
    return job?.if === undefined || job?.if === null || String(job.if).trim() === '';
}

function inspectReleaseGuard(job, publishIndex, errors, wfName) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    const candidates = steps.map((step, index) => ({ step, index }))
        .filter(({ step }) => typeof step?.run === 'string' && /release-guard-contract\s*:/.test(step.run));
    if (candidates.length === 0) {
        errors.push(`${wfName}: job "deploy" must contain the reviewed release guard step; missing release-guard-contract marker.`);
        return null;
    }
    if (candidates.length > 1) {
        errors.push(`${wfName}: job "deploy" must contain exactly one release guard step; found ${candidates.length}.`);
    }
    for (const { step, index } of candidates) {
        const versionMatch = String(step.run).match(/release-guard-contract\s*:\s*(\S+)/);
        const version = versionMatch ? versionMatch[1] : null;
        if (version !== RELEASE_GUARD_CONTRACT_VERSION) {
            errors.push(`${wfName}: unsupported release-guard contract version "${version ?? 'unknown'}"; only ${RELEASE_GUARD_CONTRACT_VERSION} is accepted.`);
        } else if (normalizeReleaseGuardScript(step.run) !== RELEASE_GUARD_SCRIPT) {
            errors.push(`${wfName}: release guard step ${index + 1} does not match the reviewed ${RELEASE_GUARD_CONTRACT_VERSION} contract; unknown fields or shell changes are rejected.`);
        }
        if (step.if !== undefined && step.if !== null && String(step.if).trim() !== '') {
            errors.push(`${wfName}: release guard step ${index + 1} must be unconditional (no if).`);
        }
        if (step['continue-on-error'] === true) {
            errors.push(`${wfName}: release guard step ${index + 1} must not set continue-on-error: true.`);
        }
        if (step.shell !== 'bash') {
            errors.push(`${wfName}: release guard step ${index + 1} must set shell: bash.`);
        }
    }
    const canonical = candidates.filter(({ step }) => normalizeReleaseGuardScript(step.run) === RELEASE_GUARD_SCRIPT);
    if (canonical.length === 1) {
        if (publishIndex !== null && canonical[0].index > publishIndex) {
            errors.push(`${wfName}: release guard must run before the publish step.`);
        }
        return canonical[0];
    }
    return null;
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
    if (value === undefined) return null;
    if (value === 'read-all' || value === 'write-all') {
        errors.push(`${location}: wildcard permissions "${value}" запрещены; явно укажите минимальный permissions mapping.`);
        return {};
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${location}: permissions должна быть явным mapping; получено "${String(value)}".`);
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

export function effectivePermissions(workflow, job, errors = [], wfName = 'workflow') {
    if (workflow.permissions === undefined) {
        errors.push(`${wfName}: workflow-level permissions должны быть заданы явно; не полагайтесь на repository defaults.`);
    }
    const top = normalizePermissions(workflow.permissions, errors, `${wfName}: permissions`);
    if (top) {
        if (top['id-token'] === 'write') {
            errors.push(`${wfName}: id-token: write разрешён только на уровне job "deploy", не на уровне workflow.`);
        }
        if (top.contents === 'write') {
            errors.push(`${wfName}: contents: write разрешён только на уровне job "deploy", не на уровне workflow.`);
        }
    }
    if (job.permissions !== undefined) {
        // GitHub replaces the workflow-level map for a job-level map; omitted
        // permissions become none. Never merge these mappings.
        return normalizePermissions(job.permissions, errors, `${wfName}: job "deploy" permissions`) ?? {};
    }
    if (top === null) {
        errors.push(`${wfName}: невозможно доказать effective GITHUB_TOKEN permissions без явного workflow- или deploy-level permissions.`);
        return {};
    }
    return top;
}

function validateDeployRuntime(deploySteps, deployActionSteps, deployPublishSteps, errors, wfName, root) {
    const setupNodes = deploySteps.map((step, index) => ({ step, index }))
        .filter(({ step }) => step?.uses === 'actions/setup-node@v6');
    if (setupNodes.length !== 1) {
        errors.push(`${wfName}: custom-approved publish job must contain exactly one actions/setup-node step; found ${setupNodes.length}.`);
    }
    for (const { step, index } of setupNodes) {
        const location = `${wfName}: job "deploy" step ${index + 1}`;
        nodeSetupIsCompliant(step, errors, location, root);
        const packageManagerCache = step.with?.['package-manager-cache'];
        if (packageManagerCache !== false && String(packageManagerCache).toLowerCase() !== 'false') {
            errors.push(`${location}: actions/setup-node must set package-manager-cache: false; implicit or dynamic cache is rejected.`);
        }
        if (step.with?.cache !== undefined && String(step.with.cache).trim() !== '') {
            errors.push(`${location}: actions/setup-node must not enable dependency cache.`);
        }
        if (step.with?.['cache-dependency-path'] !== undefined && String(step.with['cache-dependency-path']).trim() !== '') {
            errors.push(`${location}: actions/setup-node must not set cache-dependency-path when caching is disabled.`);
        }
    }
    for (const { step, index } of deploySteps.map((step, index) => ({ step, index }))) {
        if (typeof step?.uses === 'string' && step.uses.startsWith('./')) {
            errors.push(`${wfName}: job "deploy" step ${index + 1} must not use a local action/workflow; it can change the publish environment.`);
        }
    }

    // testing-action-deploy@v1 itself runs setup-node and defaults package-cache
    // to npm; its explicit supported input must disable its internal cache.
    for (const { step, index } of deployActionSteps) {
        if (typeof step.with?.['package-cache'] !== 'string' || step.with['package-cache'].toLowerCase() !== 'false') {
            errors.push(`${wfName}: job "deploy" step ${index + 1} must set package-cache: 'false' for ioBroker/testing-action-deploy@v1.`);
        }
        const nodeVersion = step.with?.['node-version'];
        if (!isStaticNodeRequirement(nodeVersion)) errors.push(`${wfName}: job "deploy" step ${index + 1} node-version must be static and >=${MIN_NODE}.`);
    }

    const npmInstallSteps = deploySteps.map((step, index) => ({ step, index }))
        .filter(({ step }) => typeof step?.run === 'string' && /\bnpm\s+install\s+(?:-g|--global)\s+npm(?:@[^\s]+)?\b/i.test(step.run));
    if (deployActionSteps.length === 0 && npmInstallSteps.length === 0 && deploySteps.some((step) => typeof step?.run === 'string' && PUBLISH_COMMAND.test(step.run))) errors.push(`${wfName}: direct npm publish must install a pinned npm CLI version >=${MIN_NPM} before publish.`);
    let pinnedNpm = false;
    for (const { step, index } of npmInstallSteps) {
        const pin = getNpmPin(step.run);
        if (!pin) {
            errors.push(`${wfName}: job "deploy" step ${index + 1} must pin npm CLI to a numeric version >=${MIN_NPM}.`);
        } else pinnedNpm = true;
    }
    if (deployActionSteps.length === 0 && npmInstallSteps.length > 0 && !pinnedNpm) {
        errors.push(`${wfName}: no valid npm CLI pin >=${MIN_NPM} was found in the publish job.`);
    }
    if (deployActionSteps.length === 1) {
        const internalNpmVersion = deployActionSteps[0].step.with?.['npm-version'];
        if (!isNpmVersionSufficient(internalNpmVersion)) errors.push(`${wfName}: custom-approved rejects ioBroker/testing-action-deploy@v1 unless its npm-version input is numeric and >=${MIN_NPM}.`);
        if (TOKEN_VALUE_PATTERN.test(JSON.stringify(deployActionSteps[0].step.with ?? {}))) errors.push(`${wfName}: deployment Action must not receive a long-lived npm token.`);
        if (deployActionSteps[0].step.with?.['npm-token']) errors.push(`${wfName}: npm-token must not be set for Trusted Publishing.`);
    } else if (!pinnedNpm && deploySteps.some((step) => typeof step?.run === 'string' && PUBLISH_COMMAND.test(step.run))) {
        errors.push(`${wfName}: direct npm publication must set up npm CLI with a numeric version >=${MIN_NPM} before publish.`);
    }

    const setupNode = setupNodes[0];
    if (deployPublishSteps.length === 1) {
        const publishIndex = deployPublishSteps[0].index;
        if (setupNode) {
            if (setupNode.step.with?.['registry-url'] !== 'https://registry.npmjs.org') {
                errors.push(`${wfName}: direct publish setup-node must set registry-url https://registry.npmjs.org.`);
            }
            if (setupNode.index > publishIndex) {
                errors.push(`${wfName}: setup-node must run before npm publish.`);
            }
        }
    }
    if (deployActionSteps.length === 1 && setupNode && setupNode.index > deployActionSteps[0].index) {
        errors.push(`${wfName}: setup-node must run before ioBroker/testing-action-deploy@v1.`);
    }
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

export function validateCustomReleaseWorkflow(workflow, { wfName = 'workflow', root = process.cwd() } = {}) {
    const errors = [];
    const warnings = [];
    const reviews = [];

    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
        return { errors: [`${wfName}: workflow должен быть mapping.`], warnings, reviews };
    }

    const events = normalizeEvents(workflow.on ?? workflow['on']);
    if (!events) {
        errors.push(`${wfName}: отсутствует корректный блок on.`);
        return { errors, warnings, reviews };
    }
    for (const event of FORBIDDEN_EVENTS) {
        if (Object.hasOwn(events, event)) {
            errors.push(`${wfName}: событие "${event}" не допускается в профиле custom-approved. Публикация должна запускаться по push релизного тега.`);
        }
    }
    for (const event of Object.keys(events)) {
        if (!['push', 'pull_request'].includes(event)) errors.push(`${wfName}: unsupported trigger event "${event}" in custom-approved.`);
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
    if (deploy.needs === undefined || needs.length === 0) errors.push(`${wfName}: deploy requires explicit needs for all validation jobs.`);
    for (const dependency of needs) {
        if (!Object.hasOwn(jobs, dependency)) errors.push(`${wfName}: deploy depends on missing job "${dependency}".`);
        const dependencyJob = jobs[dependency];
        if (dependencyJob?.if !== undefined && dependencyJob?.if !== null && String(dependencyJob.if).trim() !== '') {
            errors.push(`${wfName}: deploy prerequisite job "${dependency}" may be skipped by an if condition.`);
        }
    }
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
            errors.push(`${wfName}: обязательный validation job "${name}" не допускает job-level if; его выполнение должно гарантироваться при каждом workflow trigger, включая release tag.`);
        }
        if (job.if !== undefined && job.if !== null && String(job.if).trim() !== '') {
            errors.push(`${wfName}: обязательный validation job "${name}" имеет unsupported condition; conditions допускаются только отсутствующие (unconditional).`);
        }
    }

    const testJobs = validationJobNames.filter((name) => jobHasTestContent(jobs[name]));
    const lintBuildJobs = validationJobNames.filter((name) => jobHasLintOrBuildContent(jobs[name]));
    if (testJobs.length === 0) {
        errors.push(`${wfName}: missing unconditional required tests (npm test/npm run test:*); validation checks must be real unconditional commands.`);
    }
    if (lintBuildJobs.length === 0) {
        errors.push(`${wfName}: missing unconditional required build/lint checks (npm run build/lint).`);
    }
    for (const name of validationJobNames) {
        const job = jobs[name];
        for (const [index, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
            const command = typeof step?.run === 'string' ? step.run.trim() : '';
            const requiredCheck = /^(?:npm\s+(?:test|run\s+(?:test(?::[A-Za-z0-9_-]+)?|build|lint)))(?:\s+.*)?$/i.test(command);
            if (!requiredCheck) continue;
            if (step.if !== undefined && step.if !== null && String(step.if).trim() !== '') {
                errors.push(`${wfName}: required check step ${name}/${index + 1} must not have an if condition.`);
            }
            if (step['continue-on-error'] === true) errors.push(`${wfName}: required check step ${name}/${index + 1} must not set continue-on-error: true.`);
        }
    }
    const skippedJobs = validationJobNames.filter((name) => !jobIsTagEligible(jobs[name]));
    for (const name of skippedJobs) errors.push(`${wfName}: validation job "${name}" may be skipped or conditionally omitted; only unconditional validation jobs are supported.`);
    const requiredGateNames = ['check-and-lint', 'adapter-tests'];
    for (const requiredName of requiredGateNames) {
        if (!Object.hasOwn(jobs, requiredName)) errors.push(`${wfName}: отсутствует обязательный release validation job "${requiredName}".`);
    }
    const requiredGatePaths = validationJobNames.filter((name) => requiredGateNames.includes(name));
    if (requiredGatePaths.length === requiredGateNames.length && requiredGatePaths.some((name) => !needs.includes(name))) {
        errors.push(`${wfName}: deploy needs должны включать обе обязательные группы проверки: check-and-lint и adapter-tests.`);
    }
    if (jobs['check-and-lint'] && !jobContainsRequiredStep(jobs['check-and-lint'], /^npm run (?:build|lint)$/i) && !hasUnconditionalAction(jobs['check-and-lint'], /^ioBroker\/testing-action-check@v2$/)) {
        errors.push(`${wfName}: check-and-lint requires an unconditional npm run build/lint step; conditions or continue-on-error are unsupported.`);
    }
    if (jobs['check-and-lint'] && !jobContainsRequiredStep(jobs['check-and-lint'], /^npm run test:package$/i) && !hasUnconditionalAction(jobs['check-and-lint'], /^ioBroker\/testing-action-check@v2$/)) {
        errors.push(`${wfName}: check-and-lint requires an unconditional npm run test:package step.`);
    }
    if (jobs['adapter-tests'] && !jobContainsRequiredStep(jobs['adapter-tests'], /^npm run test:integration$/i) && !hasUnconditionalAction(jobs['adapter-tests'], /^ioBroker\/testing-action-adapter@v1$/)) {
        errors.push(`${wfName}: adapter-tests requires an unconditional npm run test:integration step.`);
    }
    if (!jobs['adapter-tests'] || (!jobContainsRequiredStep(jobs['adapter-tests'], /^npm run test:integration$/i) && !hasUnconditionalAction(jobs['adapter-tests'], /^ioBroker\/testing-action-adapter@v1$/))) {
        errors.push(`${wfName}: required adapter tests are missing or conditional.`);
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
        if (local?.['id-token'] === 'write' || local?.contents === 'write' || local?.packages === 'write') {
            errors.push(`${wfName}: validation job "${name}" не должен иметь write permissions.`);
        }
    }

    const conditionResult = validateDeployCondition(deploy.if);
    if (!isDeployConditionFailClosed(deploy.if)) {
        errors.push(`${wfName}: deploy.if must be exactly startsWith(github.ref, 'refs/tags/v'); all other expressions are rejected.`);
    }

    const allPublishSteps = [];
    for (const [name, job] of Object.entries(jobs)) {
        for (const publishStep of findPublishSteps(job)) {
            allPublishSteps.push({ jobName: name, ...publishStep });
        }
    }
    for (const [name, job] of Object.entries(jobs)) {
        for (const [index, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
            const command = typeof step?.run === 'string' ? step.run : '';
            const actionToken = JSON.stringify(step?.with ?? {}) + JSON.stringify(step?.env ?? {});
            if (TOKEN_VALUE_PATTERN.test(command + actionToken)) errors.push(`${wfName}: npm token reference is prohibited in ${name} step ${index + 1}.`);
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
    const tokenFindings = collectTokenFindings(workflow);
    errors.push(...tokenFindings);
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
    for (const { step, index } of deploySteps.map((step, index) => ({ step, index }))) {
        if (typeof step?.run === 'string' && PUBLISH_COMMAND.test(step.run) && (TOKEN_VALUE_PATTERN.test(step.run) || TOKEN_VALUE_PATTERN.test(JSON.stringify(step.env ?? {})))) {
            errors.push(`${wfName}: npm token references are prohibited in publish step ${index + 1}.`);
        }
    }
    validateDeployRuntime(deploySteps, deployActionSteps, deployPublishSteps, errors, wfName, root);
    const publishStep = deployPublishSteps[0] ?? deployActionSteps[0] ?? null;
    inspectReleaseGuard(deploy, publishStep ? publishStep.index : null, errors, wfName);

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
        if (!hasGitHubReleaseStep(deploy)) {
            errors.push(`${wfName}: для ручного npm publish требуется step создания GitHub Release (gh release create или softprops/action-gh-release@v3).`);
        }
        const publishWith = step.with ?? {};
        if (publishWith['access'] === 'public' || publishWith['provenance'] === false) errors.push(`${wfName}: npm publish must not disable provenance.`);
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

export { isReleaseTagPattern };
