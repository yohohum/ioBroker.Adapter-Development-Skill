#!/usr/bin/env node
// Единый валидатор условия запуска deploy и зависимостей needs.
// Используется и release-preflight.mjs, и validate-skill.mjs, чтобы правила не расходились.

const FORBIDDEN_STATUS_FUNCTIONS = new Set(['always', 'failure', 'cancelled']);
const ALLOWED_FUNCTIONS = new Set(['startsWith', 'endsWith', 'contains', 'success']);

export class DeployConditionParseError extends Error {}

function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
        const ch = input[i];
        if (/\s/.test(ch)) {
            i += 1;
            continue;
        }
        const two = input.slice(i, i + 2);
        if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
            tokens.push({ type: 'op', value: two });
            i += 2;
            continue;
        }
        if ('!<>(),'.includes(ch)) {
            tokens.push({ type: 'op', value: ch });
            i += 1;
            continue;
        }
        if (ch === "'" || ch === '"') {
            const quote = ch;
            i += 1;
            let value = '';
            let closed = false;
            while (i < input.length) {
                const current = input[i];
                if (current === '\\') {
                    const next = input[i + 1];
                    if (next === undefined) throw new DeployConditionParseError('незавершённая escape-последовательность в строке');
                    value += next;
                    i += 2;
                    continue;
                }
                if (current === quote) {
                    closed = true;
                    i += 1;
                    break;
                }
                value += current;
                i += 1;
            }
            if (!closed) throw new DeployConditionParseError('незавершённая строковая константа');
            tokens.push({ type: 'string', value });
            continue;
        }
        if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(input[i + 1] ?? ''))) {
            let value = ch;
            i += 1;
            while (i < input.length && /[0-9.]/.test(input[i])) {
                value += input[i];
                i += 1;
            }
            const number = Number(value);
            if (!Number.isFinite(number)) throw new DeployConditionParseError(`некорректное число "${value}"`);
            tokens.push({ type: 'number', value: number });
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            let value = ch;
            i += 1;
            while (i < input.length && /[A-Za-z0-9_.]/.test(input[i])) {
                value += input[i];
                i += 1;
            }
            tokens.push({ type: 'ident', value });
            continue;
        }
        throw new DeployConditionParseError(`неподдерживаемый символ "${ch}"`);
    }
    return tokens;
}

