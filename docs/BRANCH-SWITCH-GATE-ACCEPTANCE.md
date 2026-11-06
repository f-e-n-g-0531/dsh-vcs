# 切换分支共享门禁验收

- Parent统一十类confirm同步pending／unknown引用；已保存旧handler同时调用只有一个底层确认。
- Switch read／prepare／confirm均检查当前props与uncertain，unknown跨mode／repo／focus保持，刷新仅清当前repo。
- confirm已发出后cancel／scope／unmount先markUnknown，late成功不得清门禁或触发onSwitched。
- prepare取消只是只读，旧preview不再可用；replacement候选不可被旧confirm闭包消费。
- 成功仍逐OID/ref匹配目标，后端切换工作区guard不变，不增加force或dirty checkout支持。
