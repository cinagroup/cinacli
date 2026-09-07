# 版本与发布流程

当前为未发布的 `0.1.0-alpha.5`。本仓库 CI 只验证并上传安装包，不调用 npm publish，也不申请 npm 写权限。

## 已核验与待满足条件

2026-09-07，`pnpm view @cinagroup/cli version --registry=https://registry.npmjs.org` 的无认证查询返回 404；这只说明未读到公开包，不证明 npm scope 可用或当前用户拥有发布权限。同日 `pnpm whoami --registry=https://registry.npmjs.org` 返回未登录。GitHub 仓库写权限不能代替 npm 组织权限。

发布前由组织维护者确认 npm 账号、`@cinagroup` 的发布权限、目标版本是否存在及包的访问策略。用户已明确选择 Apache-2.0，仓库和安装包包含官方 LICENSE 全文，package.json 声明同一许可证，安装包验证会核对一致性。真实产品验收条件见[支持矩阵](support.md)；稳定 v0.1 必须完成五产品联合验收。若明确只发布 alpha，应在发布说明中保留未验收状态。

## 准备一个版本

1. 在 package.json 中明确修改版本，并同步 CHANGELOG、安装说明和支持矩阵。当前发布前准备继续使用 alpha.5，不因文档变动重复消耗未发布版本号。
2. 运行 `pnpm schema:update`，审查 `docs/schema.json` 中命令、字段、scope、读写性质及错误契约的变化。快照包含 CLI 版本，不含配置或凭据。`pnpm check` 会拒绝未同步的快照。
3. 执行以下验证，审查 Git diff，提交推送到 main。保持支持矩阵中的真实验收状态准确。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test:package
pnpm test:keyring
```

`test:package` 先创建 tarball，核对允许文件清单，再离线安装它并运行命令、检查随包 schema、执行 OAuth 协议测试。通过后生成 `artifacts/SHA256SUMS` 和 `artifacts/package-manifest.json`，记录摘要、文件清单、CLI 版本与测试平台。清单不是生产认证证明。

4. 确认目标提交的 Windows/macOS/Ubuntu CI 全部成功。CI 的 Ubuntu job 在原生凭据库验证通过后上传 `cinacli-package-<commit>`，保留 14 天。PR artifact 仅供评审；发布应使用已审核 main 提交。校验下载包的 SHA256，记录目标提交和运行链接。

## 获得明确发布授权之后

先完成上述待满足条件，并确定具体版本、公开/私有策略和 dist-tag。预览版显式使用 `alpha`，不得让默认 `latest` 指向尚未完成验收的版本。以下只是维护者在获得发布授权后使用的命令示例，仓库流水线不会执行它：

```sh
pnpm publish artifacts/cinagroup-cli-0.1.0-alpha.5.tgz --access public --tag alpha --registry=https://registry.npmjs.org
```

命令支持 tarball、access 和 tag，参见 [pnpm publish](https://pnpm.io/cli/publish)。发布前再次核对摘要；不要在验证后重新构建并发布另一份未验证的包。若改动 LICENSE 等包内文件，应重新打包验证。

后续可以配置 [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)，将发布身份绑定到明确的 GitHub 仓库、workflow 和环境；只有维护者完成 npm 侧配置与权限验证后才启用发布 job。当前不声称该配置已存在，也不把私有 npm token 写进仓库。发布之后再核对 registry 中的版本、dist-tag 与完整性信息，并安装 registry 中的确切版本抽样验证。

## 失败或回退

发布前失败：保留日志并修复，不发布失败构建。发布响应不确定：先只读查询确切版本，不盲目重复 publish。已发布版本不覆盖；发现问题时准备新版本，并由维护者决定是否撤回 dist-tag 或标记弃用。更改 registry 状态和 npm 发布均是独立授权动作。
