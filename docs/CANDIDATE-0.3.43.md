# 0.3.43 Blame提交导航正式发布记录

冻结范围：Blame归属提交OID可点击进入详情，复用现有提交回调，仅传OID。不自动定位历史文件或行号，不新增RPC；同OID显式导航重置默认父提交和旧选择。无回调保持文本，双语提示范围。

- 实现00a8dec、34e4b29，文案4242fba；[双语与集成Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36711755979)通过。
- 两次中间Chrome超时由测试复用旧DOM导致，267474b与ea3aad7修正等待同步；修正后通过，不忽略失败。
- 第329轮全量247/247、19文件包校验、临时生产依赖安装/stub注册通过。不是现有宿主安装或真实GUI验收。
- 本地候选SHA256：`da20ca4982d48366d95f0ccc4aaf1825607d0bbdcc535db333369adcf540eb27`。
- 固定源码e24636936cac9e4a90939d83ed4f34df495d76ea；[四平台标签CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36712186128)与[同标签Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36712259411)成功，中断恢复后核实已有结果，未重复触发。
- 四平台Artifact：Windows24=11095630054、Ubuntu22=11094870298、Windows22=11094484078、Ubuntu24=11094169472；均779228字节且SHA256与本地一致。
- 按持续授权完成[发布工作流](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36712769009)；GitHub v0.3.43非草稿/非预发布，说明已披露真实GUI未验收，npm latest=0.3.43。
- 实际下载npm/GitHub包均779228字节，上述SHA256与四平台候选及发布SHA256SUMS一致。不移动既有标签。
- 真实GUI待验：版本/资源身份、Tab及Enter/Space、同提交和不同提交导航、父重置、不自动打开Diff、取消/Session隔离。现有点击测试不作为原生键盘或真实GUI证据。
- 不安装、不重启，发布必须披露真实GUI未验收。
