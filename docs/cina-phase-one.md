# Cina CLI: local first slice

This document retains the initial pnpm 10 baseline and its validation history.
The current pnpm 12 integration and remaining gates are recorded in
[the integration report](cina-phase-one-integration.md).

`packages/cina-cli` is the independent, private `@cinagroup/cli@0.1.0` package
with the `cina` executable. The existing `packages/cli` package, `cf` commands,
generated SDK, and compatibility tests remain in place. This slice does not
publish npm packages, push, create a PR, deploy, configure credentials, or
change production state. Publishing requires a separate reviewed release
identity; npm trust and OIDC settings are unchanged.

## Static inspection and explicit execution

The entry runs on Node 22 or later without runtime dependencies. It reads
static `cina.project.json` with `schemaVersion: 1`, or a bundled preset. Each
manifest describes project/component roots, toolchains, argv arrays, cwd,
dependencies, outputs, effects, and credential references. Component lockfiles
and package-manager versions remain authoritative. This CLI workspace keeps
pnpm 10; it does not migrate projects or replace existing Turbo caches.

`help`, `inspect`, `doctor`, and `plan` only read static data and local files.
They do not run repository scripts, install, log in, write project files,
contact remote services, evaluate TypeScript configuration, or invoke
Cloudflare autoconfiguration. The independent entry does not load the `cf`
SDK, initialize its global state, or send upstream telemetry.

`run` explicitly executes declared check/build/test tasks. Script names do not
prove read-only behavior: checks can generate files, and lint scripts can use
`--fix` or build. Local-write effects require `--allow-local-write`. An
undeclared deployment capability never falls back to Cloudflare. `cf deploy
--dry-run`, which normally builds, is not a static plan implementation.

The runner validates repository and symbolic-link containment, unknown
capabilities, dependency cycles, and reviewed script drift before execution.
It passes argv without shell concatenation and limits the child environment.
For npm tasks, HOME/USERPROFILE are the controlled task cwd and the cache is
under `.cina-cache/npm` there. User/global npm config is not inherited;
implicit pre/post script hooks are disabled, while the requested reviewed
script executes. These local cache writes belong to the run boundary.
It is not an operating-system network/filesystem sandbox: native scripts are
code with host access, so review their actual implementation and effects.
Timeout or cancellation does not undo artifacts already written.

## Use and verification

After installing the workspace's frozen lockfile, run these from its root:

```sh
pnpm check:cina
pnpm test:cina
pnpm build:cina
node packages/cina-cli/bin/cina.mjs --help
node packages/cina-cli/bin/cina.mjs inspect
node packages/cina-cli/bin/cina.mjs doctor --project cinagroup --repo /path/to/cinagroup
node packages/cina-cli/bin/cina.mjs plan build --project cinagroup --repo /path/to/cinagroup
node packages/cina-cli/bin/cina.mjs run build --project cinagroup --repo /path/to/cinagroup --allow-local-write
```

`--repo` names the target Git repository root. A `cina.project.json` there
overrides its matching bundled preset. `--component NAME` selects a component
for plan/run. Results are JSON and child output goes to stderr; help is plain
text. Doctor readiness is separate from native verification. Bundled presets
remain `configured-pending-validation` until execution evidence is maintained
separately; recognizing seven projects never means all seven passed builds.

Exit codes: `0` success, `1` failure/partial failure, `2` invalid request or
manifest, `124` timeout, `130` cancelled.

Checks use the existing oxlint, tsgo with `checkJs`, and oxfmt. Tests use Node's
built-in runner. Build copies this package's ESM into its own `dist`, keeping
catalog and schema files at package root. Neither its build nor type checking
depends on `cf` generation. The package archive includes bin/dist/catalog/schema.

