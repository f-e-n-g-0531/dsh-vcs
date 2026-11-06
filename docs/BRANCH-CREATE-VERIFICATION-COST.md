# 分支创建验证成本与安全边界

状态：分支创建验证优化已实现并完成针对性验收，15秒预算不变。

原apply每次facts调用完整readLatestCommit，重复Git config／facts／check-ref-format／cat-file。优化必须保留fresh effectiveglobal配置、rawHEAD/currentref、原始metadata与closing屏障，不能只看localconfig不变。

branch-create capture原只refs/logs，因此替代publicreader时须补全objects／hooks／index等metadata原始基线，避免性能改动反而漏检原来每reader检查的状态。

实际SHA1／SHA256 apply均22 Git启动（config11／revparse5／checkref2／catfile3／update1），未伪称测过旧baseline耗时。新鲜度19/19、既有preview70＋confirm51项121/121、独立real／globalconfig／Host3/3通过，静态复核无当前范围确认缺陷。测试初revparse计数4vs5与Windows readonlyobject fixture修正已保留过程。

默认全量先前3272项13失败保留，单个优化通过不宣布整体默认全量修复。
