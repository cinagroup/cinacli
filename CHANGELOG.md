# Changelog

所有版本均为未发布到 npm 的开发预览；版本号不表示五产品真实环境联合验收完成。

## 0.1.0-alpha.5 — 2026-09-07

- 增加 CinaAuth 浏览器 PKCE 登录、`whoami` / `auth whoami`、显式 refresh 和退出，校验签名、nonce、state、issuer、audience 与 userinfo 用户。
- 远程撤销需显式 `logout --revoke` 且部署支持 public client；当前公开 Auth 元数据未声明此支持。
- 修复 Windows 原生凭据容量限制：长会话分块存入系统凭据库，完整写入后更新索引；兼容原有短记录。
- 默认 `login` / `logout` 现对应 Auth；`auth status` 的 `login` 从 `not-implemented` 改为 `browser-pkce`。
- 补充安装说明、支持矩阵、schema 快照与 CI 安装包；共 27 条命令。
- 采用 Apache-2.0，随安装包分发官方 LICENSE 全文。
- 修复 Token 登录/退出并发时凭据重新出现的问题；两类凭据一起退出前先取得全部绑定锁。修复长凭据刷新期间读取旧分块被误报为损坏的问题。

## 0.1.0-alpha.4 — 2026-09-07

- 接入 Cap’n Web 0.12.0，增加 Seek 状态、身份和工作区读取、gatekeeper 浏览器登录、session 导入和本机退出。
- 回收 RPC 对象和连接，处理取消与不受支持的 Cloudflare Access 入口；浏览器登录默认超时 180 秒。

## 0.1.0-alpha.3 — 2026-09-07

- 增加 Auth OIDC 元数据检查，以及 Shop 商品/订单读取、开放接口登录、显式刷新和本机退出。
- 检查 Shop HTTP 与业务状态，裁剪未声明字段，刷新失败不自动重放。

## 0.1.0-alpha.2 — 2026-09-07

- 增加 Token 模型、账户额度和工作区读取；Gateway / Management 凭据独立导入、保存和退出。
- 增加 Chain 状态与原生币余额查询，校验网络并保留大整数精度。

## 0.1.0-alpha.1 — 2026-09-07

- 建立 TypeScript CLI、离线 help/schema、context/config、doctor、系统凭据库、JSON 输出与退出码契约。
- 建立 Windows、macOS、Ubuntu 构建、测试、实际安装包及原生凭据库验证。
