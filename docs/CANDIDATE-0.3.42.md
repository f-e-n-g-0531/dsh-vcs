# 0.3.42 文件历史同路径导航正式发布记录

冻结范围：点击路径历史中的提交，默认父提交/根空树差异存在唯一精确同路径时自动选择详情返回的不透明文件ID，复用现有Diff RPC。无匹配仅显示详情，不猜测重命名、不探测其他父提交。导航提示只消费一次，同OID显式导航重新加载详情；后续搜索/父切换不重新套用提示。

- 实现：5f8a7af、783131f；同OID/搜索回归310302b；未匹配/父切换7aed806。
- [最后功能Chrome回归](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36708962008)通过。中英文范围说明已更新，最终标签Chrome也已通过。
- 第319轮全量247/247通过；19文件包校验、生产依赖临时安装/stub注册通过，非真实宿主安装。
- 本地候选SHA256：`e1e56d5f0923458cf62672df9b869733157e7b6eeeb604c7ad5252c53b418b64`。
- 固定标签v0.3.42源码：`773200eb5cd9063d67f916ab26512284fd3b2d1a`。[四平台标签CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36709412521)、[同标签Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36709480208)成功。
- 四平台Artifact：Windows22=11094125108、Windows24=11093781653、Ubuntu22=11093715905、Ubuntu24=11092819877；全部779034字节且SHA256与本地一致。
- 第320轮按持续授权执行[正式发布工作流](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36709909596)成功；[GitHub正式版](https://github.com/f-e-n-g-0531/dsh-vcs/releases/tag/v0.3.42)非草稿/非预发布，已披露真实GUI未验收。
- npm短暂传播延迟后确认latest=0.3.42，未重复发布。实际下载npm/GitHub包均779034字节、SHA256与四平台候选一致；第321轮读取发布SHA256SUMS也一致。不移动既有标签。
- 真实GUI未验收，不安装、不重启。后续实际GUI需核对版本、跳转文件与OID、默认父、同OID重入、未命中、搜索/父切换及Session隔离；隔离测试不替代这些证据。
