# CinaCLI 第一阶段：七项目组件与任务覆盖矩阵

本报告按实际任务证据记录覆盖范围。七项目都能被集中清单识别，并各自已有至少一个组件的限定原生与 CINA 任务成功证据；这些结果不表示各项目的所有组件、构建或运行验收完成。最终 CLI 门禁由主仓集成另行汇总；本矩阵只记录有实际日志的项目任务。

主仓为 `cinacli-phase1`，分支 `cina/phase-one-main-integration`；本轮开始本地基线为 `02829f238d3541ea12d346d125f27dd2b1e829de`，集成 main 基线为 `f642dc6831902f4c9410d86cffd416279ca1b2e0`。最终交付 HEAD 由审阅包记录，不在本文件预先自引用。本报告没有修改项目源码、锁文件、运行时默认设置、凭据或生产状态。

历史说明见 [初始切片](cina-phase-one.md)、[main 集成](cina-phase-one-integration.md)、[Token/Auth 验证](cina-engineering-validation.md) 和 [Node/Shop 验证](cina-node-shop-validation.md)。历史文档的待验证、旧运行时和旧测试数量属于各自记录时间；下面明确列出后来补充的任务证据。

## 状态与证据规则

| 状态               | 含义                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| 原生通过           | 在指定 checkout、cwd、运行时下，原有命令实际执行成功。                 |
| CINA 通过          | CINA `run` 实际启动指定任务，结构化结果为 `success` / `exitCode: 0`。  |
| 历史报告记录       | 既有报告记载执行成功；原始日志未定位，不能当作本轮复跑。               |
| 静态已配置，未运行 | manifest 有明确任务，尚无对应原生/CINA run 成功证据。                  |
| 阻塞               | 缺少资产、工具或存在未审阅生命周期效果等条件；明确列出原因。           |
| 不适用 / 未声明    | 组件没有对应脚本或未注册能力；不换成其他命令。                         |
| 明确排除           | 发布、部署、凭据设置、业务 API、数据库迁移、链上交易等不在本地切片中。 |

`inspect` 识别、schema 验证、`doctor` 就绪、`plan` 成功均是静态证据，不能替代原生 check/test/build 成功。所有 preset 保留 `verification: configured-pending-validation`：这是清单的数据状态，不抹去已经完成的任务证据，也不宣称整个项目完成。

证据路径以 task 根为基准，位于主仓外的 `validation`、`pilot-logs` 和 `artifacts`。命令表中的 `npm run` / `pnpm run` 是日志所载原有脚本；helper/CINA 使用所选 Node 与已安装包管理器入口的 argv，未拼接 shell。下面 CINA 命令省略重复入口前缀 `node packages/cina-cli/src/dev.mjs`，`<pilot>` 对应下表 checkout；所有实际 `run` 均带 `--allow-local-write`。

## 固定源码与项目摘要

七个 pilot 的完整 HEAD 均已通过只读 Git 核对，和各自 catalog 固定 commit 一致。数量只计 catalog 注册范围，不表示全仓全部工程均已建模。

