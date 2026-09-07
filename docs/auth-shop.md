# Auth 与 Shop 使用说明

适用于 `0.1.0-alpha.5`。以下用 `cina` 表示已安装 bin；源码目录中可替换成 `node dist/bin.js`。

## Auth 服务状态

```sh
cina config set auth.issuer https://auth.cinaseek.ai
cina auth status --json
```

命令读取 issuer 下的 `/.well-known/openid-configuration`，按照 [OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationValidation) 校验 issuer 精确匹配、必要元数据及端点 URL。保留 issuer 路径，不跟随重定向；不读取凭据或访问元数据中公布的业务端点。

`advertised` 表示服务公布的授权码、PKCE S256、public client、refresh grant 和 scope 信息。`client.registration` 始终为 `not-verified`；配置 clientId 和 discovery 成功都不证明该客户端已注册。`login: browser-pkce` 表示 CLI 已实现的流程；真实部署登录仍需下列注册条件。

## Auth 浏览器登录与身份

由身份服务管理员为相应环境注册专用 native public client：`application_type: native`、`token_endpoint_auth_method: none`、授权码与 refresh token grant、`response_types: [code]`、强制 PKCE S256，以及回调 `http://127.0.0.1/callback`。部署必须允许该 loopback 回调仅端口变化；CLI 每次监听 IPv4 的临时端口，不固定抢占端口、不绑定外网地址、不使用 client secret。CinaAuth 源码 `packages/oauth-provider/src/authorize-loopback.test.ts` 已包含 native client 的此类校验；源码支持不等于生产注册完成。

客户端 scope 需允许 `openid profile email offline_access`；CLI 只请求 discovery 实际公布的上述范围，要求至少支持 `openid`。没有获得 refresh token 的会话仍可使用，但过期后需重新登录。签名算法从元数据中的 EdDSA、Ed25519、ES256、RS256、PS256 中依次选择；注册的 ID token 算法应与该选择一致。当前公开部署公布 ES256。

```sh
cina config set auth.clientId <已注册的客户端ID>
cina login
cina whoami --json
# 等同于 cina auth whoami --json
cina auth session refresh --json
cina logout --json
```

登录仅在交互终端启动系统浏览器，默认 180 秒，可用 `--timeout` 调整至最多 300 秒。`--json`、`--no-input` 或无 TTY 禁止浏览器登录；没有手动粘贴回调、密码输入、设备码或任意 access token 导入回退。`--no-store` 完成验证后丢弃会话，不输出令牌，也不能供后续命令继续使用。

使用固定版本 oauth4webapi 3.8.8 进行 PKCE、state、nonce、issuer、audience、expiry 和签名验证，另外核对 azp 与签发时间。登录和身份读取均通过 `userinfo` 核对 ID token 的 subject；输出仅包含 issuer、subject、name、email、emailVerified、scope 和访问令牌到期时间，不输出完整 claims 或令牌。身份 scope 不代表管理员、组织或其他产品权限，`auth.organizationId` 不会自动扩大身份权限。

访问令牌过期不会在只读命令中隐式刷新；请显式执行 `auth session refresh`。刷新与登录/退出共用绑定锁；刷新不自动重试，包括超时，失败结果为 `retryable=false`，应重新登录。刷新返回 ID token 时继续验证签名、subject、nonce 和 auth_time；没有返回 ID token 时仍用新 access token 调用 userinfo 核对原用户。

所有 OAuth 请求禁止重定向和自动重放，正文上限 256 KiB；非 loopback 请求要求 HTTPS，HTTPS issuer 不得降级到 HTTP 端点。当前环境、issuer 或客户端配置变化会使旧凭据绑定失效。

## Auth 保存与退出

access token、refresh token 及已验证身份元数据保存在系统凭据库，配置文件只含非敏感设置。较长记录在凭据库内分块：每块最多 1000 字符，记录最多 64 KiB；分块完整写入后才更新索引，并校验整体摘要。兼容旧的单条记录。进程在索引写入时异常退出可能遗留未引用分块，保留在系统凭据库中；不自动扫描或清理其他绑定，旧修订/孤立分块清理仍待后续实现。

读取分块期间会复核索引；若刷新已替换记录，转而读取新版本，若退出已删除记录则返回缺少凭据。最多读取三个版本，持续变化时报 CONFLICT；索引未变化但内容损坏仍返回认证失败。这只处理本地存储并发，不重放 OAuth 刷新或其他网络请求。