`.github/workflows/cina-ci.yml` checks Linux and Windows with Node 22 and a
frozen pnpm install, then lint/type/format, contract tests, build, and local
`npm pack --ignore-scripts`. It extracts the archive and invokes its bin
directly. It has read-only contents permissions, no release/OIDC job, and no
remote-cache secrets. These workflows were not remotely triggered here.

Existing CI checks and both `cf` suites now support the Cloudflare and Cina
owners. Cloudflare remote-cache inputs are conditional on the Cloudflare
owner. Release/prerelease guards remain unchanged. A package-only check does
not replace the repository's exact root `pnpm check` gate.

Local packaging completed with `node packages/cina-cli/scripts/build.mjs`
and `npm pack ./packages/cina-cli --ignore-scripts --pack-destination ../artifacts`.
The `artifacts/cinagroup-cli-0.1.0.tgz` outside this repository contains
14 files: metadata, bin, four ESM files, seven catalogs, and schema. After
extraction, `--help`, `--version`, and `inspect` each exited 0; inspect listed
exactly seven projects. The schema parsed as draft 2020-12/schemaVersion 1.
The archive has no source tree, installed dependencies, or `cf` SDK.

Final Cina-specific validation passed: the complete package `check`
(lint/type/format) exited 0 and its Node contract suite passed 34/34 tests
with zero skips. The final refreshed archive is 19,998 bytes, SHA-256
`1ABBE1AFA098FB6D8FFEA4DF694D33C00CEA5E7D7A64C762158D669247DA512A`;
the extracted help/version/seven-project inspect smoke passed again.

The first exact repository root `pnpm check` attempt exited 1 because
`@cloudflare/forge` was unavailable after installation hit `ENOSPC`.
The full frozen dependency install subsequently succeeded. Only unmodified
baseline files were restored to HEAD's LF bytes in this new clone; all
implementation changes were preserved. The canonical root gate passed format
and Cina type checking, then failed when the retained generator used a file
URL's `.pathname` as a Windows path (`C:\\C:\\Users\\...`, `ENOENT`). A
separate four-file repair converts the output URL with `fileURLToPath` and
adds a cf patch changeset. Its three regression cases cover native absolute
paths, decoded spaces/Unicode, and a real Forge write/read in a temporary
directory. Targeted type-aware lint, no-emit typecheck, and formatting passed.

After that repair, the exact root `pnpm check` passed: 7/7 tasks, 2m24.41s,
including cf generation (4,135 files), root lint/format, package/fixture
typechecks, and cf build (286 files, 15.14 MB). Generated directories and SDK
are absent from the review diff; they were generated through the native
command, never edited by hand. Log: `validation/root-check-after-pathfix.log`.

Retained source regression samples ran successfully without publishing or
calling business APIs:

- `pnpm --filter cf test src/__tests__/help.test.ts --maxWorkers=1`:
  exit 0, 21 passed (128.85 seconds, including SDK cold transformation).
- `pnpm --filter @cloudflare/wrangler-tests test
src/__tests__/flagship.test.ts --maxWorkers=1`: exit 0, 16 passed,
  50 existing skips and 22 existing todo cases (108.32 seconds, MSW mocked).
- After successful native generation, `pnpm --filter cf test
src/__tests__/help.test.ts src/__tests__/generator/output-directory.test.ts
--maxWorkers=1`: exit 0, 24 passed in 112.50 seconds. The separate path
  repair's 3 cases and retained help's 21 cases both passed against the new
  local generated output. Log: `validation/cf-after-generate-tests.log`.
- The independent Cina suite passed again after generation: 34/34, zero
  skips, 2.25 seconds. Log: `validation/cina-contract-tests.log`.

The complete retained suites and cf packaging were not run. Focused tests,
the passing local root gate, and Cina packing do not establish a passing
remote CI matrix. Logs are in the task's `validation` directory. Validation
dependencies are installed; disk pressure and the original Windows path
failure were resolved for these bounded checks. Immediately after the root
gate, free space was about 318 MiB, so a full additional install/build needs
a fresh capacity plan.

