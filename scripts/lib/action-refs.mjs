#!/usr/bin/env node
// Единая политика обязательных GitHub Actions и проверка их refs/inputs.
// Используется release-preflight.mjs и validate-skill.mjs.

// Версии подтверждены по официальному шаблону @iobroker/create-adapter,
// который хранится в templates/github-actions/test-and-release.yml.
// Разрешены только явные major-версии официального шаблона.
export const OFFICIAL_ACTIONS = [
    {
        name: 'ioBroker/testing-action-check',
        job: 'check-and-lint',
        allowedMajors: [2],
        requiredInputs: ['node-version'],
    },
    {
        name: 'ioBroker/testing-action-adapter',
        job: 'adapter-tests',
        allowedMajors: [1],
        requiredInputs: ['node-version', 'os'],
    },
    {
        name: 'ioBroker/testing-action-deploy',
        job: 'deploy',
        allowedMajors: [1],
        requiredInputs: ['node-version', 'github-token'],
    },
];

function splitUses(uses) {
    if (typeof uses !== 'string') return null;
    const at = uses.lastIndexOf('@');
    if (at === -1) {
        return { repo: uses.trim(), ref: null, raw: uses };
    }
    return {
        repo: uses.slice(0, at).trim(),
        ref: uses.slice(at + 1).trim(),
        raw: uses,
    };
}

function actionBasename(actionName) {
    const parts = actionName.split('/');
    return parts[parts.length - 1];
}

function isCandidateUses(uses, actionName) {
    if (typeof uses !== 'string') return false;
    const parsed = splitUses(uses);
    if (!parsed) return false;
    const parts = parsed.repo.split('/');
    const repoBasename = parts[parts.length - 1] ?? '';
    const basename = actionBasename(actionName);
    return repoBasename === basename || repoBasename.startsWith(`${basename}-`);
}

function validateActionRef(uses, policy, wfName, jobName, errors) {
    const parsed = splitUses(uses);
    if (!parsed) {
        errors.push(`${wfName}: Action ${policy.name} в job "${jobName}" имеет некорректное значение uses.`);
        return false;
    }
    if (parsed.repo !== policy.name) {
        errors.push(
            `${wfName}: Action ${policy.name} в job "${jobName}" использует неподдерживаемый repository "${parsed.repo}". ` +
            `Требуется ровно "${policy.name}".`
        );
        return false;
    }
    if (!parsed.ref) {
        errors.push(
            `${wfName}: Action ${policy.name} в job "${jobName}" не имеет версии (@...). ` +
            `Используйте разрешённый ref, например @v${policy.allowedMajors[0]}.`
        );
        return false;
    }
    const versionMatch = parsed.ref.match(/^v(\d+)$/);
    if (!versionMatch) {
        errors.push(
            `${wfName}: Action ${policy.name} в job "${jobName}" использует неподдерживаемый ref "${parsed.ref}". ` +
            'Разрешён только точный major ref из официального шаблона (например, @v2); ' +
            'ветки, @main/@master, SHA и произвольные refs запрещены.'
        );
        return false;
    }
    const major = parseInt(versionMatch[1], 10);
    if (!policy.allowedMajors.includes(major)) {
        errors.push(
            `${wfName}: Action ${policy.name} в job "${jobName}" использует неподдерживаемый major @v${major}. ` +
            `Разрешены: ${policy.allowedMajors.map((value) => `@v${value}`).join(', ')}.`
        );
        return false;
    }
    return true;
}

function validateActionInputs(step, policy, wfName, jobName, errors) {
    const withInputs = step.with;
    let inputs = {};
    if (withInputs !== undefined) {
        if (withInputs === null || typeof withInputs !== 'object' || Array.isArray(withInputs)) {
            errors.push(`${wfName}: Action ${policy.name} в job "${jobName}": параметр "with" должен быть объектом.`);
        } else {
            inputs = withInputs;
        }
    }
    for (const input of policy.requiredInputs) {
        if (!(input in inputs)) {
            errors.push(
                `${wfName}: Action ${policy.name} в job "${jobName}" не имеет обязательного параметра "${input}" (ожидается внутри with).`
            );
        } else if (inputs[input] === null || String(inputs[input]).trim() === '') {
            errors.push(`${wfName}: Action ${policy.name} в job "${jobName}" имеет пустой обязательный параметр "${input}".`);
        }
        if (Object.prototype.hasOwnProperty.call(step, input) && !(input in inputs)) {
            errors.push(
                `${wfName}: Action ${policy.name} в job "${jobName}": параметр "${input}" должен находиться внутри with, а не на уровне step.`
            );
        }
    }
}

export function validateRequiredActions(jobs, wfName = 'workflow') {
    const errors = [];
    const warnings = [];
    const reviews = [];
    const safeJobs = jobs && typeof jobs === 'object' ? jobs : {};

    for (const policy of OFFICIAL_ACTIONS) {
        const occurrences = [];
        for (const [jobName, job] of Object.entries(safeJobs)) {
            const steps = Array.isArray(job?.steps) ? job.steps : [];
            for (const step of steps) {
                if (isCandidateUses(step?.uses, policy.name)) {
                    occurrences.push({ jobName, step });
                }
            }
        }

        if (occurrences.length === 0) {
            errors.push(
                `${wfName}: Action ${policy.name} не найден в существующей job "${policy.job}". ` +
                'Это обязательное действие для публикации.'
            );
            continue;
        }

        const inCorrectJob = occurrences.filter((occurrence) => occurrence.jobName === policy.job);
        if (inCorrectJob.length === 0) {
            errors.push(
                `${wfName}: Action ${policy.name} найден, но не в обязательной job "${policy.job}". ` +
                'Action должен вызываться в правильной job.'
            );
        }

        for (const { jobName, step } of occurrences) {
            validateActionRef(step.uses, policy, wfName, jobName, errors);
            validateActionInputs(step, policy, wfName, jobName, errors);
        }

        if (inCorrectJob.length > 1) {
            const refs = new Set(inCorrectJob.map((occurrence) => splitUses(occurrence.step.uses)?.ref ?? null));
            if (refs.size > 1) {
                errors.push(
                    `${wfName}: Action ${policy.name} в job "${policy.job}" вызывается несколько раз ` +
                    `с несовместимыми версиями: ${[...refs].map((ref) => ref ?? 'без версии').join(', ')}.`
                );
            } else {
                warnings.push(`${wfName}: Action ${policy.name} в job "${policy.job}" вызывается несколько раз.`);
            }
        }
    }

    return { errors, warnings, reviews };
}
