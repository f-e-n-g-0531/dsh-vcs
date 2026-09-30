# v0.3.36 正式发布核验

用户明确要求正式发布，真实 GUI 尚未验收的例外已写入 Release。

- 源码标签 cf5d9f98afc082ced0fc087e4d1f0b2fe7d47538；未移动标签。
- [发布工作流](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36676850286)成功，npm 与 GitHub 发布步骤均 success。
- [GitHub 正式 Release](https://github.com/f-e-n-g-0531/dsh-vcs/releases/tag/v0.3.36)已确认非草稿、非预发布，安装包可下载。
- npm 版本元数据已可查询，latest=0.3.36。GitHub 安装包 SHA512 与 npm dist.integrity 相同。
- GitHub 包 SHA256 与候选四平台及 SHA256SUMS.txt 一致：`e9b1b1d88ebb53c7cf23efa667174123c30a90db5c171f1f3961f3eba07acdd0`。
- 但本次核验时 npm dist.tarball 直接下载及 npm pack 仍返回 404；有限重试后仍未恢复。不能宣称 npm 安装可用或已完成两端下载比对。没有重复发布。

声明精确支持 DSH 0.1.7-rc.2 和 0.2.0-rc.2。没有安装到当前 profile，没有重启。后续需复查 npm tarball 可下载性并完成真实 GUI 验收。
