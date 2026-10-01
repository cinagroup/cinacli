# Cina CLI Node and Shop validation: 2026-10-01

This local continuation follows `7747146f3ab9c960ac15649e4549bbda35471e72`
on `cina/phase-one-main-integration` in the isolated `cinacli-phase1` checkout.
The integrated main base remains `f642dc6831902f4c9410d86cffd416279ca1b2e0`.
It does not change the repository's pnpm 12 lockfile or workspace policies.
No remote write, deployment, workflow invocation, credential change or global
runtime/configuration change was performed.

## Explicit runtime selection

No existing Node 22 runtime was available. A portable official Windows x64
Node 22.23.3 archive was downloaded from
`https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip` into this task's
`tools-node22` directory. Its SHA256
`2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71`
matched the official release's `SHASUMS256.txt`; the extracted `node.exe`
had a valid OpenJS Foundation Authenticode signature. Bundled npm is 10.9.9.
Global Node 24.14.1 and the user's PATH/defaults were left unchanged.

The optional static `toolchain.nodeVersion` field accepts a major or an exact
three-part version. Token declares 22 and Auth declares 24 according to their
pinned `.nvmrc` files. `plan` checks the selected tasks and dependencies;
`doctor` and `run` reject mismatches before executing scripts. `inspect` still
reads the manifest on a different runtime. These commands do not evaluate or
execute `.nvmrc`, install a runtime, or probe project code.

For npm/pnpm tasks, child PATH starts with the real directory of the current
CINA Node executable, so a portable Node 22 invocation cannot silently use
the global Node 24 inside native package scripts. Local package-manager `.bin`
resolution remains native. Explicit npm script argv may include a reviewed,
fixed `--` argument tail; pnpm retains its three-argument form, avoiding its
different passthrough semantics. CINA exposes no arbitrary user argument tail.
Implicit lifecycle hooks remain blocked.

Review found that the first script-name regex accepted a leading `-`.
Read-only inspection of npm's argument parser confirmed that a name such as
`--no-ignore-scripts` would be interpreted as an option rather than a script.
Manifest validation, the static schema and the execution boundary now reject
all script names starting with `-`, with npm/pnpm rejection contracts. No
malicious npm command or hook was executed to demonstrate the issue.

## Token and Auth evidence

Token is fixed at `de5b720c2e45f02ba62c29c45791f01e2569a782`
(`pilots/cinatoken-phase2`, branch `cina/tool-engines-phase2`). With the
existing frozen npm dependencies and official Node 22.23.3, native
`packages/tool-engines` commands `npm run typecheck` and `npm run test:unit`
passed. The same component's actual CINA `run check` and `run test` passed
with structured exit 0; all 44 tests passed with zero skips. No additional
dependency install, core generation/build or database/API smoke test ran.
The selected provider tests use mock fetch or local loopback fixtures.

Actual Token `plan test`, `run test` and `doctor` with global Node 24.14.1
returned the expected mismatch exits 2, 2 and 1 before project scripts ran.
The negative check helper initially expected a different error-message string;
its assertion was corrected to the observed `Expected Node 22, found 24`
message, without changing the CLI implementation or exit expectations.

Auth remains fixed at `bfa56df798ede6a40e9d5cea0ef1a1e9a3568f3f`
(`pilots/cinaauth-phase2`, branch `cina/auth-proxy-phase2`). Its already
installed pnpm 11.1.1 entry and Node 24.14.1 passed the focused CINA
`packages-auth-proxy` test again after the runtime-boundary change: 1 file,
5 in-memory tests, structured exit 0. Other Auth packages remain unrun.

## Shop scope

Shop is fixed at `8ad553ce6aea2dd3d2a5b8c6fa60df0fb5cc6815`
(`pilots/cinashop-phase3`, branch `cina/shop-local-phase3`). It has no root
`package.json`; Workers and each frontend retain separate npm lockfiles and
working directories. No Node version requirement was invented for Shop,
whose selected package metadata does not declare one. The actual local
verification runtime is Node 22.23.3 with bundled npm 10.9.9.

The reviewed slice selects `workers-ts` no-emit type checks, two pure unit
files (`request-body.test.ts`, `cart-price-display.test.ts`), and the
`view/kefu-ts` Vue/TypeScript/Vite build. The broad Workers test script includes
database fixture/migration suites and is not a declared aggregate test task.
The explicit unit configuration has no Worker runtime plugin, setup file or
global setup. Workers postinstall only patches dependency files locally but
was not needed for these pure tests and did not run. No production or local
database, Redis, business API, Wrangler runtime, migration or deployment ran.

The first Workers type-check attempt exceeded the verification helper's
120-second deadline while its second no-emit compiler was running. It had
completed the first unit compiler without a TypeScript error. This timeout
is saved as an unsuccessful attempt, not counted as a full type-check pass.
The scoped manifest uses a reviewed 300-second budget for the repeated task.

The unchanged native type-check command then passed in 116 seconds, completing
both unit and runtime-test TypeScript compilations without executing those
runtime tests. The two native unit files passed 5/5 and 22/22, zero skips.
Kefu's initial Vite/esbuild invocation was denied access to an ancestor
directory by the managed tool sandbox. The identical command, approved to
run with the current user's permissions, passed: Vue type checking, 102 Vite
modules and a local `dist` build in 9.2 seconds. The failed attempt is retained.

Actual CINA runs also passed the two Workers unit tasks and the single Kefu
build with structured exit 0, using the original reviewed scripts. The CINA
Workers type-check also passed with structured exit 0 in 121.6 seconds. Both
component plans contain only the selected tasks. The two scoped npm installs
were sequential, with `ci --ignore-scripts --no-audit --no-fund`; 115 Workers
and 112 Kefu packages were installed. Their lockfile hashes remained:

- Workers: `091c922f9585c31763e5e5116be0fd1b360c0668d2d4da799f497067c92ad11c`
- Kefu: `c9cc4ba915669131fdb9d2745a18365122be535bc35d838af7fd4490884b4fa1`

The complete owned Shop checkout, dependencies and isolated npm cache occupied
about 0.568 GiB. No user files or shared cache were removed.

## CINA verification

After the script-name fix and the focused Shop plan contract were included,
the complete suite passed 53/53 on Node 24.14.1 and 53/53 on portable Node
22.23.3, with no skips or todos. The first restricted Node 22 attempt before
the script-name follow-up passed 48/50 and failed only the two process-tree
termination contracts because Windows `taskkill` returned permission failure.
The same tests passed 50/50 with the approved current-user permissions; the
final 53/53 runs used that permission scope. Timeout/cancel implementation and
assertions were not weakened. Intermediate failures remain in the logs.

The first complete root `pnpm check` passed generation, types and formatting,
but failed the new Shop contract's array sort because root lint requires an
explicit comparator. The contract now compares the fixed filename arguments;
no rule was disabled. Its failure diagnostic and exit summary are recorded
from the tool output. A retry log-path assignment error overwrote the first combined
root output; the retry's complete output now has a separate final log. The
complete root gate is repeated. Final repository and package results are
recorded with the delivery evidence and validation logs.

## Acceptance limits

All seven projects remain identifiable and `configured-pending-validation`.
Scoped task evidence is not whole-project or runtime acceptance. Cinaclassics
still lacks the required PDF assets; its earlier offline Worker compilation
does not establish runtime acceptance. Other Shop frontends, full Worker tests,
Token core/proxy tasks, other Auth packages, Seek and Chain remain unrun.
The full CF/Wrangler suites and remote Linux/Windows CI matrix remain unrun.
