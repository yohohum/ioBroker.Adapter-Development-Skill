# ioBroker Adapter Development Skill

Full GitHub Skill for AI agents developing ioBroker adapters: from protocol analysis and scaffolding to testing, repository validation, and release.

## Main principle

Official ioBroker documentation and schemas are the single source of truth for APIs, object models, roles, Admin UI, and acceptance requirements. This repository organizes the process and contains auxiliary checks, but does not replace the documentation and does not guarantee compatibility with future versions without re-verification.

## Quick start

1. Clone this repository or copy the Skill folder to the directory indexed by your AI agent.
2. Make sure the agent can read `SKILL.md`, open external links, and run shell/Node.js commands in the adapter repository.
3. Give the agent a task to create or modify an adapter and explicitly require applying `SKILL.md`.
4. For a new adapter, the agent should start with the official generator:

   ```bash
   npx @iobroker/create-adapter@latest
   ```

5. Inside the adapter project, install dependencies, then after implementation run checks:

   ```bash
   npm ci
   bash /path/to/skill/scripts/run-adapter-checks.sh https://github.com/<OWNER>/ioBroker.<adaptername>
   ```

   This script assumes the presence of `npm` scripts `build`, `lint`, `test:package`, `test:integration` and access to the npm Registry for running repochecker.

## Structure

```text
.
├── SKILL.md
├── README.md
├── README.en.md
├── CONTRIBUTING.md
├── LICENSE
├── .editorconfig
├── .gitignore
├── .github/workflows/validate-skill.yml
├── references/
│   ├── official-sources.md
│   ├── object-model.md
│   ├── security.md
│   ├── transports.md
│   ├── admin-config.md
│   ├── testing.md
│   └── release-and-repository.md
├── workflows/
│   ├── 01-discovery.md
│   ├── 02-scaffolding.md
│   ├── 03-architecture.md
│   ├── 04-implementation.md
│   ├── 05-admin-ui.md
│   ├── 06-debugging.md
│   ├── 07-testing.md
│   ├── 08-release-gate.md
│   └── 09-release.md
├── scripts/
│   ├── adapter-preflight.mjs
│   ├── check-object-dump.mjs
│   ├── check-translations.mjs
│   ├── release-preflight.mjs
│   ├── run-adapter-checks.sh
│   ├── validate-skill.mjs
│   └── lib/
│       ├── action-refs.mjs
│       ├── deploy-condition.mjs
│       └── publish-workflow.mjs
└── templates/
    ├── adapter-tests/
    │   ├── testPackageFiles.cjs
    │   └── testAdapter.integration.cjs
    ├── changelog/
    │   ├── CHANGELOG_OLD.md
    │   └── README-changelog-section.md
    ├── release/releaseconfig.json
    └── github-actions/
        ├── adapter-ci.yml
        └── test-and-release.yml
└── test/
│   ├── fixtures/
│   │   ├── translations/
│   │   └── release/
│   └── run-regression-tests.mjs
```

## What the Skill checks

- correctness of package/io-package metadata and version synchronization;
- basic object dump structure and role semantics;
- presence of integration tests with JS-Controller;
- build, lint, and repochecker;
- changelog, release-script, and npm Trusted Publishing configuration.

Scripts are additional control, not a replacement for `@iobroker/testing`, `@iobroker/repochecker`, Adapter Checker, or manual hardware testing.

## Installation in the agent repository

The recommended option is to keep the Skill as a separate repository and connect it to the corresponding agent directory. If the agent needs a single file, use the full `SKILL.md`, but for the full process `references/`, `workflows/`, `scripts/`, and `templates/` are also required.

## Installation on GitHub

Create a repository, for example `ioBroker.Adapter-Development-Skill`, copy all contents of this directory to the root, and run:

```bash
git init
git add .
git commit -m "Initial ioBroker adapter development skill"
git branch -M main
git remote add origin https://github.com/<OWNER>/ioBroker.Adapter-Development-Skill.git
git push -u origin main
```

Replace `<OWNER>` with the repository owner. Before public use, check the license, access settings, and the path by which your agent discovers skills.

## Update

When ioBroker is updated, check `references/official-sources.md`, then review templates and scripts. Do not increase minimum js-controller/Node.js versions without checking the compatibility matrix. All changes to the Skill itself must pass `.github/workflows/validate-skill.yml`.

## Official primary sources

Summary list and purpose of each source — in [`references/official-sources.md`](references/official-sources.md).
