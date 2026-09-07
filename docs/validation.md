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

M1 Windows 本地类型检查、构建和 29 项测试通过。实际安装 `artifacts/cinagroup-cli-0.1.0-alpha.2.tgz` 后，离线命令、Chain 余额、Token 账户及 stdin 导入验证通过；包包含 26 个允许发布的文件。原生系统凭据库的合成凭据保存、读取和删除也通过。跨平台结果以对应提交 CI 为准；CI 不调用公开产品服务。

Token 的真实 Gateway / Management 认证联调尚未完成，等待部署 endpoint 和独立测试密钥。Auth、Shop、Seek 尚未实现或联调；没有五产品联合验收或 npm 发布。
