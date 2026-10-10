# v0.3.37 历史文件预览发布记录

> 历史记录：只描述标题中的版本，不是当前安装或功能指南。首次使用请看[项目说明](<../README.md>)。

固定源码：`e2923f31dc600953077a8cda8e92fdd7aeaacd92`。

- 本地构建、208/208 测试、19 文件包校验、生产依赖安装通过。
- [四平台标签 CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36682177039)通过：Windows/Ubuntu × Node22/24。
- [同标签隔离 Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36682179443)通过。
- 第213轮下载全部四个CI工件，tarball 均778397字节，与本地候选SHA256一致：

```text
35633c0d31b38446b4d9c2374708bd16d932fccd7aa4fdf740986fe92a6d5e28
```

| 平台 | Artifact ID |
|---|---|
| Ubuntu Node22 | 11081954330 |
| Ubuntu Node24 | 11082545989 |
| Windows Node22 | 11081409575 |
| Windows Node24 | 11082024363 |

本候选包含历史目录筛选、普通文件只读预览、提交详情身份隔离。依然不跟随链接/子模块、不自动fetch、不写工作区。

第265轮用户明确选择“现在正式发布，明确披露未验收项”。

[发布工作流](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36692673747)成功，[GitHub Release](https://github.com/f-e-n-g-0531/dsh-vcs/releases/tag/v0.3.37)已创建，下载tgz的SHA256与上述候选一致。

首次核验遇到npm传播延迟；第266轮确认npm latest为0.3.37，npm与GitHub下载包均778397字节，SHA256均与上述冻结候选一致，发布的SHA256SUMS也匹配。

GitHub draft=false、prerelease=false；本阶段正式发布及工件一致性核验已完成。

真实GUI验收仍待完成，发布说明已披露。未安装或重启，当前安装仍为0.3.36。后续main的提交图路由与SVN离线基础均不包含在此冻结版本中。
