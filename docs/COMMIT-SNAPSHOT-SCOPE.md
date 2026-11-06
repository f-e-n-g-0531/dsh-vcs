# 私有提交快照与一次性复验

状态：内部只读能力绑定已实现并验证，不执行对象发布或ref更新。

公开prepareCommitPreview摘要仍无正文Buffer。完整captured plan／repo identity／rawIndex／HEAD／config fingerprint仅存进程内WeakMap；克隆或伪造摘要没有权限。

consumeCommitPreview仅一次消费并复验实际状态，先消费再callback／await；错repo、撤权、取消、陈旧Index／HEAD／config均拒绝且不可重放。只返回安全摘要，不把内部对象图交给调用方。

独立真实Git golden1/1通过：spread克隆摘要不能复验，原始issued摘要单次消费成功，再次消费拒绝；Index／Work／objects／HEAD保持。新增capability33/33与旧preview＋独立golden37/37通过；独立静态复核无当前范围确认缺陷。最后授权回调后再capture，Index／HEAD／config／metadata突变拒绝；stalled auth受共享deadline限制。最终capability37项均通过（初33＋新增4独立），稳定源码npm默认全量1556/1556通过，无失败／取消／跳过／todo（383.4秒）。

这不是用户commit API，也不连接对象追加或refCAS；读取Work名称／类型政策不等于绑定Work内容，提交内容仍仅Index。后续实际写入必须在同一个受控事务里复验、持writer门禁并处理追加副作用与ref未知结果。
