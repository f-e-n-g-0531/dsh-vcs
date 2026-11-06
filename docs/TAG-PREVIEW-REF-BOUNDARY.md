# Tag预览的引用边界

短名在refs/tags及相应logs namespace核对，无自动trim／大小写改写；现有任意条目或目录prefix冲突均拒绝，不覆盖lightweight／annotated／symbolic标签。

缺失检查只作只读预览，后续实际引用创建必须采用真实Git不存在条件更新并重新fresh验证，不能直接使用public摘要授权。

当前严拒packedrefs／shared等配置子集并非完整tag管理；远端tag／签名／删除tag另行实现，不自动push。
