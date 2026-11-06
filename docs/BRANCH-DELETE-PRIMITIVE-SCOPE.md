# 固定old-OID本地分支删除原语

状态：内部条件删除已实现并通过独立真实仓库验证，无Host／RPC／UI。

仅精确非当前refs/heads目标和预期OID，Git no-deref条件删除；原语只做引用条件更新，不证明目标已合并，调用方须持共享writer并验证安全预览／用户确认。

不自动force或checkout，固定HEAD／当前tip与Index metadata保持，禁用事务hook。开始后失败unknown，不重试／回滚／重建引用或删竞争分支；只清owned空hooks目录。

独立真实Git golden保持HEAD／rawIndex／不同Work／objects并删除目标ref通过；installed Git symbolic no-deref删除实际保留destination但可删rawsymbolic条目，详见[实测竞争语义](<BRANCH-DELETE-RAW-REF-RACE.md>)，不当作身份CAS。最终专用91＋独立preservation／symbolic characterization组合93/93通过；静态复核无当前内部范围额外缺陷。首轮全量2368/2369，仅metadata2万项拒绝在负载下先达到15s导致错误类型断言失败；已在遍历前检查fanout上限，不延长预算，保留失败记录。修正后默认全量2460/2460通过，无失败／取消／跳过／todo（499秒）。

外部ref替换、目录交换与ABA不属全局原子隔离，Git oldOID条件不冒称原始文件身份CAS。实际symbolic竞争语义需临时仓库实测，不凭静态推断宣称保证。
