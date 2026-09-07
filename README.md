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

**公共框架、Token/Chain/Shop/Seek 首批命令及 Auth 元数据检查已实现，版本 `0.1.0-alpha.4`；尚未发布 npm 包。**

当前支持离线 help/schema、context/config、doctor，Token/Shop/Seek 登录及只读命令、Shop 显式会话刷新、Chain 查询和 Auth 服务元数据检查。Chain 公开测试网 RPC 与 Auth 实际 discovery 验证通过；Token/Shop 的真实认证联调待测试配置和凭据。Seek 已通过本地完整 RPC 测试，当前线上入口受 Cloudflare Access 保护，该终端认证模式尚未接入。Auth 浏览器 OAuth 继续实施。

目标是统一命令、环境配置、凭据管理与输出契约。首版按各产品现有认证方式接入；跨产品单点登录按服务端接入进度推进。

## 设计文档

- [总体架构与认证方案](docs/architecture.md)
- [首版命令及输出契约](docs/command-contract.md)
- [产品接口映射与待补能力](docs/product-integration.md)
- [实施顺序与验收条件](docs/roadmap.md)
- [Token 与 Chain 使用说明](docs/token-chain.md)
- [Auth 与 Shop 使用说明](docs/auth-shop.md)
- [Seek 使用说明与登录限制](docs/seek.md)
- [验证记录](docs/validation.md)

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
node dist/bin.js config set chain.endpoint https://rpc-proxy.cinachain.com
node dist/bin.js context show --json
node dist/bin.js chain status --json
node dist/bin.js chain balance --address 0x0000000000000000000000000000000000000000 --json
```

doctor 默认只检查本地状态；`--network` 额外进行 TCP/TLS 连通性检查，不发送 HTTP 业务请求或凭据。它报告各产品适配器的实现状态，连通不等于已授权或业务接口可用。

配置目录可以用绝对路径 `CINA_CONFIG_DIR` 覆盖。`--context` 优先于 `CINA_CONTEXT`，再优先于已保存环境。配置字段见 `cina schema config.set --json`；配置文件不接受秘密字段。

Token 先设置 `token.endpoint`，然后通过环境变量 `CINA_TOKEN_GATEWAY_KEY` / `CINA_TOKEN_MANAGEMENT_KEY` 分别提供密钥，即可调用：

```sh
node dist/bin.js token models list --json
node dist/bin.js token account show --json
node dist/bin.js token workspaces list --offset 0 --limit 20 --json
```

`login --product token --credential gateway` 验证对应环境变量后将密钥保存到系统凭据库；Management 使用 `--credential management`。显式 `--token-stdin` 接受管道输入，密钥不作为命令行参数。使用 `--no-store` 只验证、不持久保存。退出命令及凭据覆盖规则见[使用说明](docs/token-chain.md)。

## 验证与本地安装包

```sh
pnpm check
pnpm test:package
pnpm test:keyring
```

`pnpm check` 运行类型检查、构建和契约测试。`test:package` 在临时目录离线安装实际打包产物并执行 `cina`，产物保留在 `artifacts/`。`test:keyring` 使用一次性合成凭据验证系统凭据库并删除测试记录；Linux 需要可用且已解锁的 Secret Service。

`.github/workflows/ci.yml` 在 Windows、macOS、Linux 运行相同验证。系统凭据库不可用时明确报错，支持显式环境变量覆盖，不会回退保存明文凭据。当前支持 Token key 导入、Shop 登录/刷新和 Seek gatekeeper 登录/会话导入；Auth OAuth 登录和刷新尚未实现。

Seek 在已配置且支持 gatekeeper 的部署中可运行：

```sh
node dist/bin.js seek status --json
node dist/bin.js login --product seek --vendor <vendor-id>
node dist/bin.js seek whoami --json
node dist/bin.js seek workspaces list --json
```

浏览器登录需要交互终端；JSON、`--no-input` 或无 TTY 环境可以使用显式 session 输入。登录默认超时 180 秒，其余命令 30 秒。

设计文档中的命令范围大于当前实现；以离线 `cina schema` 的实际输出为准。

## 后续产品体验

以下命令仅为设计示例，尚未实现：

```text
cina context use staging
cina login
cina whoami --json

cina auth users list --json
```

首版以业务只读操作为主。登录、刷新令牌、退出登录和修改本地配置会改变认证或本地状态，其行为单独声明。用户管理、订单写入、模型生成、Agent 执行和链上签名列入后续阶段。

下一步推进 Auth 浏览器登录及真实服务认证验收，见[路线图](docs/roadmap.md)。
