# 实测删除原始引用竞争语义

Git2.56.0.windows.4实际验证：update-ref --no-deref -d ref expectedOID会删除指向相同expectedOID的symbolic ref条目，但不删除其destination。oldOID是解析OID条件，不是原始direct-ref类型／inode CAS。

因此前置拒绝symbolic目标不能保证普通外部进程在最后检查后替换symbolic条目仍被拒绝；不能宣称所有竞争目标必保留。初次characterization错误预期“Git拒绝symref”真实失败，按实测修正记录，不把该差异藏成成功保证。

当前内部原语在无外部ref类型替换的可信并发范围内使用，未来一般用户删除协议须明确解决或披露此窗口，不能自动重建ref／删destination或force来恢复。无Host／RPC／UI。
