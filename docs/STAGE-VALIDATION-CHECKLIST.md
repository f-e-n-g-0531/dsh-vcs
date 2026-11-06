# Stage内部验证清单

Stage仍未作为用户功能开放。以下不是完成声明，而是适配器接入前的独立判据。

- 区分mutationStarted（第一次对象追加）与indexPublishStarted（准备rename Index）。对象追加后不能用started=true跳过Index发布前的完整状态复验。
- 对象存储回调只检查授权／取消，不能在自有temp或双链接窗口运行禁止多链接的整元数据扫描；退出后临时清理及最终对象验证完成才做完整复验。
- 自有对象差异只允许目标精确OID文件，以及原先确实不存在的fanout目录。所有原有metadata rows保持，未选对象、config、refs、HEAD变化都拒绝。
- 原有同OID文件也要验证，不能因属于目标路径就豁免其身份／内容变化。EEXIST竞争者添加正确目标可视明确允许的差异，但不能允许同fanout的其他新对象。
- 工作文件、完整Index、HEAD、配置及root身份在对象追加后的授权回调后仍复验；追加后失败允许孤儿blob但Index保持，返回未知、不回滚。
- SHA1／SHA256、CRLF／NUL／非法UTF8原始字节及无末行换行应按精确blob哈希验证；无filter／EOL转换支持边界明确。
- 选中MM拒绝，其他文件MM保留；stage／unstage快照和token不能互换。
- 最终publish后的Index tuple与其他条目语义、全部工作字节保持，异常仍unknown，ambient budget沿全部FS边界。

独立同OID并发压力已从2增加到8个写者：可保守拒绝竞争中的写者，但至少一个成功、最终对象正确且single-link，无自有temp泄漏；不要求并发全部成功。