## Seven-project scope

| Project      | Engineering boundary                                                                | Native verification in this slice                            |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| cinagroup    | Astro/npm root website; preserve content/i18n/facts/Functions gates                 | Pilot: native check/build and quality gates passed           |
| cinaclassics | `Tools` engineering; local artifacts, Worker API, and R2 publish are separate       | Pilot: native typecheck passed; artifact/Worker builds unrun |
| cinatoken    | npm workspace; Workers plus Node/Docker; multiple databases                         | Configured, pending                                          |
| cinaauth     | pnpm 11/Turbo; Workers and existing `identity.profile.read` agent scope             | Configured, pending                                          |
| cinashop     | No root package; `workers-ts` and frontends under `view` each keep their toolchain  | Configured, pending                                          |
| cinaseek     | pnpm 11; backend/router/gatekeepers/frontend Workers; business CapnWeb RPC separate | Configured, pending                                          |
| cinachain    | Base Sepolia Beta; Next DApp, portal, docs-site, Solidity, six Workers              | Configured, pending                                          |

Cinagroup Actions remains its only production publishing path; manual
workflow validates only. Cinaclassics artifact generation does not authorize
Worker/R2 publishing. Cinatoken has both npm and pnpm lockfiles while current
CI uses npm; onboarding does not migrate runtime or databases.

Cinaauth uses pnpm `11.1.1` and Node 24, forbids root `pnpm test`, and its docs
`postbuild` synchronizes Typesense. The catalog excludes an aggregate build
pending a more detailed task dependency review. Onboarding does not expand
business authorization. Cinaseek uses pnpm `11.17.0`; its lint also builds and
must declare local-write effects.

Cinachain baseline `78b8a13af28f4eb21134e58194a641f5bf392e59` is a Web3 platform.
Its `scripts/compile-and-deploy.mjs` actually compiles solc to `contracts/out`;
classification is based on implementation, not its name. Contract deployment
and administration workflows are separate and excluded. No private-key
configuration, RPC broadcast, transaction, billing/paymaster activation is
included. Its `.nvmrc` says Node 18 while root requires Node 22 or later and
npm `11.11`; this conflict remains for native verification.

## Pilot evidence and remaining acceptance

Cinagroup checkout: `79b14e23f4af694b7d222c98a63d1d09f7dc397c`.

- `npm ci --ignore-scripts --no-audit --no-fund`: exit 0, 840 packages.
- `npm run test:contact`: exit 0, 16 tests.
- `npm run test:blog-i18n`: exit 0, 9 tests.
- `npm run audit:source`: exit 0, content/facts/evidence/i18n gates.
- `npm run build`: exit 0, 758 pages, 125.16 seconds.
- `npm run check:cloudflare`: exit 0, types check, no-emit typecheck, Functions build.
- `npm run check`: Astro checked 213 files without errors/warnings, ESLint
  passed, then Prettier failed on 212 files checked out with system CRLF.
  After matching each file to HEAD and restoring only LF, the isolated
  `npm run check:prettier` passed, then the complete `npm run check` rerun
  passed. Log: `pilot-logs/cinagroup-check-lf.log`.
- Built `audit:evidence`, `audit:content`, `audit:blog`, and `audit:build` all
  passed: 758 pages, 406 archives, 33,909 internal links, 2 CSS files.
- The final native npm runner executed the contact and blog-i18n tests:
  25/25 passed, with structured successful task results.

The sandbox initially blocked esbuild ancestor-path access. Authorized
execution outside that restriction was used for the local pilot checks;
telemetry was disabled. Pilot logs are retained in the task's `pilot-logs`
directory outside this repository.

Cinaclassics sparse checkout reached
`6c5d4a9184f866872bf47fdb60cdcc7c81fd33c1`. Initial full checkout/dependency
attempts encountered memory allocation and `No space left on device`
failures. After reclaiming this task's disposable files, `Tools` source and
lockfile were obtained. The following native commands completed:

