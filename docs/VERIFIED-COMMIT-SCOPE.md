# 固定父commit原字节验证

状态：纯解析模型已实现，不读取仓库／网络、不移动ref。

输入显式objectFormat／预期commitOID与完整原始body，先独立复算Git commit对象哈希，再解析tree与parents。只有匹配OID的原始commit所声明tree才可作为后续parentTree来源；这仍不证明该OID是当前授权branch tip或tree真实对象存在。

初期仅支持tree、连续0–16个唯一parent、author、committer与可选精确encoding UTF-8；严格拒绝其他header／签名／continuation，树／父列表与author／committer顺序必须规范，容量有界。普通历史显示解析器的宽容策略不能被当作写预览依赖验证。消息是body余部，不得将其中header-looking文本当作tree字段。

独立literal与原始Buffer快照4/4通过。复核发现参数解构getter先于body复制可更换输入；已改为先复制原始body再读取options，独立回归由失败转通过。模块与独立golden合计16/16通过，包含真实Git SHA1／SHA256、容量／异常header／opaque消息及取消。最终npm默认全量1378/1378通过，无失败／取消／跳过／todo（425.6秒）。

用户commit仍未开放，后续仓库capture需同时核对symbolicHEAD／配置／Index／对象格式与授权，再将固定父关系绑定提交计划。