| 项目         | 完整固定 commit                            | checkout / 分支                                               | 已证实范围和剩余边界                                                                                                         |
| ------------ | ------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| cinagroup    | `79b14e23f4af694b7d222c98a63d1d09f7dc397c` | `pilots/cinagroup` / `main`                                   | 1 组件、7 任务；历史网站质量/门禁/Functions/758 页构建原生通过，本轮 CINA 两项测试 25/25 通过。                              |
| cinaclassics | `6c5d4a9184f866872bf47fdb60cdcc7c81fd33c1` | `pilots/cinaclassics-sparse` / `master`                       | 1 组件、1 任务；Tools 类型原生/CINA 通过，另有离线 Worker 编译通过；PDF/资产与 Worker 运行验收阻塞。                         |
| cinatoken    | `de5b720c2e45f02ba62c29c45791f01e2569a782` | `pilots/cinatoken-phase2` / `cina/tool-engines-phase2`        | 6 组件、12 任务；tool-engines 类型和 44 项测试在 Node 22 原生/CINA 通过；其他组件未完成，core/proxy hooks 阻塞。             |
| cinaauth     | `bfa56df798ede6a40e9d5cea0ef1a1e9a3568f3f` | `pilots/cinaauth-phase2` / `cina/auth-proxy-phase2`           | 39 组件、3 任务；auth-proxy 1 文件/5 项内存测试原生/CINA 通过；root checks 和其余包未运行。                                  |
| cinashop     | `8ad553ce6aea2dd3d2a5b8c6fa60df0fb5cc6815` | `pilots/cinashop-phase3` / `cina/shop-local-phase3`           | 6 组件、13 任务；Workers no-emit 类型、2 文件共 27 项纯单测、Kefu 本地构建原生/CINA 通过；其他前端与 Worker 运行验收未覆盖。 |
| cinaseek     | `5fd9e816c5a11965c1fd11a363e593cb1a5f7f86` | `pilots/cinaseek-phase4` / `codex/cinaseek-phase4-validation` | 33 组件、6 任务；error-reporting noEmit 类型与 23 项纯单测在 CI 对齐 Node 24.19 原生/CINA 通过；其余组件未验收。             |
| cinachain    | `78b8a13af28f4eb21134e58194a641f5bf392e59` | `pilots/cinachain-phase4` / `cina/chain-portal-phase4`        | 11 组件、12 任务；portal 类型与本地构建原生/CINA 通过，root DApp/contracts/docs-site/六 Worker 未验收。                      |

## cinagroup：根网站、内容门禁与 Functions

历史原生运行时为 Windows / Node `24.14.1`、npm `11.11.0`，cwd `pilots/cinagroup`。本轮 CINA 小任务在官方 portable Node `22.23.3` 调用当前 runner；没有补跑网站 build 或安装依赖。原 `package-lock.json` 保持不变。

| catalog 任务 / 补充门禁      | 原生命令与结果                                                                                                                                          | CINA run 覆盖                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `website/quality`            | 历史 `npm run check` 通过：Astro 213 文件、0 errors/warnings/hints，ESLint/Prettier 通过；CRLF 失败及 LF 恢复后复跑保留。                               | 静态已配置；尚无对应 CINA `run check` 完成日志。                                                               |
| `website/source-gates`       | 历史 `npm run audit:source` 通过：blog/content/fact-checks/evidence source-only 与 i18n。                                                               | 静态已配置，未有该任务 CINA run 完成证据。                                                                     |
| `website/functions`          | 历史 `npm run check:cloudflare` 通过：Wrangler types `--check`、Functions `tsc --noEmit` 和本地 Functions 编译。                                        | 静态已配置，未有该任务 CINA run 完成证据。                                                                     |
| `website/build`              | 历史 `npm run build` 通过：758 页、125.16 秒、本地 dist。                                                                                               | 静态已配置，未有该任务 CINA run 完成证据。                                                                     |
| `website/build-gates`        | 历史 `npm run audit:build` 通过：758 HTML、406 archives、33,909 内部链接、2 CSS。                                                                       | 依赖 `website/build`；未有该任务 CINA run 完成证据。                                                           |
| `website/contact`            | 历史报告记录 `npm run test:contact` 16 项通过；单独原生 stdout 尚未在 pilot-logs 定位。                                                                 | 本轮 `run test --project cinagroup --repo <pilot> --allow-local-write` 实际完成该任务，success/exit 0，16/16。 |
| `website/blog-i18n`          | 历史报告记录 `npm run test:blog-i18n` 9 项通过；单独原生 stdout 尚未在 pilot-logs 定位。                                                                | 同一实际 `run test` 完成该任务，success/exit 0，9/9；两项共 25/25、无 skips。                                  |
| 构建后 evidence/content/blog | 历史 `npm run audit:evidence`、`audit:content`、`audit:blog` 原生通过：758 HTML、186 publishable source files、352 fact-check records、810 sources 等。 | 不是三个独立注册 CINA 任务；原生结果不扩大 CLI 注册范围。                                                      |

