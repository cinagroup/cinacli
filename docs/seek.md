# Seek 使用说明

适用于 `0.1.0-alpha.4`。以下 `cina` 可在源码目录中替换为 `node dist/bin.js`。

## 配置与状态

```sh
cina config set seek.endpoint wss://your-seek.example/api
cina seek status --json
```

配置必须是实际 RPC 路径，通常为 `/api`；CLI 不擅自追加路径。也接受 HTTPS URL 并在连接时转换成 WSS；只有 loopback 开发地址允许 WS/HTTP。上例是占位地址，必须换成实际部署。

`seek status` 调用 `getServerConfig()`，返回可用 gatekeeper 的 ID/名称、密码登录是否开放及 CLI 协议版本。服务端没有版本字段，因此 `serverVersion=null`。使用固定版本 Cap’n Web 0.12.0，通过本地完整 WebSocket 协议测试，不依赖相邻仓库或浏览器存储。

当前 `wss://cinaseek.ai/api` 的公开检查返回 HTTP 302，重定向至 Cloudflare Access 登录。此模式尚未接入，CLI 返回 CAPABILITY_UNAVAILABLE；需要另行验证终端可获取、且服务端接受的 Access 身份流程。没有跟随重定向或向握手添加 Origin/Cookie/Authorization。

## 浏览器登录

在有系统浏览器的交互终端中，先从 status 结果选取 vendor ID：

```sh
cina login --product seek --vendor <vendor-id>
```

CLI 仅允许服务实际列出的登录方式，调用 `startGatekeeperLogin()`，打开返回的 HTTPS 地址，等待 LoginAttempt 能力对象交付 Seek 会话，然后通过 `authenticate()` 和 `whoami()` 验证身份。初次登录是否创建账号、供应商申请何种权限取决于 Seek 的 gatekeeper 流程；浏览器授权页会展示这些请求。

成功后只保存独立 Seek session 和服务端身份，不推断未提供的到期时间或 OAuth scopes。CinaAuth 登录结果不会直接当作 Seek session。`--no-store` 只验证，不保留或输出新会话。

登录默认总超时 180 秒，可用 `--timeout` 调整至最多 300 秒；读取命令默认 30 秒。Ctrl+C 会取消命令、释放待登录能力对象和 RPC 连接，并清理当前凭据锁。

`--json`、`--no-input` 和无 TTY 执行禁止浏览器启动。无人值守环境使用已有会话：

```sh
cina login --product seek --token-stdin
```

通过秘密管理器向 stdin 提供 session token，也可通过 `CINA_SEEK_SESSION_TOKEN` 注入。不得同时提供多种来源；不接受把会话作为普通命令行参数。临时变量可以直接用于业务命令，无需先 login；只有显式 login 才会持久保存。

## 身份与工作区读取

```sh
cina seek whoami --json
cina seek workspaces list --json
```

whoami 返回服务端用户 ID/名称。工作区通过 `listGadgets()` 一次性列出当前用户的非临时工作区；不调用 `openGadget()`，不创建工作区或启动 Agent。

工作区摘要包含 ID、标题、创建/活跃时间、置顶、访问角色、所有者、分享限制和已知推理费用。Date 转为 ISO 时间；已知费用以十进制字符串和 USD 输出，未知费用为 null。上游省略 role 时按其兼容契约视为 build，省略 owner 表示当前用户所有；这些展示字段不能代替服务端授权。

当前无服务端分页，JSON `meta.pagination.mode=none`，拒绝 page/cursor 参数。`seek.workspaceId` 预留给后续单工作区操作；列表仍表示服务端当前用户的完整可见集合，不据此过滤或创建授权。

## 生命周期与限制

```sh
cina logout --product seek --json
```

退出只移除当前本机绑定；当前核验的 RPC 子集没有远程会话撤销方法，输出 `remoteRevocation=not-supported`。父进程中的环境变量需由调用方清理。

每条命令建立一条连接，结束、出错和取消都会释放返回对象、authenticated stub、待登录对象及根连接；不会自动重连或重放。客户端限制单条消息 4 MiB、整个会话累计接收 16 MiB、反序列化深度 64；超出限制明确失败。暂不提供密码登录、Cloudflare Access、任意 RPC 调用、会话刷新或 Agent 执行。
