# 产品接口映射与待补能力

状态：源码核查记录和设计草案；核查日期：2026-09-07。

## 1. 核查范围

初始核查只读查看本机五个产品工作区，没有修改这些仓库或调用产品业务接口。后续已通过公开 Chain 测试网 RPC 做只读验证，见[验证记录](validation.md)。部分工作区包含既有未提交或未跟踪内容，因此下列 HEAD 用于定位基线，不表示所有核查内容均已提交、发布或部署。

| 仓库 | 核查时 HEAD |
| --- | --- |
| cinaauth | `bfa56df798ede6a40e9d5cea0ef1a1e9a3568f3f` |
| cinatoken | `7eb59008f7d8e156e81fd18a57658fdef2553264` |
| cinashop | `d33bccd3d93fbb7182bf72500a66a02641a059c3` |
| cinaseek | `d935bd4423fb64cbc0965b3d7f71ebd66c31a3ca` |
| cinachain | `78b8a13af28f4eb21134e58194a641f5bf392e59` |

本文源码路径均相对于对应产品仓库。以下“现有”指本地源码存在；“需补齐”包含部署配置、客户端注册、联调或服务端实现，不能全部算作 CLI 内部开发。

## 2. CinaAuth

现有依据：

- `workers/auth-api/src/plugins.ts:258` 启用 bearer 插件；它不代表任意 OAuth token 都能访问会话管理 API。
- `workers/auth-api/src/plugins.ts:440` 启用独立 `deviceAuthorization()`。
- `workers/auth-api/src/plugins.ts:468` 启用 `oauthProvider()`，484 行配置 `openid profile email offline_access`。
- `packages/oauth-provider/src/device-code.ts:361` 起说明 OAuth 设备授权组合，且禁止重复安装设备授权插件。
- `packages/oauth-provider/src/oauth.ts:1671` 定义 `/oauth2/userinfo`。
- `packages/cinaauth/src/plugins/admin/routes.ts:792` 定义 `/admin/list-users`。
- `packages/cinaauth/src/plugins/organization/routes/crud-org.ts:966` 定义 `/organization/list`。
- `workers/auth-api/src/cinatoken-oidc-bridge.ts` 有专用会话桥接，依赖服务端 bridge secret、token audience 和角色校验。

首版：

| CLI 能力 | 接入 |
| --- | --- |
| auth status | 配置 issuer，校验 discovery 元数据 |
| login / whoami | 已注册 CLI public client + PKCE + discovery userinfo endpoint |

Auth status 已实现并对 `https://auth.cinaseek.ai` 的实际 discovery 验证通过；不会将元数据公布的能力视为 CLI 已注册或用户已授权。浏览器 OAuth 尚未实现。

需补齐：

1. 为 staging / production 注册并核验 CLI public client、loopback 回调及刷新策略。
2. 验证当前部署的 discovery、userinfo、refresh 和 revoke 行为。
3. 为 Auth 用户/组织管理确定 CLI 可使用的受限授权方案，不能把用户登录当成管理授权。
4. 标准设备授权单独排期；保持现有独立设备登录兼容，不把两种 token 混用。

## 3. CinaToken

现有依据：

- `packages/proxy/src/app.ts:299` 和 300 行挂载 `/v1/me`、`/v1/models`。
- `packages/proxy/src/routes/v1/models.ts` 使用 Gateway key；默认 kind 是 LLM，默认 route_groups 是 default/free。
- `packages/proxy/src/routes/v1/me.ts` 返回当前 key 的 workspace_id、预算和 metadata。
- `packages/proxy/src/middleware/management-auth.ts` 分离 Management key，普通 Gateway key 不具备同等权限。
- `packages/proxy/src/app.ts:313` 起挂载 `/api/v1/keys`、`/api/v1/workspaces` 等管理路由。
- `packages/proxy/src/routes/v1/management-workspaces.ts` 使用个人/组织账号上下文限制工作区操作。

首版命令：models list、account show、workspaces list。前两项使用 Gateway key，第三项使用 Management key。保留 workspace 归属和 key 权限的服务端校验，不尝试把一类 key 自动转成另一类。

CLI 已实现三项命令、两类 key 验证导入和本机退出。models 无分页；工作区接口使用 offset/limit，返回 data/total_count；公开工作区 DTO 不提供可靠用户主体字段，因此不推断用户身份。字段与分页通过本地契约测试。

需补齐：取得部署 endpoint 和独立测试凭据，核验真实服务中 key 被撤销/越权时的响应。把 CinaAuth 登录接入这些业务 API 属于后续服务端工作；现有后台 SSO 的专用桥接密钥不能交给 CLI。

平台管理员后台操作、密钥创建/轮换和模型生成不进入首版。

## 4. CinaShop

现有依据：

- `workers-ts/src/app.ts:57` 挂载 `/outapi`。
- `workers-ts/src/routes/outapi.ts:8`、9 行定义 `POST /get_token` 和 `POST /refresh_token`。
- 同文件 41、66、71、121 行附近定义商品列表/详情、订单列表/详情路由；实际详情路径分别为 `/product/:id`、`/order/:order_id`。
- `workers-ts/src/controllers/out/OutApiController.ts:62` 起用 appid/appsecret 获取 token，刷新接收 access_token 或 token。
- `workers-ts/src/middleware/out-auth.ts:167` 起执行 token 验证、账号限流、接口权限和访问审计。
- `workers-ts/src/services/out/OutApiService.ts` 的 `orderList` 使用 page/limit、整数 status 等过滤；基础查询含 `storeId = 0`。

首版采用开放接口账号，支持商品/订单列表和详情。通过现有 get_token / refresh_token 取得对应 token；`assertInterfacePermission` 的 method + route 模板是实际权限依据。