原始 native 证据：[quality](../../pilot-logs/cinagroup-check-lf.log)、[source gates](../../pilot-logs/cinagroup-audit-source.log)、[Functions](../../pilot-logs/cinagroup-check-cloudflare-retry.log)、[build](../../pilot-logs/cinagroup-build-retry.log)、[build gates](../../pilot-logs/cinagroup-audit-build.log)、[evidence](../../pilot-logs/cinagroup-audit-evidence.log)、[content](../../pilot-logs/cinagroup-audit-content.log)、[blog](../../pilot-logs/cinagroup-audit-blog.log)。本轮实际 CINA stdout/stderr 和结构化结果见 [final Group run](../../validation/20261001-final-group-cina.log)。历史 CINA 原始日志缺口不阻碍这两项本轮实跑证据，但不能扩写为 CINA build/check 成功。

这里只证实所列本地工程任务。浏览器验收、真实 contact/外部服务、生产 Functions 请求与远端 CI 未运行。生产发布继续只走原有 GitHub Actions；manual workflow 只校验，本地未声明或触发 deploy。

## cinaclassics：Tools 类型与离线 Worker 编译，PDF 仍阻塞

cwd `pilots/cinaclassics-sparse/Tools`，保留 Tools package-lock。首次安装容量失败；之后 `npm ci --ignore-scripts --omit=optional --no-audit --no-fund` 成功安装 56 包。缺失 optional/资产不由 typecheck 通过掩盖。本轮 CINA types 用 Node `22.23.3`，没有安装或生成 PDF。

