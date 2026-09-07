# 验证记录

日期：2026-09-07。源码契约测试、实际服务联调和安装包验证分别记录。

## M0 / 0.1.0-alpha.1

提交 `e3ba55748bfdf3624b3c69086a110f6b3ce13ade` 的 [GitHub Actions](https://github.com/cinagroup/cinacli/actions/runs/34093055164) 已在 Windows、macOS、Linux 通过类型检查、构建、18 项契约测试、离线安装包运行与原生系统凭据库读写/删除。

## M1 / 0.1.0-alpha.2

29 项本地测试通过，包括 Gateway / Management 互不代用、验证失败不覆盖凭据、分页、模型筛选、工作区不匹配、字段脱敏、stdin 取消、网络校验、JSON-RPC 格式错误和超过安全整数范围的余额。接口测试使用受控 loopback 服务及合成密钥。

实际 Chain 验证使用 `https://rpc-proxy.cinachain.com`，单独建立并删除临时 CLI 配置：

| 命令 | 观察结果 |
| --- | --- |
| `chain status` | chainId 84532，Base Sepolia；区块 46498511 |
| `chain balance --address 0x0000000000000000000000000000000000000000` | 区块 46498512；原始余额 `1086265608935910791641`，格式化为 `1086.265608935910791641` ETH |

这是公开测试网在验证时的快照，后续区块和余额可以变化。没有使用钱包、私钥或广播方法。

M1 Windows 本地类型检查、构建和 29 项测试通过。实际安装 `artifacts/cinagroup-cli-0.1.0-alpha.2.tgz` 后，离线命令、Chain 余额、Token 账户及 stdin 导入验证通过；包包含 26 个允许发布的文件。原生系统凭据库的合成凭据保存、读取和删除也通过。提交 `d163fe3bca91dfac17cf601f7c23a6014492c516` 的[三平台 CI](https://github.com/cinagroup/cinacli/actions/runs/34095054033) 已全部通过；CI 不调用公开产品服务。

Token 的真实 Gateway / Management 认证联调尚未完成，等待部署 endpoint 和独立测试密钥。没有五产品联合验收或 npm 发布。

## M2 首批 / 0.1.0-alpha.3

已实现 Auth status 与 Shop 商品/订单摘要列表、详情、appid/appsecret 登录、显式刷新及本机退出。新增 8 项本地契约测试，总数 37；覆盖 OIDC issuer/URL 校验、业务 envelope 错误、字段裁剪、账号绑定、stdin、刷新并发锁和不确定结果禁止重试。

Auth 实际只读验证：`https://auth.cinaseek.ai` 的 discovery issuer 匹配；公布授权码、S256、public client 和 refresh grant，scope 为 openid/profile/email/offline_access。未配置 CLI clientId，没有发起浏览器登录或用户身份验证。

Windows 本地类型检查、构建、37 项测试及实际安装包验证通过；alpha.3 包提供 21 条命令，包含 33 个允许发布的文件。安装后的 bin 已验证 Auth discovery、Shop 读取及 secret stdin 登录，并回归 Token/Chain 命令。

Shop 使用受控 loopback 服务和合成账号/token 测试，真实开放接口账号联调待完成。提交 `ad5af4dc2b948b145a677c8c9aa91cc22334df34` 的[三平台 CI](https://github.com/cinagroup/cinacli/actions/runs/34096440736) 已全部通过。

## M2 Seek / 0.1.0-alpha.4

新增 Seek status、whoami、workspaces list、gatekeeper 浏览器登录、已有会话导入及本机退出。固定 Cap’n Web 0.12.0 / ws 8.21.3，使用真实本地 WebSocket RPC 服务测试。

Windows 本地类型检查、构建和全部 45 项测试通过，包括错误会话不覆盖已有凭据、无 TTY 不启动浏览器、登录取消释放 stub/socket/锁、非法浏览器 URL、302/403 握手拒绝、断线与超时。浏览器启动在测试中注入受控替身，未将这些测试称作实际系统浏览器授权验收。

实际安装 alpha.4 产物后已验证 Seek 状态、身份、带 Date 的工作区和 stdin 导入，以及其他产品命令；包提供 24 条命令，包含 40 个允许发布的文件。跨平台执行结果以对应提交 CI 为准。

提交 `8a288d9cb8678d7c4e6a5b82caa7b23b4adf86f0` 的 [Windows / macOS / Ubuntu CI](https://github.com/cinagroup/cinacli/actions/runs/34098503715) 已全部通过。

公开服务证据：`wss://cinaseek.ai/api` 握手 HTTP 302，目标 origin 为 `https://cinagroup.cloudflareaccess.com`、路径 `/cdn-cgi/access/login/cinaseek.ai`。未使用任何凭据或跟随跳转；没有完成真实 Seek 会话或工作区读取。Auth 浏览器 OAuth 和产品真实认证验收仍未完成。

## M2 Auth / 0.1.0-alpha.5

已实现 Auth 浏览器 PKCE、whoami / auth whoami、显式 refresh 和本机退出，可按元数据支持显式请求远程撤销。oauth4webapi 固定为 3.8.8；所有令牌/JWKS/userinfo 请求有响应大小限制，不跟随重定向、不自动重放。

本地类型检查、构建和 58 项测试通过。新增 Auth 测试使用真实 loopback HTTP 服务、RS256/ES256 签名及受控浏览器启动替身，验证 PKCE code verifier、state/nonce、issuer/audience/azp、到期/签发时间、签名、userinfo 用户替换、拒绝授权、过期、撤销、刷新并发锁、超时取消及配置变化。安装后的 alpha.5 包重复通过 10 项 OAuth 协议测试；包共 27 条命令、44 个允许发布文件。

实际 Windows 凭据库验证发现 2400 字符单条记录写入失败，因此新增系统凭据库分块适配。包含约 4200 字符合成 access/refresh token 和 Unicode 身份的长记录，已在真实 Windows 凭据库完成写入、读取、替换和删除；没有读取用户已有凭据。分块测试验证旧记录兼容、分块写入失败、索引提交结果不确定和内容损坏。跨平台行为由该提交 CI 继续验证。

2026-09-07 再次读取 `https://auth.cinaseek.ai/.well-known/openid-configuration`，HTTP 200，issuer 精确匹配、签名算法 ES256、token 端点支持 none；revocation 端点仅公布 client_secret_basic/client_secret_post/private_key_jwt。因此当前公开部署的 CLI 远程撤销不可用；没有宣称已完成生产用户登录或令牌撤销。

剩余真实验收：Auth 专用 native public client 和真实浏览器授权；Token endpoint/测试 Key；Shop 部署/开放账号；Seek 支持的 gatekeeper 部署或后续 Access 终端方案。M3 发布准备及五产品联合运行验收仍未完成，未发布 npm 包。
