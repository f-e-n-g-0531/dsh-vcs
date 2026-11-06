# 分支预览观察范围

当前预览绑定本地raw HEAD／config和refs／logs命名空间版本，两个固定HEAD读取各自验证effective配置与metadata。系统／全局配置不在同一原子快照内，不保证全局文件变化后又恢复的ABA检测。

预览不发放写权限；即使安全摘要name／target被冻结，也不能作为创建授权。后续需私有快照、用户确认token、共享writer和创建前fresh state验证。

预览使用保守case-insensitive namespace碰撞策略，各平台保持exact拼写，不自动规范化名称。
