# 实施顺序与验收条件

状态：实施中；更新日期：2026-09-07。

M0 至 alpha.5 已推送且三平台 CI 通过。alpha.5 加入 Auth PKCE 登录、userinfo、显式刷新和系统凭据分块存储。M3 已补充安装说明、支持矩阵、schema 快照、变更记录及发布流程；CI 安装包已上传并下载核对摘要。并发复核后本地测试扩展至 62 项。Auth 真实浏览器登录待专用 public client；Token/Shop/Seek 真实认证验收待测试配置与凭据。详细证据见[验证记录](validation.md)。尚未发布 npm 包。

## 目标

v0.1 交付一个可安装的 `@cinagroup/cli` 包和 `cina` 命令，在已配置、受支持的环境中完成五产品的只读业务调用。

阶段性 alpha 可以先交付公共框架、Token 与 Chain。只有 Auth、Shop、Seek 的真实认证和只读调用也通过，才能声称“五产品首版已接通”。登录和配置属于认证/本地状态操作，单独声明。

## M0：公共框架

实现及三平台验收已完成。

交付：

- 初始化单包 TypeScript 项目，配置 `cina` bin，固定 Node.js 支持范围和 pnpm 版本。
- 实现命令注册表、离线 help/schema、参数校验。
- 实现命名 context、非敏感配置和产品凭据隔离接口。
- 实现 JSON envelope、退出码、脱敏错误、超时和取消。
- 验证系统凭据库在三个操作系统的可行接入；明确无凭据库时的临时凭据行为。
- 建立构建、类型检查、必要契约测试和打包验证流程。

验收：

1. help/schema 不发网络请求、不加载业务凭据、不要求登录。
2. Windows PowerShell、macOS/Linux shell 均能从实际打包产物启动 `cina`。
3. 错误 JSON 可直接被标准 JSON 解析器读取，退出码与契约一致。
4. 切换 context 或 endpoint 不会沿用错误环境的凭据；临时变量不会写入配置。
5. 参数错误、缺失配置和凭据库不可用返回真实状态；不创建“测试成功”的假业务结果。

外部依赖：无产品接口改动要求。包名占用情况、发布权限和具体依赖版本在准备发布前核验。

## M1：Token 与 Chain 最小闭环

CLI 实现和 29 项本地契约测试已完成；Chain 公开测试网读取已验证，Token 真实认证验收仍待外部配置。

交付：Token Gateway / Management 凭据分别导入；models list、account show、workspaces list；Chain status、原生币 balance。

验收：

- 分别用 Gateway 和 Management 凭据验证允许与拒绝路径；授权错误不能被空列表掩盖。
- 核对模型过滤、工作区归属与真实分页语义。
- Chain 返回实际 chainId、区块、余额及单位；配置与节点网络不符时失败。
- RPC 不发送签名/广播请求，不依赖不支持的 batch。
- 只读临时错误重试有限，取消或超时后连接能退出。

外部依赖：可访问的 Token endpoint、两类测试 key、指定 Chain RPC。缺少凭据时先完成适配器契约测试，并把真实联调标为未完成。

## M2：Auth、Shop、Seek 接入

当前已实现 Auth status、PKCE 登录、userinfo、显式刷新和退出；Shop 读取与会话、Seek gatekeeper 登录/导入与身份/工作区读取均通过本地协议测试。Auth 真实浏览器登录待专用 public client。Seek 当前线上入口受 Cloudflare Access 保护，真实认证验收待支持的部署或独立 Access 终端接入方案；不将本地协议测试或公开 discovery 当成用户登录验证。

| 工作项 | CLI 交付 | 产品侧前提 |
| --- | --- | --- |
| Auth | status、PKCE login、whoami、刷新及退出 | CLI public client 注册、回调规则及授权端点核验 |
| Shop | 产品登录、商品与订单列表/详情 | 开放接口账号、只读权限、启用的部署 |
| Seek | 产品浏览器登录、whoami、workspaces list | 支持的 gatekeeper 登录；版本兼容的 RPC 契约 |

验收：

1. Auth 浏览器完整登录成功；拒绝、state/nonce 不匹配、过期和撤销路径有针对性验证。
2. Shop 正常账号只读接口通过；未授权接口和失效 token 返回明确错误；HTTP/业务状态均被检查。
3. Seek 浏览器登录取得服务端 session，工作区列表对应实际用户；登录取消、断线和执行结束均释放资源。
4. 未接入的 Access 模式或标准设备授权按 unsupported 报告，不自动改变服务端配置。
5. 所有凭据日志和诊断均脱敏，默认 JSON data 只含已声明字段。

Auth 用户/组织管理命令不在本阶段靠现有 OIDC 身份 scope 强行接通。

## M3：v0.1 发布准备

交付：安装说明、真实使用示例、支持矩阵、schema 快照、变更记录及版本发布流程。

当前：文档和 schema 快照已准备；CI 已归档验证后的 tarball、摘要和文件清单，并完成实际下载核验。许可证已按用户选择设为 Apache-2.0 并纳入安装包。公开 npm 查询为 404、本机未登录，组织发布权限尚未核验。真实用例仅 Chain 已完成业务读取，Auth 公开 discovery 不算真实用户登录，其余产品验收仍待条件。用户已确认 Auth clientId 和 Token 网关地址未准备，真实联合验收继续保留为待完成。M3 未整体完成。

验收：

- 在实际打包产物上完成安装、启动、help/schema 与已接通命令的抽样验证。
- 检查发布文件清单，排除凭据、本地上下文和内部调试材料。
- 三操作系统通过公共行为验证；各产品在明确版本的受控部署上完成至少一个真实只读命令。
- 清楚记录受支持认证模式、未支持能力和测试环境；不将 mock 通过计为生产联调通过。
- npm 名称可用、组织发布权限与仓库发布流程已核验。

发布是独立动作。用户已授权提交和推送；尚未要求 npm 发布。

## v0.2 及后续

按实际业务价值排序：

1. CinaAuth 标准 OAuth 设备授权与 CLI 管理权限；各产品单点登录接入。
2. CinaShop 多店铺/供应商的服务端资源隔离及常用写操作。
3. CinaToken 受限管理操作、模型调用、额度/费用展示和流式输出。
4. CinaSeek 工作区操作、Agent 任务提交、结果订阅和取消。
5. CinaChain NFT 索引读取，之后再设计钱包签名与交易发送。
6. 跨产品工作流；写操作失败补偿、恢复和审计按具体业务定义。

每个写命令先确定认证、影响范围、幂等和预览契约，再接入公共框架。新增产品时复用相同注册和适配接口。

## 当前交付记录

- 已核实 GitHub 上新建的 `cinagroup/cinacli` 空仓库，并克隆到本地工作目录。
- 已完成五产品源码接入核查、命令设计、认证边界和实施路线图。
- 初始设计文档提交已推送，首批实现为 M0 公共框架，未修改五个产品仓库。
- M0、M1 与 M2 首批 alpha.3 三平台 CI 通过；Seek 接入后的 alpha.4 本地测试扩展为 45 项，安装包提供 24 条命令。
- M1 已实现 Token 三项业务读取、两类 key 的验证保存与本机退出，以及 Chain 状态/原生余额查询；公开 Chain RPC 联调通过。
- M2 已交付 Auth status、PKCE 登录/身份/刷新/退出、Shop 读取与会话管理、Seek gatekeeper 登录和独立会话读取。Auth 真实浏览器登录及 Token/Shop/Seek 真实认证验收继续推进，五产品联合运行尚未完成。
