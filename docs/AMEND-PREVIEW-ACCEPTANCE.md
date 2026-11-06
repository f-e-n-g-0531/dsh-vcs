# Amend预览隔离验收

- 固定旧HEAD body独立hash，author／parents来自旧header，不接受caller author或parents。
- same-tree只改message可预览，normal commit no-op政策不应误用于amend。
- 独立amend WeakMap，normal prepare／consume／apply无路径消费amend摘要，不因action字段伪装获得能力。
- 完整Index和HEAD／配置／metadata原基线双capture，不读或写Work正文，不创建objects／refs／logs。
- 公共摘要action明确amend，旧HEAD／旧tree／父列表与新OID展示准确，无私有Buffer。
- 尚无amend执行入口，root／merge纯拓扑不等于生产改写授权。