function parseExpression(input) {
    const tokens = tokenize(input);
    let position = 0;

    const peek = () => tokens[position];
    const consume = () => tokens[position++];
    const expect = (value) => {
        const token = consume();
        if (!token || token.type !== 'op' || token.value !== value) {
            throw new DeployConditionParseError(`ожидался "${value}"`);
        }
        return token;
    };

    function parseOr() {
        let node = parseAnd();
        while (peek()?.type === 'op' && peek().value === '||') {
            consume();
            node = { type: 'binary', op: '||', left: node, right: parseAnd() };
        }
        return node;
    }

    function parseAnd() {
        let node = parseEquality();
        while (peek()?.type === 'op' && peek().value === '&&') {
            consume();
            node = { type: 'binary', op: '&&', left: node, right: parseEquality() };
        }
        return node;
    }

    function parseEquality() {
        let node = parseRelational();
        while (peek()?.type === 'op' && ['==', '!='].includes(peek().value)) {
            const op = consume().value;
            node = { type: 'binary', op, left: node, right: parseRelational() };
        }
        return node;
    }

    function parseRelational() {
        let node = parseUnary();
        while (peek()?.type === 'op' && ['<', '>', '<=', '>='].includes(peek().value)) {
            const op = consume().value;
            node = { type: 'binary', op, left: node, right: parseUnary() };
        }
        return node;
    }

    function parseUnary() {
        if (peek()?.type === 'op' && peek().value === '!') {
            consume();
            return { type: 'unary', op: '!', argument: parseUnary() };
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const token = consume();
        if (!token) throw new DeployConditionParseError('неожиданный конец выражения');
        if (token.type === 'string' || token.type === 'number') {
            return { type: 'literal', value: token.value };
        }
        if (token.type === 'op' && token.value === '(') {
            const node = parseOr();
            expect(')');
            return node;
        }
        if (token.type === 'ident') {
            if (token.value === 'true') return { type: 'literal', value: true };
            if (token.value === 'false') return { type: 'literal', value: false };
            if (token.value === 'null') return { type: 'literal', value: null };
            if (peek()?.type === 'op' && peek().value === '(') {
                consume();
                const args = [];
                if (!(peek()?.type === 'op' && peek().value === ')')) {
                    args.push(parseOr());
                    while (peek()?.type === 'op' && peek().value === ',') {
                        consume();
                        args.push(parseOr());
                    }
                }
                expect(')');
                return { type: 'call', name: token.value, args };
            }
            return { type: 'ref', path: token.value };
        }
        throw new DeployConditionParseError(`неожиданный токен "${token.value}"`);
    }

    const ast = parseOr();
    if (position !== tokens.length) {
        throw new DeployConditionParseError('лишние токены после выражения');
    }
    return ast;
}

function walk(node, visitor) {
    if (!node) return;
    visitor(node);
    if (node.type === 'unary') walk(node.argument, visitor);
    else if (node.type === 'binary') {
        walk(node.left, visitor);
        walk(node.right, visitor);
    } else if (node.type === 'call') {
        for (const arg of node.args) walk(arg, visitor);
    }
}

function isStringLiteral(node) {
    return node?.type === 'literal' && typeof node.value === 'string';
}

function isRef(node, path) {
    return node?.type === 'ref' && node.path === path;
}

function isCall(node, name) {
    return node?.type === 'call' && node.name === name;
}

function stringValue(node) {
    return isStringLiteral(node) ? node.value : null;
}

function isTruthyLiteral(node) {
    return node?.type === 'literal' && (node.value === true || node.value === 1);
}

function isFalsyLiteral(node) {
    return node?.type === 'literal' && (node.value === false || node.value === 0);
}

function isTagRefString(node) {
    const value = stringValue(node);
    return value !== null && value.startsWith('refs/tags/');
}

function isHeadsRefString(node) {
    const value = stringValue(node);
    return value !== null && value.startsWith('refs/heads/');
}

function isPullRequestString(node) {
    const value = stringValue(node);
    return value === 'pull_request' || value === 'pull_request_target';
}

function isTagGuardNode(node) {
    if (!node) return false;
    if (node.type === 'call' && (node.name === 'startsWith' || node.name === 'contains') && node.args.length >= 2) {
        return isRef(node.args[0], 'github.ref') && isTagRefString(node.args[1]);
    }
    if (node.type === 'binary' && node.op === '==') {
        if ((isRef(node.left, 'github.ref') && isTagRefString(node.right)) ||
            (isRef(node.right, 'github.ref') && isTagRefString(node.left))) {
            return true;
        }
        if ((isRef(node.left, 'github.ref_type') && stringValue(node.right) === 'tag') ||
            (isRef(node.right, 'github.ref_type') && stringValue(node.left) === 'tag')) {
            return true;
        }
    }
    return false;
}

function impliesTag(node) {
    if (!node) return false;
    if (isTagGuardNode(node)) return true;
    if (node.type === 'binary' && node.op === '&&') {
        return impliesTag(node.left) || impliesTag(node.right);
    }
    if (node.type === 'binary' && node.op === '||') {
        return impliesTag(node.left) && impliesTag(node.right);
    }
    return false;
}

function isNegatedTagGuardNode(node) {
    if (!node) return false;
    if (node.type === 'unary' && node.op === '!' && isTagGuardNode(node.argument)) {
        return true;
    }
    if (node.type === 'binary' && node.op === '!=') {
        if ((isRef(node.left, 'github.ref') && isTagRefString(node.right)) ||
            (isRef(node.right, 'github.ref') && isTagRefString(node.left))) {
            return true;
        }
        if ((isRef(node.left, 'github.ref_type') && stringValue(node.right) === 'tag') ||
            (isRef(node.right, 'github.ref_type') && stringValue(node.left) === 'tag')) {
            return true;
        }
    }
    if (node.type === 'binary' && (node.op === '==' || node.op === '!=')) {
        const leftGuard = isTagGuardNode(node.left);
        const rightGuard = isTagGuardNode(node.right);
        const other = leftGuard ? node.right : rightGuard ? node.left : null;
        if (other?.type === 'literal') {
            if (node.op === '==' && isFalsyLiteral(other)) return true;
            if (node.op === '!=' && isTruthyLiteral(other)) return true;
        }
    }
    return false;
}

function hasNegatedTagGuard(node) {
    let found = false;
    walk(node, (current) => {
        if (isNegatedTagGuardNode(current)) found = true;
    });
    return found;
}

function isSuccessNode(node) {
    return isCall(node, 'success');
}

function isNegatedSuccessNode(node) {
    if (!node) return false;
    if (node.type === 'unary' && node.op === '!' && isSuccessNode(node.argument)) {
        return true;
    }
    if (node.type === 'binary' && (node.op === '==' || node.op === '!=')) {
        const hasLeft = isSuccessNode(node.left);
        const hasRight = isSuccessNode(node.right);
        if (hasLeft || hasRight) {
            const other = hasLeft ? node.right : node.left;
            if (node.op === '==' && isFalsyLiteral(other)) return true;
            if (node.op === '!=' && isTruthyLiteral(other)) return true;
        }
    }
    return false;
}

function hasNegatedSuccess(node) {
    let found = false;
    walk(node, (current) => {
        if (isNegatedSuccessNode(current)) found = true;
    });
    return found;
}

function hasSuccessUsage(node) {
    let found = false;
    walk(node, (current) => {
        if (isSuccessNode(current)) found = true;
    });
    return found;
}

function impliesSuccess(node) {
    if (!node) return false;
    if (isSuccessNode(node)) return true;
    if (node.type === 'binary' && (node.op === '==' || node.op === '!=')) {
        const hasLeft = isSuccessNode(node.left);
        const hasRight = isSuccessNode(node.right);
        if (hasLeft || hasRight) {
            const other = hasLeft ? node.right : node.left;
            if (node.op === '==' && isTruthyLiteral(other)) return true;
            if (node.op === '!=' && isFalsyLiteral(other)) return true;
        }
    }
    if (node.type === 'binary' && node.op === '&&') {
        return impliesSuccess(node.left) || impliesSuccess(node.right);
    }
    if (node.type === 'binary' && node.op === '||') {
        return impliesSuccess(node.left) && impliesSuccess(node.right);
    }
    return false;
}

function forbiddenStatusFunctions(node) {
    const found = new Set();
    walk(node, (current) => {
        if (current.type === 'call' && FORBIDDEN_STATUS_FUNCTIONS.has(current.name)) {
            found.add(current.name);
        }
    });
    return [...found];
}

function unknownFunctions(node) {
    const found = new Set();
    walk(node, (current) => {
        if (current.type === 'call' && (current.name.includes('.') || !ALLOWED_FUNCTIONS.has(current.name))) {
            found.add(current.name);
        }
    });
    return [...found];
}

function isDirectBranchGuard(node) {
    if (!node) return false;
    if (node.type === 'call' && (node.name === 'startsWith' || node.name === 'contains') && node.args.length >= 2) {
        if (isRef(node.args[0], 'github.ref') && isHeadsRefString(node.args[1])) return true;
        if (isRef(node.args[0], 'github.event_name') && isPullRequestString(node.args[1])) return true;
    }
    if (node.type === 'binary' && node.op === '==') {
        if ((isRef(node.left, 'github.ref') && isHeadsRefString(node.right)) ||
            (isRef(node.right, 'github.ref') && isHeadsRefString(node.left))) {
            return true;
        }
        if ((isRef(node.left, 'github.event_name') && isPullRequestString(node.right)) ||
            (isRef(node.right, 'github.event_name') && isPullRequestString(node.left))) {
            return true;
        }
    }
    if (node.type === 'ref' && ['github.head_ref', 'github.base_ref', 'github.event.pull_request'].includes(node.path)) {
        return true;
    }
    return false;
}

function allowsBranchOrPullRequest(node) {
    if (!node) return false;
    if (node.type === 'unary' && node.op === '!') {
        if (isDirectBranchGuard(node.argument)) return false;
        return allowsBranchOrPullRequest(node.argument);
    }
    if (node.type === 'binary' && (node.op === '&&' || node.op === '||')) {
        return allowsBranchOrPullRequest(node.left) || allowsBranchOrPullRequest(node.right);
    }
    return isDirectBranchGuard(node);
}

function isUnconditional(node) {
    return node?.type === 'literal' && (node.value === true || node.value === 1);
}

function isOfficialSkipCiGuard(node) {
    if (node?.type !== 'binary' || node.op !== '==') return false;
    const left = node.left;
    const right = node.right;
    if (isFalsyLiteral(right) && isCall(left, 'contains')) {
        return left.args.length === 2 && isRef(left.args[0], 'github.event.head_commit.message') &&
            stringValue(left.args[1]) === '[skip ci]';
    }
    if (isFalsyLiteral(left) && isCall(right, 'contains')) {
        return right.args.length === 2 && isRef(right.args[0], 'github.event.head_commit.message') &&
            stringValue(right.args[1]) === '[skip ci]';
    }
    return false;
}

function isPushEventGuard(node) {
    return node?.type === 'binary' && node.op === '==' &&
        ((isRef(node.left, 'github.event_name') && stringValue(node.right) === 'push') ||
         (isRef(node.right, 'github.event_name') && stringValue(node.left) === 'push'));
}

function flattenAnd(node, result = []) {
    if (node?.type === 'binary' && node.op === '&&') {
        flattenAnd(node.left, result);
        flattenAnd(node.right, result);
    } else if (node) result.push(node);
    return result;
}

function matchesOfficialDeployCondition(ast) {
    const terms = flattenAnd(ast);
    const tag = (node) => node?.type === 'call' && node.name === 'startsWith' && node.args.length === 2 &&
        isRef(node.args[0], 'github.ref') && stringValue(node.args[1]) === 'refs/tags/v';
    if (terms.length === 1 && tag(terms[0])) return true;
    return terms.length === 3 && terms.filter(tag).length === 1 &&
        terms.filter(isPushEventGuard).length === 1 && terms.filter(isOfficialSkipCiGuard).length === 1;
}

function onlySafeTagNarrowing(ast) {
    if (ast?.type !== 'binary' || ast.op !== '&&') return false;
    const terms = flattenAnd(ast);
    const isReleaseVersionTag = (node) => node?.type === 'call' && node.name === 'startsWith' &&
        node.args.length === 2 && isRef(node.args[0], 'github.ref') && stringValue(node.args[1]) === 'refs/tags/v';
    const hasTag = terms.some(isReleaseVersionTag);
    const remaining = terms.filter((node) => !isReleaseVersionTag(node));
    return hasTag && remaining.length > 0 && remaining.every((node) =>
        isOfficialSkipCiGuard(node) || isPushEventGuard(node) ||
        (node?.type === 'unary' && node.op === '!' && isDirectBranchGuard(node.argument)) ||
        (node?.type === 'binary' && node.op === '!=' &&
            ((isRef(node.left, 'github.ref_type') && stringValue(node.right) === 'branch') ||
             (isRef(node.right, 'github.ref_type') && stringValue(node.left) === 'branch')))
    );
}

export function normalizeDeployCondition(rawCondition) {
    return String(rawCondition).replace(/\$\{\{/g, '').replace(/\}\}/g, '').trim();
}

export function validateDeployCondition(rawCondition) {
    const result = {
        status: 'pass',
        errors: [],
        reviews: [],
        normalized: null,
    };

    if (rawCondition === undefined || rawCondition === null || String(rawCondition).trim() === '') {
        result.status = 'fail';
        result.errors.push('job "deploy" не имеет условия запуска. Публикация должна выполняться только по релизным тегам.');
        return result;
    }

    const normalized = normalizeDeployCondition(rawCondition);
    result.normalized = normalized;

    let ast;
    try {
        ast = parseExpression(normalized);
    } catch (error) {
        result.status = 'review';
        result.reviews.push(
            `Условие deploy невозможно безопасно разобрать (${error instanceof Error ? error.message : String(error)}); требуется ручная проверка.`
        );
        return result;
    }

    // The official create-adapter workflow uses this positive tag guard. GitHub
    // implicitly adds success() when no status-check function is present, so
    // accepting any larger expression here would create unnecessary escape hatches.
    // Parse first (unknown/malformed syntax is NEEDS REVIEW), then allow only this
    // exact AST shape; formatting and quote style are normalized by the parser.
    const official = matchesOfficialDeployCondition(ast);
    if (!official) {
        if (hasNegatedTagGuard(ast)) {
            result.status = 'fail';
            result.errors.push('job "deploy" инвертирует проверку релизного тега — это небезопасное условие публикации.');
            return result;
        }
        if (onlySafeTagNarrowing(ast) && !forbiddenStatusFunctions(ast).length && !hasSuccessUsage(ast)) {
            result.status = 'pass';
            return result;
        }
        if (unknownFunctions(ast).length > 0 && !forbiddenStatusFunctions(ast).length &&
            !hasNegatedSuccess(ast) && !hasSuccessUsage(ast) && impliesTag(ast) && !allowsBranchOrPullRequest(ast)) {
            result.status = 'review';
            result.reviews.push(`Условие deploy содержит неизвестные функции: ${unknownFunctions(ast).join(', ')}; требуется ручная проверка.`);
            return result;
        }
        const forbidden = forbiddenStatusFunctions(ast);
        const unsafeStatus = forbidden.length || hasNegatedSuccess(ast) || hasSuccessUsage(ast) ||
            walkHasUnknown(ast) || hasNegatedTagGuard(ast) || allowsBranchOrPullRequest(ast) || !impliesTag(ast);
        if (unsafeStatus) {
            result.status = 'fail';
            result.errors.push(`job "deploy" не соответствует проверенному условию официального шаблона: ${normalized}`);
        } else {
            result.status = 'review';
            result.reviews.push('Условие deploy не совпадает с проверенной схемой официального шаблона; требуется ручная проверка.');
        }
        return result;
    }

    result.status = 'pass';
    return result;
}

function walkHasUnknown(node) {
    return unknownFunctions(node).length > 0;
}

export function validateDeployNeeds(jobs, wfName = 'workflow') {
    const errors = [];
    const deployJob = jobs?.deploy;
    if (!deployJob) return { errors };

    const needs = deployJob.needs ?? [];
    const needsArray = Array.isArray(needs) ? needs : [needs];
    for (const dependency of ['check-and-lint', 'adapter-tests']) {
        if (!needsArray.includes(dependency)) {
            errors.push(
                `${wfName}: job "deploy" не зависит от обязательной задачи "${dependency}". ` +
                'Публикация не должна выполняться при ошибках тестирования.'
            );
        }
    }
    return { errors };
}
