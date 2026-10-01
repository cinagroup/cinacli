# CINA Windows 路径验证

本切片基于 `476d8699bc94d88512640ad481fb5994359c1acc`，仅修复独立
CINA runner 的 Windows 路径兼容与对应契约。七项目的代表性工程验证范围仍以
[覆盖记录](cina-phase-one-coverage.md)为准，不能据此宣称全部业务或部署验收完成。

## 已复现的问题

`7650a118` 的 Windows CI 在 19 个文件的格式检查失败。随后 `476d8699`
通过 `.gitattributes` 固定 CINA 文件为 LF；该版本 Windows CI 的 lint、类型和
格式检查通过，但契约为 41 pass / 12 fail，打包步骤没有运行。

失败日志显示临时目录的 `RUNNER~1` 短路径与 `runneradmin` 长路径参与了不同的
比较。使用本机已有 NTFS 短名称 `RUNNER~2`，将归档的未修改 `476d8699` 包的
`TMP`、`TEMP` 指向同一个真实目录，独立复现了 41 pass / 12 fail，零 skip。
没有更改全局短名称、Git 或系统设置。

- [真实短路径映射](../../validation/20261001-windows-native-short-path.json)
- [未修改版本短路径契约日志](../../validation/20261001-windows-short-baseline.log)
- [上一轮 Windows CI 失败日志](../../validation/20261001-pr1-lf-windows-failed.log)

最初手建别名目录的实验发生了别名冲突，临时目录不可用；该次 ENOENT 结果只作为
实验记录保留，不计入产品失败或验收证据。

## 最小修复

`shimPointsTo` 先取得 shim 所在目录的实际路径，再计算它到已经解析的工具入口
的相对路径。`validatePackageScript` 先取得任务目录的实际路径，再检查隔离缓存、
全局配置与 package.json。原有根目录 containment、越界链接、脚本漂移、生命周期
钩子、工具版本和凭据隔离约束保留。

七处测试预期使用实际路径；fixture、任务 cwd 与 PATH 输入保持原始路径，避免
把兼容问题隐藏在测试初始化中。新增一个契约通过别名根实际执行安全的 npm/pnpm
本地任务，并确认缓存链接到项目根外时返回结构化 invalid、exitCode 2、零执行。
Windows 使用测试自建 junction，其他平台使用目录链接；该契约没有平台 skip。

## 最终验证记录

最终 runner 与契约文件已经冻结，使用现有工具、最小环境及容量保护运行：

| 检查                                            | 实际结果                          |
| ----------------------------------------------- | --------------------------------- |
| Node 22.23.3 `node --test`                      | 54/54 pass，零 fail / skip        |
| Node 24.19.0 `node --test`                      | 54/54 pass，零 fail / skip        |
| Node 22.23.3、真实短名称 TMP/TEMP `node --test` | 54/54 pass，零 fail / skip        |
| 锁定 pnpm 12.6.0 `check:cina`                   | lint、类型、19 文件格式检查均通过 |

- [三组完整契约与 CINA 质量检查记录](../../validation/20261001-windows-local-contracts.json)
- [修复版本实际短路径日志](../../validation/20261001-windows-short-fixed.log)
- [Node 22 完整日志](../../validation/20261001-windows-node22-contracts.log)
- [Node 24 完整日志](../../validation/20261001-windows-node24-contracts.log)

根 `pnpm check`、最终提交、独立打包和远端 CI 的确切结果由交付包的最终结果记录
保存。本文不会把之前失败版本的 Windows 打包标成通过。发布、部署、远端合并、
自动合并和凭据修改不属于本切片。