| 能力                  | 实际命令 / 证据                                                                                                                                                                   | 覆盖判断                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/types`         | 历史原生 `npm run typecheck`（`tsc --noEmit`）通过。本轮 `run check --project cinaclassics --repo <pilot> --allow-local-write` 实际完成 `tools/types`，success/exit 0，4,846 ms。 | 原生历史通过、本轮 CINA 通过；doctor ready 单独只表示静态就绪。                                                                                                         |
| Worker 静态编译       | esbuild `0.28.1` 对 src/index.ts 执行 bundle/tree-shaking/browser/esm/es2022/conditions=workerd,worker,browser/external:node:\*，outfile/metafile 位于 task 验证目录。            | compilerExit 0、node --check syntaxExit 0；186 输入文件；最终 TypeScript AST `validationPassed: true`。是额外离线编译，不是 npm build，不是 CINA run，也未执行 Worker。 |
| PDF / 本地制品        | 原有 `npm run local`（`tsx scripts/generate-local.ts`）未执行、未注册。                                                                                                           | 阻塞：当前根和 Tools 下均无 fonts/canvas/books/books_mr/db/.r2build；脚本祖先资产搜索与输入/输出 containment fixture 尚待审阅。                                         |
| package build / tests | Tools package.json 没有 build/test 脚本。                                                                                                                                         | 不适用；不能杜撰 npm build，也不以 deploy/R2 push 替代。                                                                                                                |
| Worker dev / API / R2 | wrangler dev/deploy、r2:push:local、r2:push 均未运行。                                                                                                                            | Worker/PDF 运行验收未覆盖；发布与部署明确排除。                                                                                                                         |

[native typecheck](../../pilot-logs/cinaclassics-typecheck.log)、[当前 CINA run](../../validation/20261001-final-classics-cina.log)、[离线 Worker command](../../artifacts/integration/20261001/review-package/validation/classics-worker/command.json)、[离线 Worker result](../../artifacts/integration/20261001/review-package/validation/classics-worker/result.json)。离线编译使用已有 Group 安装中的匹配 esbuild 可执行文件；未运行 Wrangler CLI。初始文本扫描误报仍在 result，最终判断为 AST 静态分析，不能描述为 Worker runtime pass。

没有伪造 books/fonts/db，未产 PDF，也未证明 PDF 内容或 Worker/R2 运行可用。Group/Classics 本轮前后锁 SHA256 均不变，见 [before](../../validation/20261001-final-group-classics-lock-before.json)、[after](../../validation/20261001-final-group-classics-lock-after.json)。

## cinatoken：仅完成 tool-engines 两项任务

当前成功证据使用 Windows / 官方 portable Node `22.23.3`，cwd `pilots/cinatoken-phase2/packages/tool-engines`。以前 Node 24 成功保留为历史；Node 22 已复验该组件，不推广全仓。原 npm workspace/package-lock 未迁移；安装跳过 root postinstall/gen:wrangler。

| 组件 / 任务                                                   | 原生命令与结果                                              | CINA 执行 / 未覆盖                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tool-engines/check-types`                                    | `npm run typecheck`：tsc -p tsconfig.json --noEmit，通过。  | `run check --project cinatoken --repo <pilot> --component tool-engines --allow-local-write`：该单任务 success/exit 0。     |
| `tool-engines/test-unit`                                      | `npm run test:unit`：4 文件、44/44、0 skip，通过。          | 同 scope 的 `run test`：该单任务 success/exit 0，44/44。provider 用 mock fetch 或本地 loopback，没有 vendor business API。 |
| `workspace/check-versions`、`workspace/test-deploy-contracts` | npm run verify:package-versions / test:deploy 未运行。      | 静态已配置未跑；test:deploy 是本地测试声明，不据名字声称部署或通过。                                                       |
| `core/build`                                                  | npm run build 未运行；调用 build:migrate/build:node-index。 | 阻塞：prebuild 删除 dist，隐式 lifecycle effects 未建模；不放开 hook 策略。                                                |
| `proxy/check-types`、`proxy/build`                            | npm run typecheck / build 未运行。                          | 依赖 core/build；proxy build 自身也有删除 dist 的 prebuild；类型和 Node bundle 未验收。                                    |
| `admin/check-lint`、`admin/check-types`、`admin/build-docker` | npm run lint / typecheck / build:docker 未运行。            | lint 已配置未跑；types/build 依赖 core。build-docker 是既有本地 Next standalone build，不是 Docker image 发布。            |
| `chain-worker/check-types`、`chain-worker/test-unit`          | npm run typecheck / test:unit 未运行。                      | types 依赖 core；unit suite 已配置未跑；不由 tool-engines 外推 Worker/链上验收。                                           |

[Node 22 native check](../../validation/20261001-token-node22-native-check.log)、[native tests](../../validation/20261001-token-node22-native-test.log)、[最终 CINA check](../../validation/20261001-node-shop-token-final-check.log)、[最终 CINA tests](../../validation/20261001-node-shop-token-final-test.log)、[完整 argv/result](../../validation/20261001-node-shop-token-auth-final-result.json)。

实际 Node 24 plan test / run test / doctor 分别 exit 2 / 2 / 1，在脚本启动前拒绝 Node 22 不符；[负向边界](../../validation/20261001-token-node24-reject.json)不是质量任务失败或通过。首次 Windows npm shim 不识别在 task 启动前失败，静态解析修复后上述任务实跑成功。Workers、Node/Docker 双 runtime、数据库 provisioning/migration、远端 smoke、chain preflight、其余 workspace 测试与部署仍未覆盖或明确排除。

## cinaauth：auth-proxy 内存单测，其他 38 组件未验收

Windows / Node `24.14.1`、已安装 pnpm `11.1.1`，cwd `pilots/cinaauth-phase2/packages/auth-proxy`。filtered frozen 安装包含 root 开发 importer（564 包），不是仅两依赖。原锁 SHA256 保持 `01174f8479e77c6d217b82f99c738ba786a287dc7f5bff9b3b1948236820b60e`。

