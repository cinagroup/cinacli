# 首版命令及输出契约

状态：命令契约；更新日期：2026-09-07。**公共框架及五产品首批命令已实现；真实认证联合验收待完成。** 登录/退出默认 Auth，支持显式 `--product auth|token|shop|seek`。各阶段对应[路线图](roadmap.md)中的里程碑。

## 1. 命令范围

### 公共命令

| 命令 | 用途 | 阶段 |
| --- | --- | --- |
| `cina --help` / `cina --version` | 离线帮助与版本 | M0 |
| `cina schema [command-id]` | 离线查看命令、参数、认证和返回结构 | M0 |
| `cina context list` / `show` / `use <name>` | 列出、查看和选择已存在的 context | M0 |
| `cina context create <name>` | 创建空 context，显式配置服务端点 | M0 |
| `cina config show` / `set <key> <value>` | 查看或修改非敏感配置 | M0 |
| `cina doctor [--product <product>]` | 检查配置、凭据库及受限的网络连通性 | M0 |
| `cina login [--product <product>]` | 默认 CinaAuth；指定产品走对应流程 | M1/M2 |
| `cina logout [--product <product>]` | 显式指定产品；Token 可选择 credential 或清除当前两类 key | M1/M2 |
| `cina whoami` | 调用 CinaAuth userinfo 验证当前核心身份 | M2 |

`context use` 对不存在的 context 报错；`config set` 校验允许的字段和 URL，不接受任意代码或秘密字段。`doctor` 缺少某产品配置时逐项报告，不把其他已正常服务标记为失败；聚合状态区分 ready、not-configured、unsupported、unknown、failed。

doctor 分别输出 configuration、connectivity、adapter、authorization 和 credentialStore。`--network` 显式开启无凭据 TCP/TLS 检查；默认不发网络请求。诊断执行成功返回退出码 0，检查结果在 data 中表达；五产品 adapter 为 implemented，authorization 仍为 unknown，聚合 status 为 attention。adapter 只表示该产品存在已实现命令。配置解析、超时或中断等执行失败仍返回相应非零退出码。

Token 登录必须指定 `--credential gateway|management`，通过环境变量或显式 `--token-stdin` 输入，验证后存入系统凭据库；`--no-store` 仅验证。Token 退出仅清理本机绑定，不远程撤销 API key。

Shop 登录使用 `CINA_SHOP_APP_ID` 和 `CINA_SHOP_APP_SECRET`，或 `--secret-stdin`；只保存返回的 token、账号和到期信息。`shop session refresh` 是显式 auth-state 操作、禁止自动重试，刷新不确定错误标记 `retryable=false`。Shop 退出仅清除本机绑定，远程撤销为 not-supported。未提供 `--all-products`。

Auth 默认 `login` 使用已注册 native public client、PKCE S256 和临时 IPv4 loopback 回调；`whoami` / `auth whoami` 调用 userinfo 核对用户。`auth session refresh` 显式轮换令牌，失败不自动重试。默认 logout 只清理本机；`--revoke` 要求部署公布 public client 撤销支持，成功结果为 requested。当前公开部署未公布该支持，返回 CAPABILITY_UNAVAILABLE。详见[Auth 说明](auth-shop.md)。

### 产品只读命令

Seek 登录使用已验证的 `--vendor` 浏览器流程，或通过环境变量/`--token-stdin` 导入独立会话；退出为本机清理。`--json`、`--no-input` 和无 TTY 时禁止浏览器启动。登录默认总超时 180 秒，其余命令 30 秒，均可显式调整至最多 300 秒。

