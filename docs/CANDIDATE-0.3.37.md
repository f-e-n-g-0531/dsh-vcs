# v0.3.37 历史文件预览候选（未发布）

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

未公开发布、未安装或重启，当前安装仍为0.3.36。真实GUI验收仍待完成，旧版正常打开的用户反馈不是本候选验收。发布需满足验收门槛，或用户明确授权本候选提前发布。
