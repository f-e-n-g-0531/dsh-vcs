# Annotated tag创建候选界面

状态：候选界面已接入并通过隔离验证，未发布或更新日常GUI。

显式短name／tagger／消息，服务器固定当前HEAD，预览完整refs/tags与tagOID／targetTree／currentRef后勾选单次确认。不覆盖、不签名、不push、不checkout。

修改废弃旧候选，exact metadata／格式／OID／TTL绑定；结果不匹配或确认中断锁仓库unknown，核对refs／HEAD／对象，不自动删除或重试。

验证：专用16项、最终全部client＋独立golden206/206通过；构建、隔离Edge完整browser含tag-create、80文件包与隔离安装通过。独立复核发现oldprepare／oldcancel跨draft问题，加入generation及same-value编辑强制rerender修复并复验；初期并发guard编辑导致短暂测试失败已保留记录。本批不新增全量声明。

strict unsigned／packedrefs／shared／hooks等拒绝保留；当前HEAD单一目标不等于任意起点或lightweight tag完整支持。
