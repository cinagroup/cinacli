# Cina CLI

Cina 产品统一命令行入口，面向开发者、运营人员、脚本和 AI Agent。

| 项目 | 名称 |
| --- | --- |
| 产品 | Cina CLI |
| 仓库 | [cinagroup/cinacli](https://github.com/cinagroup/cinacli) |
| npm 包名（拟用） | `@cinagroup/cli` |
| 终端命令（拟用） | `cina` |
| 产品模块 | `auth`、`token`、`shop`、`seek`、`chain` |

## 当前状态

**设计阶段。当前只有设计文档，尚无可执行 CLI，未发布 npm 包。**

2026-09-07 核查了五个产品的本地源码，并整理首版方案。源码具备接入基础；各产品的实际部署、CLI 客户端注册与联合运行尚未验证。

目标是统一命令、环境配置、凭据管理与输出契约。首版按各产品现有认证方式接入；跨产品单点登录按服务端接入进度推进。

## 设计文档

- [总体架构与认证方案](docs/architecture.md)
- [首版命令及输出契约](docs/command-contract.md)
- [产品接口映射与待补能力](docs/product-integration.md)
- [实施顺序与验收条件](docs/roadmap.md)

## 拟定体验

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

下一步实施入口见[路线图 M0](docs/roadmap.md#m0公共框架)。
