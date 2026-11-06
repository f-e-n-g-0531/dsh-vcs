# 普通分支删除只读仓库预览

状态：内部预览已实现并通过独立真实仓库验证，不删除引用，无force／RPC／UI。

固定current HEAD与target loose ref，沿两端完整parent图读取原始commit并独立hash核验，再生成merged证明。目标为当前分支或case别名、未合并、不完整、超限或不支持对象均拒绝。

图上限10000节点／每body2MiB／合计16MiB，共享15秒预算；严格header使签名历史暂不支持。两次HEAD／配置／完整metadata观察拒绝可见变化，但不保证外部并发原子性。

独立real Git golden1/1通过：actual祖先proof成立且目标ref保留，rawIndex／对象／refs目录不变；与纯图认证／判定组合147/147通过。完整模块85/85通过。复核发现缺失name时可能读取Object.prototype继承值，已改null-prototype capture，独立getter0次回归通过；最终模块＋独立真实祖先／own-name golden87/87通过。默认全量捕获2363/2363通过，无失败／取消／跳过／todo；后新增专用测试及capture硬化以单独完整回归为准，不虚增全量覆盖。

Work／Index正文不读，无临时锁／对象／ref写入，返回proof不授予删除权限。
