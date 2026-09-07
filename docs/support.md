# 支持矩阵与验收状态

对应 `0.1.0-alpha.5`。本地协议测试、三平台 CI 和真实部署验收分别记录；五产品联合验收未完成。

| 产品 | 已实现能力 | 认证方式 | 真实部署证据 / 缺项 |
| --- | --- | --- | --- |
| Auth | status、login、whoami、显式 refresh、logout | 已注册 native public client，浏览器 PKCE S256；系统凭据库 OAuth 会话 | 公开 discovery HTTP 200、ES256；真实浏览器授权待专用客户端注册 |
| Token | models list、account show、workspaces list、凭据导入/退出 | Gateway Key 与 Management Key 分离 | 本地协议测试通过；真实 endpoint 和测试 Key 待提供 |
| Shop | 商品和订单列表/详情、login、显式 refresh、logout | appid/appsecret 换取 outapi token，或显式 token | 本地协议测试通过；真实开放账号、权限和部署待提供 |
| Seek | status、whoami、workspaces list、login、logout | gatekeeper 浏览器授权或已有独立 session | 本地 WebSocket/Cap’n Web 协议测试通过；公开入口返回 Cloudflare Access 302，当前不支持其终端认证 |
| Chain | status、原生币 balance | 当前公开 RPC，无需账户凭据 | Base Sepolia 公开 RPC 的网络、区块和余额读取已验证 |

详细命令参数及输出以随包 [schema 快照](schema.json) 和 `cina schema --json` 为准；具体网络观测与 CI 记录见[验证记录](validation.md)。

## 终端与存储

| 场景 | 支持行为 |
| --- | --- |
| Windows / macOS / Ubuntu，Node 24 | CI 构建、58 项测试、安装包、schema 一致性与原生凭据库验证 |
| 交互终端 | Auth PKCE 和 Seek gatekeeper 可打开系统浏览器；默认登录超时 180 秒 |
| JSON / no-input / 无 TTY | 禁止浏览器启动；已保存会话或明确的 Token/Shop/Seek 凭据可执行读取 |
| Linux 无 Secret Service、系统凭据库锁定或可选模块缺失 | 持久保存明确失败；支持的产品可使用临时环境凭据，不回退到明文配置 |
| 超过原生单条容量的凭据 | 系统凭据库内分块、完整写入后切换索引，最多 64 KiB；摘要校验防止混合/损坏读取 |
| 平台范围 | CI 使用 GitHub hosted runner；不据此声称所有 Linux 发行版、CPU 架构和桌面环境均已验证 |

## 当前限制

- Auth 是身份登录，`openid/profile/email` 不授予用户管理、组织管理或其他产品权限。标准 OAuth 设备授权、密码登录和跨产品单点登录尚未接入。
- Auth 只读命令不自动刷新；访问令牌过期需运行 `auth session refresh`。当前公开部署未声明 public client 撤销支持，`logout --revoke` 会明确拒绝。
- Token 的 Management Key 不等同于平台后台密钥；当前命令不发起模型生成或收费调用。
- Shop 返回商品和订单摘要，省略客户联系方式、地址、发票和内部明细；不会补造服务端未给出的分页总数。
- Seek 协议固定 Cap’n Web 0.12.0，不自动重连或伪造 Origin、Cookie 来穿过 Access；暂不打开工作区或执行 Agent 任务。
- Chain 只做查询，不管理私钥、不签名或广播交易、不提供 NFT 索引。
- 修改产品配置会使旧凭据绑定失效。旧修订凭据和异常退出遗留分块的统一清理仍待后续实现。

## 完成真实联合验收所需证据

在明确版本的受控部署上分别取得：Auth 真实浏览器登录和 userinfo；Token Gateway 读取及 Management 工作区列表的允许/拒绝路径；Shop 开放账号读取及失效/未授权路径；Seek 真实登录和对应用户的工作区列表；Chain 网络和余额读取。每项记录日期、CLI 提交、部署版本、命令、退出码与裁剪后的核对结果，记录中不保存 token、密钥、授权码或用户隐私。

本地 fixture 通过、公开 metadata 可达、npm 包名查询或人工勾选均不能代替上述证据。
