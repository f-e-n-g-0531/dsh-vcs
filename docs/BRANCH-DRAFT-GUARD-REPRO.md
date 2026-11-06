# 分支草稿旧handler复现

独立memory UI golden捕获draftA prepare／cancel，编辑到B后调用旧prepare，观察底层RPC1次而预期0次，断言1!==0明确复现。此为旧闭包提交旧name，不是后端授权绕过；仍须防止UI错误候选和误清新候选。

修复需generation＋same-value强制rerender＋currentcontroller响应检查，保留原confirm／ack身份与unknown语义，不能只隐藏按钮或删除测试。
