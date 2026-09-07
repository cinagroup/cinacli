# 安装与升级

当前版本：`0.1.0-alpha.5`。尚未发布 npm 包；不要把 `pnpm add -g @cinagroup/cli` 视为当前可用的安装方式。

## 环境要求

使用 Node.js 24.x（最低 24.14.1）和 pnpm 11.19.0。Windows、macOS、Ubuntu 的安装包启动、协议测试和原生凭据库均纳入 CI；浏览器授权的真实用户验收单独记录在[支持矩阵](support.md)。

持久登录需要 Windows Credential Manager、macOS Keychain 或已解锁的 Linux Secret Service。系统凭据库模块为可选依赖，请勿用 `--no-optional` 排除它；不可用时不会写入明文文件。Token/Shop/Seek 可通过各自显式环境变量临时认证；Auth 的 `login --no-store` 仅验证并丢弃会话，不能用于后续身份读取。

## 从源码运行

```sh
git clone https://github.com/cinagroup/cinacli.git
cd cinacli
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/bin.js --version
node dist/bin.js schema --json
```

生产脚本应固定已审核的 Git 提交，不跟随浮动 main。初次安装依赖需要网络；`--offline` 仅适用于所需依赖已在 pnpm store 中的环境。CI 在同一运行中先安装依赖、再离线安装 tarball，不表示包已包含全部依赖。

## 安装已验证 tarball

可自行执行 `pnpm check`、`pnpm test:package` 生成 `artifacts/cinagroup-cli-0.1.0-alpha.5.tgz`。也可以从仓库 Actions 中下载对应提交的 `cinacli-package-<commit>` artifact；须确认该提交整个三平台 CI 成功，不能仅凭 artifact 存在判断。

解压 CI artifact 后会得到 tarball、`SHA256SUMS` 和 `package-manifest.json`。Linux 使用 `sha256sum -c SHA256SUMS`，macOS 使用 `shasum -a 256 -c SHA256SUMS`。PowerShell 可将下列输出与 `SHA256SUMS` 中对应摘要比较：

```powershell
(Get-FileHash ./cinagroup-cli-0.1.0-alpha.5.tgz -Algorithm SHA256).Hash.ToLower()
```

摘要校验用于发现文件变化；还需从正确仓库、正确提交的 CI 下载。不同操作系统或重新打包的压缩包摘要可能不同，以所下载产物的记录为准。

在专用工具目录初始化一个项目，然后安装 tarball 的实际路径：

```sh
pnpm init
pnpm add /absolute/path/cinagroup-cli-0.1.0-alpha.5.tgz --ignore-scripts
pnpm exec cina --version
pnpm exec cina schema --json
```

Windows 使用实际绝对路径，例如 `C:/Downloads/cinagroup-cli-0.1.0-alpha.5.tgz`。路径有空格时加引号。如果已配置 pnpm 全局 bin 目录，也可用 `pnpm add -g <tarball路径> --ignore-scripts` 安装，之后直接运行 `cina`。本仓库不会替用户改变全局 PATH。

## 首次配置与调用

以下以 `cina` 表示所选安装方式；本地项目可替换成 `pnpm exec cina`，源码可替换成 `node dist/bin.js`。

```sh
cina context create staging
cina context use staging
cina config set chain.endpoint https://rpc-proxy.cinachain.com
cina config set chain.chainId 84532
cina chain status --json
```

该 Chain 公开测试网端点已有真实读取记录；实时结果随链变化。其他产品需分别准备[Auth/Shop](auth-shop.md)、[Token](token-chain.md) 和 [Seek](seek.md) 所需配置。一次 Auth 登录不会自动授权其他产品。

## 升级与卸载

升级时安装新的已验证 tarball 并核对 `cina --version`。先阅读 [CHANGELOG](../CHANGELOG.md) 和新版本 schema；0.x 版本也可能调整命令和输出。不要把较早的 alpha 安装包误当作稳定版。

移除本地项目安装使用 `pnpm remove @cinagroup/cli`；全局安装使用 `pnpm remove -g @cinagroup/cli`。卸载软件包不清除配置或系统凭据。需要清除当前会话时先按产品执行 `cina logout --product <product>`；旧配置修订和异常中断产生的孤立分块尚无统一自动清理命令，见[Auth 保存与退出](auth-shop.md)。