| 组件 / 任务                                                   | 原生执行                                                                                                          | CINA 执行 / 剩余覆盖                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages-auth-proxy/test-unit`                               | pnpm run test（vitest run），1 文件、5/5、exit 0；内存 Request/Response/Headers，不访问远端、DB、Worker runtime。 | run test --project cinaauth --repo <pilot> --component packages-auth-proxy --allow-local-write：success/exit 0；最后 runtime 边界修改后再次实跑。 |
| `workspace/check-lint`                                        | pnpm run lint 未运行。                                                                                            | 静态已配置未跑；biome check . --error-on-warnings，不用一个包 tests 代替。                                                                        |
| `workspace/check-types`                                       | pnpm run typecheck 未运行。                                                                                       | tsc --build --force 和 26 个 cache 目录已审阅声明，未证明全仓 types 通过。                                                                        |
| apps/docs/e2e/test/其余 packages                              | 未运行这些组件的原生任务。                                                                                        | 静态识别，未注册新的 build/test；不能计为不适用或完成。                                                                                           |
| workers-auth-api / workers-delivery / workers-privacy-erasure | 未运行 Worker check/build/dev/API。                                                                               | 三组件已识别；运行验收未覆盖，deploy/secret/resource config 排除。                                                                                |

39 个组件包括 workspace；apps 的 account-portal/admin-console/oidc-client-demo；docs；e2e 的 adapter/integration/smoke；test；三个 Workers；packages 的 agent-auth/api-key/auth-proxy/auth-web-contract/cimd/cinaauth/cli/core/design-tokens/drizzle-adapter/electron/expo/i18n/kysely-adapter/mcp/memory-adapter/mongo-adapter/oauth-provider/passkey/prisma-adapter/redis-storage/release-tooling/scim/sso/stripe/telemetry/test-utils。只有 auth-proxy 具有这里的原生 tests 通过证据。

[native argv](../../validation/20261001-auth-native.command.json)、[native stdout](../../validation/20261001-auth-native.stdout.log)、[native exit](../../validation/20261001-auth-native.result.json)、[最终 CINA argv](../../validation/20261001-node-shop-auth-final-cina-run.command.json)、[最终 CINA stdout](../../validation/20261001-node-shop-auth-final-cina-run.stdout.log)、[最终 CINA exit](../../validation/20261001-node-shop-auth-final-cina-run.result.json)。

两次早期 CINA 尝试选中不完整 native pnpm loader，缺 sibling JS payload，未启动 tests；后来静态拒绝并选择完整已安装 JS 入口后成功。失败日志保留。root pnpm test 受仓库指令禁止，docs Typesense postbuild 和会 git clean 的 consumer typecheck 排除；没有改造跨业务鉴权，agent scope 保持 identity.profile.read。

## cinashop：Workers 类型与两文件测试、Kefu 构建

Windows / portable Node `22.23.3`、bundled npm `10.9.9`。Shop 无根 package.json，所选包未声明 Node version，不编造版本约束。每个组件保留独立 package-lock；不统一工具链或重写缓存。

| 组件 / 任务                                                                             | cwd 与原生命令 / 结果                                                                                      | CINA 命令 / 结果                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `workers-ts/check-types`                                                                | workers-ts；npm run typecheck，exit 0，116 秒；unit/runtime-test TS 两编译 no-emit，未执行 runtime tests。 | run check --project cinashop --repo <pilot> --component workers-ts --allow-local-write：success/exit 0，121,559 ms。 |
| `workers-ts/test-request-body`                                                          | workers-ts；npm run test:unit -- test/request-body.test.ts，1 文件、5/5、exit 0。                          | workers-ts 的 run test 中该任务 success/exit 0，5/5。                                                                |
| `workers-ts/test-cart-price`                                                            | 同 cwd；npm run test:unit -- test/cart-price-display.test.ts，1 文件、22/22、exit 0。                      | 同 run test 中该任务 success/exit 0，22/22。                                                                         |
| `view-kefu-ts/build`                                                                    | view/kefu-ts；npm run build，vue-tsc noEmit + Vite 6.4.3，102 modules、本地 dist，exit 0。                 | run build --project cinashop --repo <pilot> --component view-kefu-ts --allow-local-write：该任务 success/exit 0。    |
| `view-kefu-ts/test`                                                                     | npm run test 未运行。                                                                                      | 已配置未跑；build 不证明 tests 通过。                                                                                |
| `view-admin-ts/build`                                                                   | view/admin-ts；npm run build 未运行。                                                                      | 已配置未跑。                                                                                                         |
| `view-pc-ts/build`                                                                      | view/pc-ts；npm run build 未运行，包含 test:auth/test:images。                                             | 已配置未跑；前置 tests 不计为通过。                                                                                  |
| `view-supplier-ts/build`                                                                | view/supplier-ts；npm run build 未运行。                                                                   | 已配置未跑。                                                                                                         |
| `view-uniapp-ts/check-types`、`test-toolchain`、`build-h5`、`build-weixin`、`build-app` | view/uniapp-ts；npm run typecheck / test:toolchain / build:h5 / build:mp-weixin / build:app 均未运行。     | 五项已配置未跑；不由 Kefu Vue/Vite 结果外推。                                                                        |

[native Workers check](../../validation/20261001-shop-workers-check.result.json)、[request-body](../../validation/20261001-shop-workers-request-body.stdout.log)、[cart-price](../../validation/20261001-shop-workers-cart-price.stdout.log)、[native Kefu build](../../validation/20261001-shop-kefu-build.result.json)、[CINA Workers check](../../validation/20261001-shop-cina-workers-run-check.stdout.log)、[CINA Workers tests](../../validation/20261001-shop-cina-workers-run-test.stdout.log)、[CINA Kefu build](../../validation/20261001-shop-cina-kefu-run-build.stdout.log)。各同名前缀 command/result/stderr 留存 argv、cwd、运行时、deadline 与进程结果。

Workers 初次 120 秒 deadline 超时 exit 124，不计通过；保持原命令，以审阅后 300 秒预算复跑完成。Kefu 初次因 sandbox 拒绝 esbuild 祖先目录访问 exit 1，同命令经当前用户权限批准后通过。失败证据在 20261001-shop-workers-check-120s-attempt._ 与 20261001-shop-kefu-build-sandbox-attempt._。

Workers broad tests 的数据库 fixture/migration、全量 unit suite 与 Worker runtime suite 未执行，本次仅两纯文件共 27 项。Workers postinstall 未执行。没有 DB、Redis、业务 API、Wrangler dev/deploy、浏览器或真实登录验收；两个成功组件不是整个 Shop 完成证明。

## cinaseek：error-reporting noEmit 类型与纯单测

checkout 与 catalog 固定 `5fd9e816c5a11965c1fd11a363e593cb1a5f7f86`。主要验收使用 Windows / 现有 Node `24.19.0`，对齐仓库 CI 固定 runtime；独立安装 pnpm `11.17.0` 的 registry integrity 匹配仓库 packageManager。此前 Node `22.23.3` 的同任务成功作为兼容证据，不冒充 CI runtime。保留原 pnpm-lock 与 Vite+ task/cache graph；filtered 两 importer 安装 192 包，通过既有 supply-chain 策略，未修改锁文件。

| 组件 / 任务                                           | 原生命令与结果                                                                                                                                        | CINA 命令 / 结果                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error-reporting/check-types`                         | cwd packages/error-reporting；pnpm run build（既有脚本 tsc），TypeScript 7.0.2、noEmit=true，exit 0。虽脚本名 build，实际仅类型检查，没有制品 build。 | run check --project cinaseek --repo <pilot> --component error-reporting --allow-local-write：success/exit 0，1,104 ms；运行原 tsc，不创建替代构建。 |
| `error-reporting/test-unit`                           | 同 cwd；pnpm run test:run（vitest run），Vitest 4.1.10、src/index.test.ts，1 文件、23/23、exit 0。                                                    | run test --project cinaseek --repo <pilot> --component error-reporting --allow-local-write：success/exit 0，1,536 ms，1 文件、23/23。               |
| workspace/check-lint、check-script-types、build、test | pnpm run lint:check / types:scripts / build / test 均未运行。                                                                                         | root 四任务只是静态声明，不以 scoped package 结果代替 aggregate Vite+ graph 验证。                                                                  |

