# Commit RPC独立验收

- prepare严格descriptor snapshot在首次await／Session lookup前，identity字段完整且仅四项、message有界精确；getter不执行，发送后改caller对象不改已绑定预览。
- confirm严格token-only，无message／author／ref／OID替换；固定commit kind与所有Index／branch tokens双向隔离。
- 授权grant／cwd／Session／repo对象绑定，TTL／容量／过期／replay／revocation，dispose清空；Gitonly拒绝SVN。
- prepare持readlock无writes；confirm共用writer锁与其他读写互斥，释放finally，历史cache失效。
- 所有poststart unknown在inner／outer都优先于cancel／timeout；不要把确定成功后outerlifetime失败报clean cancel。
- 真实默认Host临时Git staged tree提交一次，rawIndex和不同Work保持，token重放拒绝。
- 打包包括commit preview／publisher／typedstore／refCAS／五个puremodel依赖，安装stub通过不等于当前GUI更新。
