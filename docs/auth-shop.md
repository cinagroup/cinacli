# Auth 与 Shop 使用说明

适用于 `0.1.0-alpha.3`。以下用 `cina` 表示已安装 bin；源码目录中可替换成 `node dist/bin.js`。

## Auth 服务状态

```sh
cina config set auth.issuer https://auth.cinaseek.ai
cina auth status --json
```

命令读取 issuer 下的 `/.well-known/openid-configuration`，按照 [OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationValidation) 校验 issuer 精确匹配、必要元数据及端点 URL。保留 issuer 路径，不跟随重定向；不读取凭据或访问元数据中公布的业务端点。

`advertised` 表示服务公布的授权码、PKCE S256、public client、refresh grant 和 scope 信息。`client.registration` 始终为 `not-verified`；配置 clientId 和 discovery 成功都不证明该客户端已注册。当前 `login` 为 `not-implemented`，浏览器 OAuth 登录、whoami 和令牌刷新后续接入。

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
