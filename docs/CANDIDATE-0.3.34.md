# 0.3.34 候选验证记录

- 标签：v0.3.34；源码：37d15a6b88c17c689098831074f4838f49b6cb31。
- [标签 CI 36574878726](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36574878726)：Windows/Ubuntu × Node 22/24 四个任务均成功。
- 第 169/200 轮下载四个 CI artifact，分别计算内部 npm tarball 的 SHA-256；四包逐字节摘要一致。这里不是 artifact ZIP 自身的摘要。

| 环境 | Artifact ID | 包字节数 |
| --- | --- | --- |
| Windows Node 22 | 11037645266 | 777458 |
| Windows Node 24 | 11036774866 | 777458 |
| Ubuntu Node 22 | 11036743933 | 777458 |
| Ubuntu Node 24 | 11036514524 | 777458 |

包名：`feng0531-dsh-vcs-0.3.34.tgz`

共同 SHA-256：

```text
c536ea98ff20b241aa1c8b3b836819418c0d08fa92958773b6256cb685bc0b92
```

候选包含历史导航、完整说明和本地分支/标签固定 OID 选择；[隔离 Chrome 功能回归](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36574322032)针对 d8d0173，标签提交随后仅修改版本和说明元数据。

## 仍未完成

- [真实 DSH GUI 验收](<LIVE-ACCEPTANCE.md>)：实际加载构建、操作、截图和控制台证据仍未取得。
- 未触发正式发布；上述四包一致性不代表 npm 与 GitHub Release 工件一致性，后者应在获准发布后单独核验。
- 已发布基线仍为 0.3.23，不能把候选 CI 成功标记为整体目标完成。
