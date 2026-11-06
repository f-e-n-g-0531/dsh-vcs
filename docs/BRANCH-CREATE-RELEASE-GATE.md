# 创建分支候选发布边界

隔离组件／浏览器通过只验证构建候选，不自动安装日常profile或重启DSH。正式liveGUI验收应使用现有服务URL刷新与已安装artifact核对，而非另起server。

完整Fork对齐还含删除分支、任意起点创建、detachedcheckout、tag操作、remote／stash／merge／rebase等；只从当前HEAD创建不能冒称所有分支管理已对齐。

当前caseportable／packedrefs／hooks等保守限制与外部竞争观察窗口必须保留用户提示。
