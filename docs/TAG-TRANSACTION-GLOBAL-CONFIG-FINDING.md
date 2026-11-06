# 优化后的effective配置新鲜度回归

优化将readLatestCommit从每verify移到首次apply，只按local .git/config原字节和metadata验证。系统／全局effective config不在该目录基线，授权callback后可变化，原重复reader会观察但该中间优化确实漏检：独立golden出现Missing expected rejection，已保留失败。

Lead新增tag-global-config-golden：finalauth在ref出现后写隔离global config别名，期待unknown拒绝；必须每安全屏障fresh pinned --no-includes --null --list并与private原baseline比对，不能只缓存globalconfig。不要求每次重复cat-file／check-ref-format。Lead补fresh effective config比对后独立golden拒绝变化并通过，正常success同时通过（2/2），生产15秒预算未改变。
