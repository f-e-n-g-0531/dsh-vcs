# Tag存储的opaque语义

存储接受显式type tag及有界body字节，包括纯opaque测试内容；成功只表示Git对象framing／hash／压缩发布有效，不表示tag header或目标存在合法。

必须由上层先encode／parseVerifiedGitTag并认证目标commit，随后才可发布refs/tags；禁止把storeCapturedObject成功作为标签创建成功。

append-only写失败可留下不可达对象，不自动GC／rollback；本轮没有对象与标签ref原子事务或用户入口。