- `npm ci --ignore-scripts --omit=optional --no-audit --no-fund`: exit 0,
  56 packages in 6 seconds; the lock contains 97 optional entries of 154.
- `npm run typecheck`: exit 0 (`tsc --noEmit`, as defined by that component).
  Logs: `pilot-logs/cinaclassics-install-optional.log` and
  `pilot-logs/cinaclassics-typecheck.log`.
- `cina doctor --project cinaclassics --repo <sparse-checkout>` reported
  ready. `cina run check --project cinaclassics --repo <sparse-checkout>
--allow-local-write` then passed `tools/types`, exit 0, about 1.7 seconds.

PDF/artifact generation, Worker build, R2 publishing, and deployment were not
run. Local artifact processing searches for ancestor assets and is not
registered as an executable task in this first slice. The typecheck result
must not be reported as full artifact/build validation.

The acceptance target remains seven recognized manifests plus verified native
results for both pilots. Both now have native quality-check evidence, while
Cinaclassics artifact/build verification remains outstanding. The other five
projects remain configured, awaiting execution. Next, verify that artifact
pipeline with its required local assets and sufficient disk/memory, complete
the retained `cf` suites, then verify remaining components against their own
lockfiles. Review deployment integration as a separate later slice.

## Baseline and newer main compatibility review

This local branch starts at
`502c355327d013cfba20ac9d39d6d6423610bda1`. A read-only GitHub branch/compare
review on 2026-09-30 verified remote main at
`f642dc6831902f4c9410d86cffd416279ca1b2e0`, 12 commits ahead of that baseline
and zero behind. The review did not fetch a new working tree, rebase, change
local HEAD, merge, or trigger any remote workflow.

The newest commit updates Forge/OpenAPI to
`955bb31330017e914b9e37c537f9bd4e59317982`; its preceding commit
`57dc71d94961bac0fc896acae0e2f533bed4195e` fixes registrar positional domain
arguments. These affect the retained `cf` generator, generated artifacts,
and tests. Remote packages still contain only `cli` and `wrangler-tests`,
so the new `cina-cli` directory does not overlap an existing remote package.
The remote Turbo task layout is unchanged from this slice's baseline.

Compatibility is a structural inference, not an integration test. Before
combining this slice with newer main:

- Preserve main's pnpm `12.6.0` migration, its multi-document lockfile, and
  patchedDependencies moved to `pnpm-workspace.yaml`. The pnpm 10 statements
  above describe this local baseline, not current remote main. Reapply the
  new dependency-free workspace importer using main's package-manager format.
- Preserve main's CI `merge_group` trigger (`checks_requested`, branch main)
  while adding the Cina owner/check/cache-isolation changes. Account for the
  new Cina CI status if a merge queue later requires it.
- Keep main's cf dependency/test/Forge changes; the new package has no runtime
  cf/SDK dependency, so those changes do not require shared authentication or
  generator wiring. Rerun all required checks after integration rather than
  assuming this baseline's results establish newer-main compatibility.

Read-only sources:
[commit comparison](https://github.com/cinagroup/cinacli/compare/502c355327d013cfba20ac9d39d6d6423610bda1...f642dc6831902f4c9410d86cffd416279ca1b2e0),
[pnpm migration](https://github.com/cinagroup/cinacli/commit/ce5f213e8c65148af599b37fad3527b0cb8e74e8),
[merge-queue CI](https://github.com/cinagroup/cinacli/commit/948cfdf457a9feac4534963ddd09431961c911d5),
[Forge update](https://github.com/cinagroup/cinacli/commit/f642dc6831902f4c9410d86cffd416279ca1b2e0),
[registrar fix](https://github.com/cinagroup/cinacli/commit/57dc71d94961bac0fc896acae0e2f533bed4195e).