其余 32 组件（包括 workspace）覆盖 Electron/mobile、backend-utils、configurator-ui、gatekeeper 系列、integration-tests、mcp-shared、router、typed-storage、workshop-backend/evals/frontend/shared、scripts，均无本轮原生任务完成证据，不能据 root 清单宣布全部 Worker/frontend 可构建。

[CI runtime native check](../../validation/20261001-seek-node24-native-check.result.json)、[native tests](../../validation/20261001-seek-node24-native-test.stdout.log)、[当前 CINA check](../../validation/20261001-seek-node24-cina-check.stdout.log)、[CINA test](../../validation/20261001-seek-node24-cina-test.stdout.log)、[CINA test 输出](../../validation/20261001-seek-node24-cina-test.stderr.log)、[doctor](../../validation/20261001-seek-node24-cina-doctor.stdout.log)、[plan check](../../validation/20261001-seek-node24-cina-plan-check.stdout.log)、[plan test](../../validation/20261001-seek-node24-cina-plan-test.stdout.log)。各同名前缀 command/result/stderr 保留 argv、cwd、runtime 和退出。此前 Node 22 native check/test 的 23 项通过单独在 20261001-seek-native-check/test.\*，不混写运行时。

正确的全 repo doctor exit 0、status ready、33 个静态 checks；两 scoped plan 各 exit 0、各只一个任务。doctor ready 不证明 33 组件依赖、native tasks 或 runtime 通过。初次 helper 给 doctor 误附 --component，CLI 返回 invalid/2，日志保留；这是调用参数错误，不是项目质量任务失败。首次安装 helper 监控 ENOENT/wrapper exit 1 也保留，续装成功；不改写失败记录。14 项源码/锁 hash 前后不变，见 [source before](../../validation/20261001-seek-source-before.json)、[source after](../../validation/20261001-seek-source-after.json)。

