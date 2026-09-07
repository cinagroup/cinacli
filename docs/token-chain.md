# Token 与 Chain 使用说明

适用于 `0.1.0-alpha.2`。以下用 `cina` 表示已安装的 bin；源码目录中可替换成 `node dist/bin.js`。

## 环境

```sh
cina context create staging
cina context use staging
cina config set token.endpoint https://your-token-gateway.example
cina config set chain.endpoint https://rpc-proxy.cinachain.com
cina config set chain.chainId 84532
```

Token 地址是占位示例，必须换成实际部署。端点使用 HTTPS（本机 loopback 调试允许 HTTP），不接受 URL userinfo、query 或 fragment。设置为服务根地址；CLI 保留已有代理路径并追加各业务路由。

## Token 凭据

| 命令 | 凭据 | 临时环境变量 |
| --- | --- | --- |
| `token models list`、`token account show` | Gateway key | `CINA_TOKEN_GATEWAY_KEY` |
| `token workspaces list` | Management key | `CINA_TOKEN_MANAGEMENT_KEY` |

通过已有秘密管理器向进程注入变量即可直接调用业务命令，无需先 login。显式变量优先于当前 context 的系统凭据库；空变量报错，不回退到其他凭据。两类密钥互不代用。

需要持久保存时，先注入对应环境变量，再运行：

```sh
cina login --product token --credential gateway
cina login --product token --credential management
```

Gateway 通过 `/v1/me`、Management 通过一次工作区列表读取验证后才保存。也可以将秘密管理器的输出通过管道传给 `login --product token --credential gateway --token-stdin`；stdin 必须是单个密钥，可有一个行末换行，不支持在终端回显输入。不得同时提供 stdin 和对应变量。`--no-store` 只验证，适用于不支持系统凭据库的环境。

API key 不会被当作个人身份或 OAuth 会话；登录结果不推断用户名、scope 或密钥有效期。凭据按产品、类型、context 和端点隔离；修改对应产品配置会使旧绑定失效。

```sh
cina logout --product token --credential gateway
cina logout --product token
```

前者清除当前 Gateway 绑定，后者清除当前 Gateway 和 Management 绑定。这是本机退出，不远程撤销 API key，也无法清除父进程环境变量；结果中的 `environmentCredentialsPresent` 表示对应变量仍存在。旧配置产生的失效绑定清理将在凭据生命周期管理中补充。

## Token 读取

```sh
cina token models list --kind all --route-groups default,free --json
cina token account show --json
cina token workspaces list --offset 0 --limit 20 --json
```

- 模型默认保留服务端 `kind=llm`、`route_groups=default,free` 的语义。集合无分页，仅输出声明的模型发现字段。
- 账户返回当前 Key 的工作区及预算；金额转成十进制字符串，未知上限保留 null。上游金额是 JSON number，CLI 无法恢复服务端编码前已丢失的精度。任意 metadata 不透传。
- 若配置 `token.workspaceId`，Gateway 命令会核对 `/v1/me` 返回的归属；不匹配时报错。它不改变 Management 账号的权限或列表范围。
- 工作区使用 `offset`（0–1,000,000）和 `limit`（1–100，默认 50）。JSON 的 `meta.pagination` 给出 total、hasMore、nextOffset；每次读取一个页面，不保证跨页快照一致性。

## Chain 读取

```sh
cina chain status --json
cina chain balance --address 0x0000000000000000000000000000000000000000 --json
```

先核对 RPC 的 chainId，再取实际区块；余额使用同一个明确区块号读取。原始余额为十进制字符串，单位 `base-unit`。内置 Base Sepolia 的 ETH/18 位小数元数据，因此该网络另给 formatted；其他链的名称、测试网标记、币种和格式化值保持 null，不猜测币种。

地址接受 20 字节十六进制 EVM 地址；当前不支持 ENS 或 EIP-55 校验。命令不需要钱包，也不发送签名、广播或 JSON-RPC batch。当前公开 RPC 接入不使用 `CINA_CHAIN_RPC_KEY`；需要供应商认证的 RPC 另行适配。

用 `cina schema <command-id> --json` 查看完整字段及认证要求。HTTP 失败、业务响应格式不符、RPC error 和网络不匹配均返回非零退出码，错误不直接透传上游文本。