`logout` 默认只清理当前 Auth 本机凭据，不退出浏览器、不影响其他产品。显式 `logout --revoke` 仅在元数据声明 public client (`none`) 撤销支持时尝试撤销 refresh/access token；所有请求成功后才清理本机，输出 `remoteRevocation: requested` 表示端点已接受，不保证所有独立 JWT 即时失效。中途失败可能已撤销部分令牌，此时可用普通 `logout` 清理本机。

2026-09-07 公开 discovery 的撤销认证方式仅为 client_secret_basic、client_secret_post 和 private_key_jwt，未公布 none；因此当前公开部署的 `--revoke` 返回 CAPABILITY_UNAVAILABLE。CLI 不通过加入客户端秘密或忽略元数据绕过此限制。真实浏览器/生产账户登录验收尚待专用客户端配置；本地协议测试使用受控浏览器启动替身。

## Shop 认证

先选择已有 context，并把 `shop.endpoint` 设置为实际服务根地址。使用开放接口账号的 `CINA_SHOP_APP_ID` 和 `CINA_SHOP_APP_SECRET`，然后：

```sh
cina login --product shop
```

通过 `POST /outapi/get_token` 登录，仅将返回的访问令牌、服务端确认的账号 ID 和过期时间保存到系统凭据库；不保存 appsecret，不打印 access token。管道输入 appsecret 使用 `--secret-stdin`，此时仍需通过环境变量提供 appid，并移除 `CINA_SHOP_APP_SECRET`，避免来源歧义。

`--no-store` 只验证登录，不保留或输出新令牌，后续命令不能复用本次丢弃的会话。已有开放接口 access token 可通过 `CINA_SHOP_ACCESS_TOKEN` 临时注入业务命令；它优先于系统凭据库。登录或刷新前需移除该覆盖，避免新旧会话混用。

可选 `shop.accountId` 是开放接口**数字账号 ID**的字符串形式，不是 appid。配置后要求与登录响应的已验证身份一致；临时 access token 没有可确认的账号元数据，因此会被拒绝，不解码 JWT 来冒充身份验证。该配置不是店铺或供应商授权边界。

## 只读命令

```sh
cina shop products list --page 1 --limit 20 --name 示例 --json
cina shop products get 123 --json
cina shop orders list --page 1 --limit 20 --status 1 --paid 1 --json
cina shop orders get ORDER-10 --json
```

账号需具有对应 `GET /product/list`、`GET /product/{id}`、`GET /order/list`、`GET /order/{order_id}` 权限。商品列表保留服务端在售可见商品范围；商品详情限定平台商品，订单使用上游 `storeId=0` 范围，不能代表多店铺管理。接口授权仍由服务端执行。

- 商品摘要：ID、名称、图片、价格和库存。
- 订单摘要：ID、订单号、状态及名称、支付状态、数量、总价/支付金额和创建/支付时间；默认不输出姓名、电话、地址、发票或原始商品快照。
- 金额保留上游十进制字符串；接口不提供币种，所以 `currency=null`，不猜测 CNY。上游零时间戳表示尚无时间，输出 null。
- page 范围 1–100,000，limit 范围 1–100，默认 1/20。分页信息位于 JSON 的 `meta.pagination`，不保证跨页快照一致性。上游 count 为 null 时 total、hasMore 和 nextPage 均保持未知。
- status 是服务端整数状态，paid 为 `0` 或 `1`；未核验的英文状态名不接受。

HTTP 200 仍需检查业务 status；错误 msg/data 不直接输出。当前服务端部分权限失败与认证失败共用 `410000`，CLI 明确提示核对认证及接口授权，不从中文错误消息猜测身份状态。

## 刷新和退出

```sh
cina shop session refresh --json
cina logout --product shop --json
```

在令牌过期前显式刷新；过期后重新登录。刷新使用当前保存的有效会话，不接受临时环境变量覆盖，不自动重试。登录、刷新和退出按当前凭据绑定加进程间锁；并发操作返回 CONFLICT。

服务端刷新会先清理旧会话。若请求超时、响应不兼容或新令牌保存失败，旧会话可能已经失效，错误返回 `retryable=false` 并提示重新登录。CLI 不承诺服务端在所有存储模式下都能撤销旧令牌。

退出只删除当前本机凭据。现有开放接口没有核验过的远程 logout/revoke，因此结果为 `remoteRevocation=not-supported`；父进程环境变量仍由调用方管理。异常进程退出留下的 `credential-*.lock` 需确认没有认证操作运行后手动清理，不自动抢锁。