| 命令 | 上游能力 | 认证及限制 | 阶段 |
| --- | --- | --- | --- |
| `cina auth status` | 配置的 issuer discovery | 无需业务凭据；只说明身份服务元数据状态 | M2 |
| `cina whoami` / `cina auth whoami` | discovery userinfo endpoint | 已验证的 Auth 会话；仅身份 scope | M2 |
| `cina token models list` | `GET /v1/models` | Gateway key；保留上游 kind 和 route_groups 的默认语义 | M1 |
| `cina token account show` | `GET /v1/me` | Gateway key；返回当前 Key 对应工作区、预算，不等同于用户身份 | M1 |
| `cina token workspaces list` | `GET /api/v1/workspaces` | Management key；按服务端账号权限返回 | M1 |
| `cina shop products list` / `get <id>` | `GET /outapi/product/list`、`/product/{id}` | 开放接口 token 与相应接口权限 | M2 |
| `cina shop orders list` / `get <id>` | `GET /outapi/order/list`、`/order/{order_id}` | 开放接口 token 与相应接口权限 | M2 |
| `cina seek workspaces list` | `AuthenticatedApi.listGadgets()` | Seek session；隐藏临时工作区，无服务端分页 | M2 |
| `cina seek whoami` | `AuthenticatedApi.whoami()` | Seek session；独立于 CinaAuth userinfo | M2 |
| `cina seek status` | `PublicApi.getServerConfig()` | 无需会话；列出登录方式，不推断服务端版本 | M2 |
| `cina chain status` | `eth_chainId`、`eth_blockNumber` | 配置的 RPC；核对 chainId | M1 |
| `cina chain balance --address <address>` | `eth_getBalance` | 原生币余额；输出网络、区块、原始数量和单位 | M1 |

Token Management key 与平台后台管理登录不是同一种凭据。首版不提供平台后台万能管理入口。

### 后续命令

`login --device`、`auth users list`、`auth organizations list` 在认证和权限契约补齐后加入；已有库级端点不代表 CLI OAuth token 能调用。

商品/订单变更、模型生成、Seek Agent 运行、NFT 列表、铸造与钱包签名都不属于 v0.1。NFT 列表需要明确合约枚举或索引来源；不能通过一次通用 EVM RPC 保证取得某钱包的全部 NFT。

未实现的命令只写入路线图，不导出为可执行 schema。已实现但当前环境不满足前提的命令由运行时返回明确错误；不能用空结果冒充成功。

## 2. 参数约定

- 命令格式：`cina <product> <resource> <verb>`；命令 ID 采用点分形式，例如 `shop.orders.list`。
- 每个业务命令支持 `--context <name>`、`--json`、`--no-input`、`--timeout <seconds>` 和 `--help`。
- `--no-input` 禁止提问、浏览器启动和隐式登录；需要认证时立即返回可操作错误。无 TTY 的自动化环境默认如此，登录命令的机器授权协议另行设计。
- 未知参数、重复单值参数和未声明的枚举值报错。不要静默忽略调用者以为生效的过滤条件。
- `--json` 保证 stdout 只产生一个完整 JSON 文档，禁用进度动画和交互；诊断输出到 stderr。
- 分页参数按能力声明提供。没有服务端分页的命令拒绝 `--page`、`--cursor`，不伪造 continuation token。
- 环境变量和安全 stdin 用于凭据输入；业务 JSON 输入文件属于后续写命令契约，不在首版开放任意原始请求通道。

Shop 订单 status 当前使用上游整数过滤；首版 schema 如暴露 `--status`，应保持整数及已核验说明。不能把设计示例中的 `pending` 直接映射成未经确认的订单状态。

## 3. JSON 输出

顶层契约统一，data 按命令定义。示例为虚构订单，字段尚待适配器固定：

```json
{
  "contractVersion": "1",
  "ok": true,
  "command": "shop.orders.list",
  "context": {
    "name": "staging",
    "product": "shop"
  },
  "data": {
    "items": [
      { "id": "example-order-1" }
    ]
  },
  "meta": {
    "pagination": {
      "mode": "page",
      "page": 1,
      "limit": 20,
      "total": 1,
      "hasMore": false
    }
  }
}
```

失败也使用单个 JSON 文档，并返回非零退出码：

```json
{
  "contractVersion": "1",
  "ok": false,
  "command": "token.workspaces.list",
  "context": {
    "name": "staging",
    "product": "token"
  },
  "error": {
    "code": "CREDENTIAL_REQUIRED",
    "message": "此命令需要当前环境的 CinaToken Management API key。",
    "retryable": false
  }
}
```

身份、凭据、订单等只输出命令声明的字段。HTTP response body、请求头、密钥以及未经清理的上游错误不直接透传。允许附带经过脱敏的 upstreamCode、upstreamRequestId 或 retryAfterSeconds，供诊断使用。

未知 command 或尚未完成解析时 `command` 为 null；context 尚未解析时 `context` 为 null。错误码比英文/中文错误描述稳定，脚本应按 code 处理。