Worker 身份按 wrangler.jsonc 判断：17 gatekeeper 是 Worker，gatekeeper-kit/mcp-shared 是库。工程 orchestration 与 CapnWeb 业务 RPC/connector credentials/approval queue 分开；full lint/types:check 包含 build 和产物写入，不当只读。部署、R2/release 上传、provider eval、live billing audit 与业务 API 排除。

## cinachain：portal 两项通过，合约与其余组件未运行

checkout 与 catalog 固定 `78b8a13af28f4eb21134e58194a641f5bf392e59`。是 Base Sepolia Beta Web3 平台，不是 Cosmos 节点；根 Next DApp、portal、docs-site、Solidity、六个 Worker 分别建模。当前只运行 portal，Windows / portable Node `22.23.3`、bundled npm `10.9.9`；portal engines Node >=22.12.0，未声明 packageManager，未把 root npm 11.11.0 强套到 portal。

| 组件 / 当前注册任务                                                               | 静态证据 / 尚未验收                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dapp：check-lint/check-types/check-design-tokens/check-secret-contract/build/test | 静态已配置未跑；root npm 11.11.0、package-lock，.nvmrc Node 18 与 root engines Node >=22 冲突未改。                                                                                     |
| contracts-solc/build                                                              | npm run contracts:build 对应 scripts/compile-and-deploy.mjs；按实现核查仅 solc 编译、写 contracts/out，不因名字误判部署；本轮未运行。                                                   |
| contracts-foundry/test                                                            | forge test 已配置未跑；缺 compiler 时可能下载，effects 声明 network-read，不能混入只执行 local effects 的 runner。                                                                      |
| portal/check-types                                                                | cwd portal；原生 npm run typecheck（tsc --noEmit）exit 0。CINA run check --project cinachain --repo <pilot> --component portal --allow-local-write：success/exit 0，3,451 ms。          |
| portal/build                                                                      | cwd portal；原生 npm run build（tsc --noEmit && vite build）exit 0，Vite 7.3.6、1,840 modules、真实 dist 与 4 本地 fonts。对应 CINA run build：success/exit 0，8,795 ms，实际生成产物。 |
| portal/tests                                                                      | 原 package 无 test 脚本，不适用；不能把构建视为测试或运行验收。                                                                                                                         |
| docs-site/check-images、docs-site/build                                           | 独立 npm/lockfile；本轮未有 native/CINA 成功证据。                                                                                                                                      |
| auth-proxy/billing/media-gateway/paymaster/rpc-proxy/whitelist                    | 六 Worker 已识别，无注册执行任务；未证明 Worker 运行可用。                                                                                                                              |

