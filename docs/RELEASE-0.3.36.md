# v0.3.36 正式发布核验

> 历史记录：只描述标题中的版本，不是当前安装或功能指南。首次使用请看[项目说明](<../README.md>)。

用户明确要求正式发布，真实 GUI 尚未验收的例外已写入 Release。

- 源码标签 cf5d9f98afc082ced0fc087e4d1f0b2fe7d47538；未移动标签。
- [发布工作流](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36676850286)成功，npm 与 GitHub 发布步骤均 success。
- [GitHub 正式 Release](https://github.com/f-e-n-g-0531/dsh-vcs/releases/tag/v0.3.36)已确认非草稿、非预发布，安装包可下载。
- npm 版本元数据已可查询，latest=0.3.36。GitHub 安装包 SHA512 与 npm dist.integrity 相同。
- GitHub 包 SHA256 与候选四平台及 SHA256SUMS.txt 一致：`e9b1b1d88ebb53c7cf23efa667174123c30a90db5c171f1f3961f3eba07acdd0`。
- 初次核验时 npm 下载返回 404。发布日志明确提示包正在处理；后续 npm pack @feng0531/dsh-vcs@0.3.36 --ignore-scripts 已下载成功，SHA256 与 GitHub 及候选包一致。两端下载核验现已完成，没有重复发布。

声明精确支持 DSH 0.1.7-rc.2 和 0.2.0-rc.2。没有安装到当前 profile，没有重启。后续仍需完成实际安装加载与真实 GUI 验收。
