# 最近提交只读验收

- 精确symbolic HEAD名字与完整OID／format双读，raw parent固定OID读取并独立hash验证；不使用格式化log去重建原始身份／消息。
- config --no-includes在任何可能扩展include的Git读取前拒绝外部配置；no-replace／no-lazy-fetch／protocol禁止保持。
- metadata双capture及closing barrier，HEAD切换／ref相同但OID变化／配置变化拒绝；无Index或Work正文输入依赖。
- 真实Git不同Index／Work内容不影响返回当前HEADmetadata，Index／objects／refs／logs全不变。
- 严格签名／header／消息UTF8／容量限制清楚，不自动清理消息、改author或amend。
