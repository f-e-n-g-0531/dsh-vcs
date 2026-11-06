# 部分块界面独立验收

- 计划响应必须有有界精确单位、完整内容身份、有效期限与独立planToken；拒绝重复ID、错位计数／坐标、非法terminator、巨大正文和不支持算法。不得仅凭React转义安全就渲染无限内容。
- 显示text与真实LF／CRLF／CR／NONE标记，BOM可明确标记；行号零基转一基，不把显示规范化作为写入源。
- 空选不能预览候选；候选响应必须匹配原path／head／index／planId及精确选中ID集合，不能把其他选择候选显示为本次。
- 计划token在选择尝试即消费，选后禁用勾选或强制新计划；prepare失败不能自动复用原planToken。
- expire／scope／refresh／cancel清理两类token；plan与prepare取消只读，confirm取消／卸载必须触发共享仓库unknown。
- 最终confirm只发送token；重复点击受同步ref锁保护，任何confirm失败先unknown，不能自动重试。
- 与整文件stage／unstage双向共享恢复门禁，自动focus或刷新其他仓库不得清除。
- 单独RPC／计划验证不等于用户浏览器交付；需组件、生产入口、真实浏览器和全量证据。
