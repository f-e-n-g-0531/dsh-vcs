# Amend确认结果恢复

Amend改写当前tip历史。已发送确认后关闭／取消／切换仓库不证明服务器未替换引用；必须在仓库级保留unknown并阻止全部八类确认，显式刷新后核对HEAD／Index再准备。

响应只有head／ref／tree／indexDigest与固定预览完全相符才成功。错误／不匹配不自动重发token、不reset／revert／force-push／GC，可能留下追加对象。

普通新commit与amend表单保持独立，不能用normalcommit结果替代amend成功或用amend token跨接口。
