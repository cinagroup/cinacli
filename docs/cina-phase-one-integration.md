# Cina CLI: main integration follow-up

The 2026-10-01 continuation restored the frozen pnpm 12 installation and passed
the exact root check (7/7). See [engineering validation](cina-engineering-validation.md)
for the current runner changes, Token/Auth scope and complete result matrix. The
capacity and installation failure below describe the earlier 2026-09-30 attempt.

The integration base is `f642dc6831902f4c9410d86cffd416279ca1b2e0`, confirmed
with `git ls-remote` on 2026-09-30. The isolated checkout remains
`cinacli-phase1`; branch `cina/phase-one-main-integration` starts directly at
that base. Reviewed local changes were applied without rebasing or fetching a
second checkout. No remote mutation, publish, deploy, login, credential
configuration, business API request, or contract transaction was performed.

The original `cina/phase-one-local` branch retains two recovery commits:

- `d62e196d6e8fa1a80ab7312307f55ca31c355959`: independent Cina first slice.
- `b183f53131646e9599542e7937f564fa5d82c8c9`: cf native file-URL path repair.

Original patches, package archive, and validation evidence remain available
outside the checkout in the task's `artifacts` and `validation` directories.

## Integration changes

- Preserve main's `packageManager: pnpm@12.6.0`, both lockfile YAML documents,
  all workspace patches, supply-chain settings, and existing merge queue.
  Add only the dependency-free Cina importer to the second lock document.
- Retain the isolated Cina build/type tasks and three root convenience
  scripts. Add `merge_group/checks_requested/main` to Cina CI as well.
- Apply the cf path repair on top of the newer generator, retaining the new
  OpenAPI pin and workers-secret positional compatibility behavior.
- Replace six files' parameter/return JSDoc tags with function `@type`
  signatures to comply with root AGENTS. Executable code and function
  declarations remain unchanged; strict checkJs is preserved.

## 2026-09-30 integration validation (historical)

| Scope                                            | Outcome                                 |
| ------------------------------------------------ | --------------------------------------- |
| Cina strict tsgo                                 | Pass, exit 0                            |
| Cina type-aware oxlint                           | Pass, exit 0                            |
| Cina source/bin/scripts/tests oxfmt              | Pass, exit 0                            |
| Cina Node contract suite                         | Pass, 34/34, zero skips                 |
| Independent build and offline npm pack           | Pass, 14 archive entries                |
| Extracted bin help/version/inspect               | Pass, all exit 0; seven projects        |
| pnpm 12.6.0 local native tool                    | Installed, exact version confirmed      |
| pnpm 12 frozen offline install of root/cf/cina   | Fail, missing offline registry metadata |
| New-base exact root check and cf/Wrangler suites | Not run; frozen installation blocked    |

The type/lint/source-format checks passed before the attempted frozen install.
The install reported that the lockfile was up to date, but its supply-chain
metadata verification lacked `@babel/helper-string-parser` in the new cache
and exited 1 with `ERR_PNPM_NO_OFFLINE_META`. It refreshed this task's existing
node_modules links before failing, so current old-workspace dependencies are
not ready for more checks. No vendor contents or dependency graph were
manually copied into place to bypass the installer. An audit found those
links missing, rather than establishing a usable matching vendor installation.

The missing cache requires a bounded online frozen installation later. A
conservative additional metadata/dependency estimate is 96-192 MiB, plus
working room for generation and builds. Free space was about 336 MiB at the
decision point. Installation used a 256 MiB stop line; no online retry or
unrelated full installation followed. The user has been asked to free at
least 1 GiB before dependency installation and the new-base root gate resume.
No user files or shared caches were deleted.

Logs are `validation/integration-cina-*.log`,
`validation/integration-frozen-filter-install.log`, and
`validation/pnpm12-tool-install.log`. Initial-baseline root/legacy test results
in the earlier report are historical evidence and do not prove the newer
base's gate or dependency compatibility. Node 22/Linux CI remains unrun.

## Cinaclassics local build evidence

Checkout remains `6c5d4a9184f866872bf47fdb60cdcc7c81fd33c1` with its own npm
lockfile and Tools source. Native typecheck already passed in the initial
slice. This follow-up also compiled `Tools/src/index.ts` offline using the
existing esbuild 0.28.1 native binary, exactly matching Wrangler's locked
compiler version. The binary came from the other pilot's existing install;
there was no new install, Wrangler CLI invocation, repository script
execution, plugin, or deployment fallback.

The argv-driven ESM bundle, `node --check`, and TypeScript AST audit each
exited 0. The output is 2,294,397 bytes; its metafile contains 186 inputs and
no external imports. AST inspection found no Node imports, external require
calls, or dynamic imports. An initial text heuristic matched two error
message strings; the final AST audit identified them as false positives.
Evidence is in `validation/classics-worker-bundle`, including exact argv,
compiler/version, result, metafile, and audit. This proves static compilation,
not Worker execution, Cloudflare runtime compatibility, R2, or deployment.

PDF processing remains blocked. Required fonts, canvas/configuration, book
texts, and database assets are absent from the sparse checkout; tsx's own
esbuild 0.28.2 native binary is absent too. `scripts/repo.ts` can search
ancestors, and FsAssetSource does not enforce realpath containment of each
asset. Before registering or executing PDF generation, provide an explicit
asset root and reviewed minimal fixture with contained inputs and output,
then validate the boundaries. No PDF assets were downloaded or read through
an ancestor fallback. Worker build success is not PDF success.

## Remaining acceptance

Seven projects are statically recognized. Cinagroup's original exact checkout
retains passed quality gates and 758-page build evidence; Cinaclassics now
has typecheck and offline Worker compilation evidence. Its PDF pipeline and
the other five projects remain pending native verification. New Cinagroup
preview background does not change the tested checkout or expand auth,
import, migration, or production scope.

After capacity is available, restore dependencies through pnpm 12's frozen
installer without bypassing supply-chain checks; run the exact root gate,
native generation and matching-version compiled Wrangler tests. Then resolve
Cinaclassics asset containment and verify the remaining projects under their
own locks. Publication and deployment remain separate reviewed work.
