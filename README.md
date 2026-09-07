# Cina CLI

Cina 产品统一命令行入口，面向开发者、运营人员、脚本和 AI Agent。

| 项目 | 名称 |
| --- | --- |
| 产品 | Cina CLI |
| 仓库 | [cinagroup/cinacli](https://github.com/cinagroup/cinacli) |
| npm 包名 | `@cinagroup/cli` |
| 终端命令 | `cina` |
| 规划中的产品模块 | `auth`、`token`、`shop`、`seek`、`chain` |

## 当前状态

**M0 公共框架已实现，版本 `0.1.0-alpha.1`；尚未发布 npm 包。**

当前可运行离线帮助、命令 schema、context/config 和 doctor。产品业务命令与登录尚未接入，不出现在可执行 schema 中。五产品实际部署、CLI 客户端注册与联合运行尚未验证。

目标是统一命令、环境配置、凭据管理与输出契约。首版按各产品现有认证方式接入；跨产品单点登录按服务端接入进度推进。

## 设计文档

- [总体架构与认证方案](docs/architecture.md)
- [首版命令及输出契约](docs/command-contract.md)
- [产品接口映射与待补能力](docs/product-integration.md)
- [实施顺序与验收条件](docs/roadmap.md)

## 本地运行

使用 Node.js 24.14.1 或更高的 24.x 版本，以及 pnpm 11.19.0。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/bin.js --help
node dist/bin.js schema --json
```

创建环境后显式选择，并设置允许的非敏感字段：

```sh
node dist/bin.js context create staging
node dist/bin.js context use staging
node dist/bin.js config set chain.chainId 84532
node dist/bin.js config set chain.endpoint https://sepolia.base.org
node dist/bin.js context show --json
node dist/bin.js doctor --product chain --json
```

doctor 默认只检查本地状态；`--network` 额外进行 TCP/TLS 连通性检查，不发送 HTTP 业务请求或凭据。M0 会明确报告产品适配器尚未实现，连通不等于已授权或业务接口可用。

配置目录可以用绝对路径 `CINA_CONFIG_DIR` 覆盖。`--context` 优先于 `CINA_CONTEXT`，再优先于已保存环境。配置字段见 `cina schema config.set --json`；配置文件不接受秘密字段。环境变量凭据支持在核心适配接口中实现，尚无可使用它们的产品业务命令。

## 验证与本地安装包

```sh
pnpm check
pnpm test:package
pnpm test:keyring
```

`pnpm check` 运行类型检查、构建和契约测试。`test:package` 在临时目录离线安装实际打包产物并执行 `cina`，产物保留在 `artifacts/`。`test:keyring` 使用一次性合成凭据验证系统凭据库并删除测试记录；Linux 需要可用且已解锁的 Secret Service。

`.github/workflows/ci.yml` 在 Windows、macOS、Linux 运行相同验证。系统凭据库不可用时，核心层明确报错，支持显式环境变量覆盖，不会回退保存明文凭据。当前不提供 OAuth 刷新或产品登录，刷新协调将在接入相应认证流程时实现。

设计文档中的命令范围大于当前实现；以离线 `cina schema` 的实际输出为准。

## 后续产品体验

以下命令仅为设计示例，尚未实现：

```text
cina context use staging
cina login
cina whoami --json

cina token models list --json
cina shop orders list --page 1 --limit 20 --json
cina seek workspaces list --json
cina chain status --json

cina schema shop.orders.list --json
```

首版以业务只读操作为主。登录、刷新令牌、退出登录和修改本地配置会改变认证或本地状态，其行为单独声明。用户管理、订单写入、模型生成、Agent 执行和链上签名列入后续阶段。

下一步接入 Token 与 Chain，见[路线图 M1](docs/roadmap.md#m1token-与-chain-最小闭环)。
