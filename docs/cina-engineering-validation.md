# Cina CLI engineering validation: 2026-10-01

This report records the local slice saved as `7747146f`. The later Node 22
verification and scoped Shop continuation are recorded in
[the Node/Shop report](cina-node-shop-validation.md); its results supersede the
Node 22 and Shop gaps listed below without changing this historical evidence.

The independent checkout is `cinacli-phase1`, branch
`cina/phase-one-main-integration`, continuing local commit
`2366789ab011727ff361bae6673da02a9a17534f`. The base and read-only remote main
remain `f642dc6831902f4c9410d86cffd416279ca1b2e0`. No rebase, remote write,
publication, deployment, business API request or credential change was performed.

Initial free space was 11,531,411,456 bytes (10.739 GiB). The bounded installation
reserved 1 GiB and estimated another 2 GiB; it restored dependencies using the
existing pnpm 12.6.0 native executable, `install --frozen-lockfile --ignore-scripts
--store-dir <task>/pnpm-store`. It preserved the workspace policies, metadata
verification, two lockfile documents, patches and merge queue. No files or shared
caches were removed. The first invocation used an unsupported `--cache-dir`
option and exited immediately; removing that option fixed the invocation.

## Repository validation

The pnpm 12 frozen online install succeeded in 69.2 seconds. It restored 456
packages without changing tracked dependency configuration. This resolves the
earlier `ERR_PNPM_NO_OFFLINE_META` and missing-link blocker through the installer,
without bypassing its supply-chain checks.

The exact root `pnpm check` passed 7/7 tasks in 5m42.731s, with zero cached tasks.
It generated and formatted 4,134 CLI files, built 287 files (15.19 MB), and
completed lint, format, CLI/Cina type checks and fixture type checks. Generated
directories were never edited manually. This result covers the integrated
2366789 baseline before the continuation's runner changes.

The initial four-file CF source regression exceeded its 300-second process
budget without reporting a completed test; the process tree was stopped.
Splitting the run produced 9/9 generator tests, including the actual Forge
finalize/write/read path regression. The matching test bundle passed in 43.789
seconds. Compiled Wrangler compatibility passed 7 secret-update tests (50
unselected skips, 3 existing todos), and 16 flagship tests (50 existing skips,
22 existing todos). The two remaining CF command files passed 43/43 in 231.15
seconds (227.87 seconds import, 2.71 seconds tests). All six selected regression
files now have passing results; the initial timeout remains recorded rather
than being counted as a passing run.

## Token scope

`pilots/cinatoken-phase2` is fixed at
`de5b720c2e45f02ba62c29c45791f01e2569a782`; native package tasks use the existing
npm lockfile. The installation selected `@octafuse/tool-engines` and the root
development tools, with `--ignore-scripts --no-audit --no-fund`; 191 packages
were installed. Root `postinstall` / `gen:wrangler` did not run and no lockfile
was changed. No root or tool-engines AGENTS/skill files exist; admin instructions
apply outside this slice.

The actual native commands, from `packages/tool-engines`, were `npm run
typecheck` and `npm run test:unit`. TypeScript 5.9.3 passed with no emit. The
four declared test files passed 44/44, zero skips, in 3.063 seconds. Their
provider calls use injected mock fetch or synthetic credentials sent only to
local loopback servers; no vendor business endpoint, database or remote smoke
test ran. Source-only core subpath imports need no core build.

The first actual Cina runner check failed before executing any task because
the Windows npm shim was not recognized. The continuation repairs static
tool resolution rather than evaluating the shell wrapper. Core/proxy builds
remain configured but blocked by their implicit pre/post lifecycle hooks;
that limitation is now explicit in the catalog. No hook policy was relaxed.

After repairing the shim mapping, both actual Cina tasks passed with structured
exit 0: `tool-engines/check-types` and `tool-engines/test-unit` (44/44 tests).
Both were repeated after the last environment-isolation change. The pilot
branch is `cina/tool-engines-phase2` and its tracked files remain unchanged.
This evidence uses Node 24.14.1 on Windows; Token's `.nvmrc` suggests Node 22,
which remains unrun and is not counted as a Node 22 success.

## Auth scope

Auth is fixed at `bfa56df798ede6a40e9d5cea0ef1a1e9a3568f3f`. The only local task
is `packages/auth-proxy` / `pnpm run test`, using its existing package
script and configuration. The five tests construct in-memory Request,
Response and Headers values and require no build, network, database, files or
credentials. The root test runner, documentation build/Typesense postbuild,
Workers deployment and cross-business authorization changes are excluded.

The actual native task passed 1 file / 5 tests on Vitest 4.1.10. Its filtered
pnpm 11.1.1 frozen install also includes the root development importer (564
packages, 48.8 seconds); it is not a two-dependency installation. The lockfile
SHA256 remained `01174f8479e77c6d217b82f99c738ba786a287dc7f5bff9b3b1948236820b60e`.
Declared outputs include npm and Vitest/Vite local caches. Existing root type
check outputs were corrected to include all 26 reviewed TypeScript cache
directories, without running or expanding the aggregate task.

The final actual Cina task also passed 1 file / 5 tests with structured exit 0,
using the already-installed pnpm 11.1.1 JS entry and Node 24.14.1. Two earlier
runner attempts selected the incomplete native pnpm 11 loader, which lacked
its required sibling JS payload after `--ignore-scripts` installation. They
failed before starting the test, and their logs remain saved. The runner now
rejects that incomplete tool statically and discovers the supported installed
JS entry. It does not copy payloads, execute setup scripts or download tools.

## Final runner and package checks

Static discovery now supports real npm Windows shim paths, pnpm 11 JS and
complete native layouts, and the pnpm 12 native layout. Metadata version,
platform, executable declaration, package containment, runtime readiness and
native header checks reject mismatches and incomplete installations without
running `--version`, wrappers, Corepack or project code. Script execution still
uses argv and the original native script; lifecycle hooks remain rejected.
Package-manager auto-download and Node compile-cache creation are disabled in
the isolated task environment; the pnpm-specific guard is only applied to
pnpm tasks.

The final Cina suite passed 43/43 with no skips, including real installer
layout fixtures, tool/runtime boundary rejection and focused Token/Auth plans.
Strict checkJs type checking, type-aware lint and source formatting also
passed. After the last runner change, the final exact root gate passed 7/7 in
2m36.059s (three existing task-cache hits, remote caching disabled); lint found
zero warnings/errors across 485 files. Package build/offline pack and extracted
help/version/inspect also passed, with 14 archive entries and seven projects.
Their evidence is saved separately as
`validation/20261001-root-check-final.log` and
`validation/20261001-cina-pack.json` and included in the review archive.

## Acceptance limits

Seven projects remain identifiable and configured pending validation. Native
evidence is scoped to exact checkout commits and tasks, not whole-project
completion. Cinagroup's prior quality/build results remain tied to 79b14e23;
Cinaclassics typecheck and offline Worker bundle remain tied to 6c5d4a91.
Cinaclassics has no PDF/runtime acceptance: required assets remain missing and
asset/output containment still needs a reviewed fixture. No assets were fabricated.

Node 22/Linux CI, the full CF/Wrangler suites, Token's other components and
Auth's other packages remain unrun. Shop, Seek and Chain still await their own
small batches. Publication/deployment require separate coordination.
