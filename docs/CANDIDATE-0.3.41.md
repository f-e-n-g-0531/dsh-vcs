# 0.3.41 A/B选项分组正式发布记录

> 历史记录：只描述标题中的版本，不是当前安装或功能指南。首次使用请看[项目说明](<../README.md>)。

冻结范围：A/B选择器使用中英文optgroup区分已加载提交与本地分支/标签，保留同OID多个引用及引用刷新后的固定OID回退选项。不新增自动请求、网络操作或SVN历史。

- 功能f7bf9b2，双语/重复OID测试bab2d0e；[隔离Chrome通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36705384086)。
- 第305轮全量245/245、19文件包校验、临时生产安装/stub注册通过。
- 本地SHA256：`67b03567f27753027169e2bdd9dc218f3310e3df79bfd551526d336805f84503`。
- 第306轮[四平台标签CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36705771442)及[同标签Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36705834688)成功；四份包均778717字节且SHA256一致。

Artifact ID：Windows22=11091986905、Windows24=11091698559、Ubuntu22=11091618466、Ubuntu24=11091458894。
- 按持续授权完成[发布工作流](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36706305980)；GitHub v0.3.41非草稿、非预发布，npm latest为0.3.41。实际下载两端包均778717字节，上述SHA256与候选和SHA256SUMS一致。
- 真实DSH GUI未验收；发布说明已披露，不安装、不重启。当前正式版0.3.41。

真实验收待后续授权安装：核对实际页面版本、中英文分组、键盘选择、同OID分支/标签、引用移动/清空后固定比较、Session切换清除选择。隔离组件和stub宿主结果不能替代真实GUI。
