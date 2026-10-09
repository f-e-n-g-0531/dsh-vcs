# 0.3.57 Blame历史行定位与分页

冻结BLAME-LOCATION-SCOPE：固定commit/id，500行窗口、最大startLine100001、非累积表格/显式翻页/取消；来源filename解码、独立来源commit/path/originalLine按钮经tree-file重新验证，默认高级单版本编辑器整行选择/居中，无法映射明确提示。保留提交详情跳转，容量/特殊文件/外部ignoreRev拒绝与授权不变。

真实1002行三页及工作区修改隔离；Unicode旧路径重命名+插入行验证origin commit/path/originalLine与实际正文一致；RPC严格窗口与授权；271/271通过。Chrome37887747671完整通过，实际Monaco选中行及翻页清理（隔离RPC，不是实机）。包19文件/stub注册通过；版本更新后重build候选SHA256 a887955f0384815d470fc044552a50a3647a0e2028d9be4ad697cefbf3b0c092。标签CI37888122787、Chrome37888148685通过；四平台均784542字节，与候选SHA256一致。正式发布37888524118成功；npm latest=0.3.57，实际npm/GitHub下载均784542字节及上述SHA256一致；不安装不重启。