portal 的 CINA plan check/build 各 exit 0，是静态结果；成功 run 另有完整结构化证据：[native typecheck](../../validation/20261001-chain-portal-check.result.json)、[native build](../../validation/20261001-chain-portal-build.result.json)、[build stdout](../../validation/20261001-chain-portal-build.stdout.log)、[CINA check](../../validation/20261001-chain-cina-portal-run-check.stdout.log)、[CINA build](../../validation/20261001-chain-cina-portal-run-build.stdout.log)、[详细报告](../../validation/20261001-chain-report.md)。各同名前缀 command/result/stderr 保留实际 argv 与 cwd。首个 build 因 sandbox 祖先路径访问失败，相同命令经当前用户权限批准后成功；失败仍在 20261001-chain-portal-build-sandbox-attempt.\*。portal 锁 SHA256 前后保持 `527966fb0e39aaf9268ddfeebf2cc6e65389efcc58066f6ae010d95075f75e1f`。

真正部署在独立 deploy-contracts.yml / contract-admin.yml 与相应部署脚本；portal 构建不证明钱包/RPC/API/链上运行或 DApp/合约可部署。私钥、RPC broadcast、链上交易、Worker deploy、生产变更排除。billing 的 ENABLE_BILLING_USAGE/ENABLE_KEY_REGISTRATION/ENABLE_CUSTODIAL/ENABLE_INGRESS/ENABLE_PUBLIC_LEDGER_READS/ENABLE_INDEXER 保持 false；paymaster 的 PAYMASTER_ENABLED=false、PAYMASTER_POLICY_MODE=disabled 不变。

## CLI 自身门禁与剩余证据

项目覆盖与 CLI 质量分开。既有 Node/Shop 最终结果为 Cina 53/53（Node 22/24 各一次、无 skips/todos）、root pnpm check 和 package check/build/pack 通过，[final gates](../../validation/20261001-node-shop-final-gates.json)。这不替代任一组件 native build/test，也不证明远端 Linux/Windows CI 或完整 CF/Wrangler suites。本轮 Seek/Chain 续作后的最终 CLI 数量、主仓 commit 与包装结果需集成再次记录，不能沿用 53 项当作新改动验证。

目前剩余的具体边界：

- Seek 仅 error-reporting 的类型/纯单测通过，未完成制品 build、全仓 graph 或其他组件验收；Chain 仅 portal 两项通过，其他组件继续待验。
- Group 的 CINA check/build 尚无实跑证据；新增两项 CINA 单测不改写历史网站 build 为本轮 build。
- Classics PDF/Worker 运行验收需真实完整资产与受限输入/输出 fixture，离线编译只是静态产物检查。
- Token 其他任务与 lifecycle effects、Auth 其他包、Shop 其他前端与 broad Worker tests 仍待各自小批次。

不通过降低 checks、调用 autoconfig、运行发布脚本、制造资产、配置凭据或触发远端流程填补这些边界。
