# 内部确认提交事务验收

- 快照先consume，不接受公开summary克隆／替代plan、跨repo或重复。
- 本进程writer门禁和授权贯穿，旧Index与HEAD／配置基线保持；对象发布后只允许exact created对象和对应fanout元数据差异。
- 不将fresh全metadata替换baseline，不容忍外来对象／旧对象变化；若追加后发现异常应unknown并保留对象，禁止refCAS。
- 引用CAS用固定oldOID且禁hook；post-ref允许精确branch／HEAD reflog行变化，其余元数据与rawIndex不变。
- 开始后取消／撤权／CAS拒绝均unknown，不重试／回滚；只有完全核对新commit／tree／parent与原Index后才成功。
- 无跨HEAD／Index／ref外部竞争全局原子性承诺；Work正文不读不写，初期保守拒绝一般配置或signedparent。
