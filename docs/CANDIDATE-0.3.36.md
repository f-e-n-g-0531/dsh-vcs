# v0.3.36 兼容候选核验（候选阶段记录）

> 历史记录：只描述标题中的版本，不是当前安装或功能指南。首次使用请看[项目说明](<../README.md>)。

- 固定标签源码：`cf5d9f98afc082ced0fc087e4d1f0b2fe7d47538`。
- peer 范围：`0.1.7-rc.2 || 0.2.0-rc.2`。
- 本地 205/205、构建、19 文件包校验及生产依赖安装通过。
- 真实 0.2.0-rc.2 Cordis/Connection 与 SlotRegistry 隔离测试通过；测试认证/Session/外壳，不等于真实 GUI。
- [四平台标签 CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36675793383)全部通过。
- [同标签 Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36675796099)通过，模拟 RPC。

## 下载核验

第 193 轮从上述 CI 下载四个 artifact，tarball 均 777493 字节，SHA-256 均与本地候选安装测试一致：

```text
e9b1b1d88ebb53c7cf23efa667174123c30a90db5c171f1f3961f3eba07acdd0
```

| Artifact | ID |
|---|---|
| ubuntu-latest-node-22 | 11080360668 |
| ubuntu-latest-node-24 | 11080335712 |
| windows-latest-node-22 | 11079633137 |
| windows-latest-node-24 | 11080165966 |

候选阶段状态：未执行 npm/GitHub 正式发布，未升级当前 profile 或重启。0.3.35 的已有安装不会因候选完成自动解除拒载。真实 GUI 验收及正式发布门槛仍待处理，不将 0.3.35 的提前发布授权外推为永久豁免。

最终发布结果见[0.3.36正式发布记录](<RELEASE-0.3.36.md>)；以上未完成状态指候选阶段。