金额、链上大整数使用十进制字符串并附 currency/asset、unit/decimals；ID 采用字符串；时间使用带时区的 ISO 8601。计数、page、limit 使用安全范围整数。未知值使用 null 或按 schema 省略，不能替换成 0。

### 分页和集合

| 上游能力 | CLI 表达 |
| --- | --- |
| Shop page/limit + count | page 模式；明确 page、limit、total、hasMore |
| Token Management offset/limit | offset 模式；默认 0/50，响应 total、hasMore、nextOffset 位于 meta.pagination |
| Seek listGadgets 一次性列表 | mode=none；不编造服务端分页或未提供的总量 |
| Token models 一次性列表 | mode=none；保留上游模型过滤含义 |

首版每次返回一个上游页面，暂不提供无限 `--all`。若上游不支持一致快照，分页结果不保证跨页期间没有增删；响应与帮助中说明这一限制。

### 流式输出预留

v0.1 不发布会消耗模型额度或执行 Agent 的流命令。后续使用 `--output ndjson`，与 `--json` 互斥；每行包含 contractVersion、command、sequence、type、data，正常结束发送唯一终止事件。断开且缺少终止事件视为不完整；支持取消，禁止静默重放可能已执行的动作。

## 4. 错误和退出码

| 退出码 | 类别 | 错误码示例 |
| --- | --- | --- |
| 0 | 成功 | 无 |
| 1 | 未分类内部错误 | INTERNAL_ERROR |
| 2 | 参数或配置错误 | INVALID_ARGUMENT、CONTEXT_NOT_FOUND、CONFIG_INVALID |
| 3 | 缺少或失效凭据 | CREDENTIAL_REQUIRED、AUTHENTICATION_FAILED、TOKEN_EXPIRED |
| 4 | 服务端拒绝权限 | PERMISSION_DENIED |
| 5 | 资源不存在 | RESOURCE_NOT_FOUND |
| 6 | 冲突或前提未满足 | CONFLICT、PRECONDITION_FAILED |
| 7 | 限流、网络或上游错误 | RATE_LIMITED、NETWORK_ERROR、UPSTREAM_UNAVAILABLE、UPSTREAM_RPC_ERROR |
| 8 | 当前能力或契约不支持 | CAPABILITY_UNAVAILABLE、UPSTREAM_CONTRACT_MISMATCH |
| 9 | 命令超时 | TIMEOUT |
| 130 | 用户中断 | CANCELLED |

产品错误需要同时检查 HTTP 状态和业务 envelope。CinaShop 的 HTTP 成功不能替代业务状态检查；CinaChain 的 HTTP 200 中可能包含 JSON-RPC error。实际映射以适配器的已核验语义为准。

## 5. schema 契约

从命令注册表生成的 schema 至少包含：

| 字段 | 含义 |
| --- | --- |
| schemaVersion、command、summary | 契约版本、稳定命令 ID、用途 |
| inputSchema、outputSchema | JSON Schema 形式的输入和 data 返回结构 |
| authentication | 所需凭据 scheme；OAuth scope 与产品接口权限分开描述 |
| contextRequirements | endpoint、组织/工作区或 chainId 等要求 |
| effect | local-read、local-write、auth-state、business-read、business-write |
| pagination、streaming | 实际提供的分页和流式能力 |
| retryPolicy、idempotency | 可重试条件及真实的幂等支持 |
| preview | none、local-validation 或 server；不混淆检查与实际执行 |

schema 输出离线可用，不读取秘密、不发起登录、不发送业务请求。schema 描述 CLI 所需权限，不声称当前用户已经拥有权限。

`business-read` 表示不修改目标业务对象，不等于服务器完全没有副作用：访问审计、限流计数和既有服务初始化可能发生。`auth-state` 覆盖登录、刷新和撤销。

## 6. 后续写操作约定

每个写操作单独声明影响范围和认证要求。支持幂等键时说明服务端的键范围、有效期与重复请求结果；不支持时不能靠 CLI 自动添加一个 header 就宣称幂等。

预览区分本地校验与服务端预览；服务端未实现 preview 时，只能报告本地检查结果，不能承诺执行成功或原子性。命令接入阶段先制定具体交互及无人值守契约，再开放业务写能力。