这一接入表示开放接口账号可读取的数据。现有开放接口并不自动等价于供应商、店铺管理员或消费者身份。不能在 CLI 加一个 `--shop-id` 就声称已经实现多店铺隔离；客户端过滤也不能承担授权边界。

已实现商品/订单列表及摘要详情、appid/appsecret 登录、带锁的显式刷新和本机退出；本地测试覆盖分页、金额字符串、字段脱敏和业务状态检查。刷新接口先清除旧会话，CLI 禁止自动重试；当前未核验远程退出端点。

需补齐：核验真实部署的开放接口启用状态、只读账号授权和 token 生命周期。后续若支持多店铺/供应商，先明确服务端资源隔离契约。

订单详情中的个人信息按真实需求选取字段，默认输出避免扩散收货地址和电话。退款、发货、库存和商品写入另立命令与验收条件。

## 5. CinaSeek

现有依据：

- `packages/workshop-shared/src/api.ts:53` 起定义 PublicApi；含 ping、getServerConfig、startGatekeeperLogin、authenticate。
- `packages/workshop-shared/src/api.ts:419` 定义 `AuthenticatedApi.whoami()`。
- `packages/workshop-shared/src/api.ts:594` 定义 `listGadgets()`，返回非临时工作区列表，尚无分页。
- `packages/workshop-frontend/src/main.tsx:103` 附近通过 `/api` 建立 Cap'n Web WebSocket RPC。
- `packages/workshop-backend/src/server.ts:813` 起实现 gatekeeper 登录；Cloudflare Access 模式有独立分支。
- `packages/workshop-backend/src/server.ts` 的 `/api` 分支校验 Access JWT；服务初始化可能触发内置蓝图安装。

首版：

1. 从部署 getServerConfig 读取可用登录方式；支持的 gatekeeper 登录产生 URL 和 LoginAttempt。
2. CLI 打开系统浏览器，等待 `attempt.wait()` 返回 Seek session token。
3. `authenticate(token)` 获取 AuthenticatedApi，调用 whoami 或 listGadgets。
4. 将列表转换成 CLI 工作区 DTO；释放所有 RPC stub、待登录对象与 WebSocket。

Cloudflare Access 部署需另行核验终端可使用的 Access 身份获取路径。没有有效 Access 凭据时，不能通过伪造 Origin 或跳过验证宣称支持；首版明确返回当前认证模式未接入。

CLI 已固定 Cap’n Web 0.12.0 / ws 8.21.3 并维护已核验的最小 RPC 子集，接入 status、whoami、workspaces list、gatekeeper 浏览器登录、显式 session 导入及本机退出。Node 本地完整 WebSocket 协议测试包含 Date 转换、资源释放、取消和断线。

实际 `wss://cinaseek.ai/api` 握手返回 302，跳转到 Cloudflare Access 登录。需补齐：真实可用部署的浏览器授权与只读验收、session 生命周期及可发布公共 RPC 类型契约。不会从前端 localStorage 提取会话，也不会把 CinaAuth access token 直接传入 authenticate。

工作区 listGadgets 不需要 openGadget；后者可能兑换分享权限并建立更复杂的会话，不作为列表实现捷径。跨产品身份映射与细分工作区授权后续推进。

## 6. CinaChain

现有依据：

- `config/deployment.ts:15` 起配置 Base Sepolia，chainId 为 84532。
- `lib/auth/cinaauth.ts:12` 起说明 OIDC public client + PKCE；钱包连接独立于账户登录。
- `workers/rpc-proxy/src/index.ts:47` 起允许 eth_chainId、eth_blockNumber、eth_getBalance、eth_call 等方法；也允许部分发送方法，但首版 CLI 不开放发送。
- 同文件拒绝批量 JSON-RPC 和 eth_getLogs 等方法，适配器不能假定现有代理支持批量或任意日志扫描。

首版通过配置的 RPC 查询链 ID、最新区块和原生币余额。请求先核对 chainId；余额携带所用区块和单位，超出 JavaScript 安全整数范围的数据按字符串输出。请求数量应兼容当前代理不接受 batch 的限制。

CLI 已实现链状态与原生余额读取。`workers/rpc-proxy/wrangler.toml` 的公开域名为 `rpc-proxy.cinachain.com`，当前源码限流为每 60 秒 120 次；逐个请求兼容不接受 batch 的代理。Base Sepolia 网络元数据已内置，其他网络元数据保持未知；公开测试网实际查询通过。该记录不代表主网或需要供应商认证的 RPC 已验收。

NFT list 延后到明确合约枚举或索引 API 后；事件索引、ABI 发布和合约部署清单应有独立版本。钱包私钥、交易签名和广播不会因 CinaAuth 登录成功而获得授权。

## 7. 联调信息清单

下列信息在相应产品开始联调时补充，不阻塞 M0：

| 产品 | 非敏感信息 | 凭据前提 |
| --- | --- | --- |
| Auth | issuer、clientId、回调规则、可用 scope | 用户通过浏览器授权 |
| Token | gateway endpoint、接口版本 | Gateway key；管理测试另用 Management key |
| Shop | API base、开放接口启用状态、账号权限范围 | 只读 appid/appsecret，通过安全输入 |
| Seek | RPC endpoint、登录模式、兼容契约版本 | 浏览器登录；Access 模式需单独接入 |
| Chain | RPC endpoint、预期 chainId | 公共 RPC 通常无需；供应商凭据单独注入 |

开发阶段分别用可控本地服务或 staging 验证，再记录目标部署结果。源码检查、模拟响应测试、真实服务联调、发布包验证四类证据分别记录，不能互相代替。
