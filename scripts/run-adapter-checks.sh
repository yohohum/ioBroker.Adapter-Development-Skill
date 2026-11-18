#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "${1:-.}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILURES=0

run_check() {
    local label="$1"
    shift
    printf '\n===== %s =====\n' "$label"
    if (cd "$ROOT" && "$@"); then
        printf 'PASS: %s\n' "$label"
    else
        local code=$?
        printf 'FAIL: %s (exit %s)\n' "$label" "$code" >&2
        FAILURES=$((FAILURES + 1))
    fi
}

if [[ ! -f "$ROOT/package.json" || ! -f "$ROOT/io-package.json" ]]; then
    echo "Run this script from an ioBroker adapter project root (package.json and io-package.json required)." >&2
    exit 2
fi

PREFLIGHT_ARGS=()
if [[ "${ALLOW_IO_PACKAGE_NO_PRERELEASE:-0}" == "1" ]]; then
    PREFLIGHT_ARGS+=("--allow-io-package-no-prerelease")
fi
run_check "Adapter metadata preflight" node "$SCRIPT_DIR/adapter-preflight.mjs" "$ROOT" "${PREFLIGHT_ARGS[@]}"
run_check "Build" npm run build
run_check "ESLint" npm run lint
run_check "Package/schema tests" npm run test:package
run_check "Controller integration tests" npm run test:integration
run_check "Built entry-point and metadata preflight" node "$SCRIPT_DIR/adapter-preflight.mjs" "$ROOT" --check-main "${PREFLIGHT_ARGS[@]}"
run_check "ioBroker repository checker" npx --yes @iobroker/repochecker

if [[ "${WITH_NPM_AUDIT:-0}" == "1" ]]; then
    run_check "npm production dependency audit" npm audit --omit=dev
fi

printf '\n===== Summary =====\n'
if [[ "$FAILURES" -gt 0 ]]; then
    echo "$FAILURES check(s) failed. Do not release until resolved." >&2
    exit 1
fi
echo "All automated checks passed. Manual hardware, OBJECTDUMP and online Adapter Checker validation may still be required."
