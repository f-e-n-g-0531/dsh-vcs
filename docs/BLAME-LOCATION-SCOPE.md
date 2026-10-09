# Blame精确定位冻结范围

以0.3.56为基线：固定commit/opaque change ID重新验证，500行窗口、startLine最大100001，非累积表格，前后页取消旧请求。来源路径按Git line-porcelain filename解码（C quoted/octal UTF8），来源commit/path/originalLine独立按钮打开现有tree-file只读预览；树路径重新验证，不访问工作区或外部路径。高级单版本Monaco选择整行并居中；缺失路径/无正文/超出行数明确不能精确定位。原提交详情跳转保留，不冒充行定位。

已通过真实1002行分页及工作区修改隔离、quoted Unicode解析，构建通过。待真实重命名来源/插入行映射、RPC严格窗口、浏览器选中行/分页/取消/失败及全量门禁后冻结发布，不安装不重启。
