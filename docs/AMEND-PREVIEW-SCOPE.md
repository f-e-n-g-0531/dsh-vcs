# Amend仓库只读预览

状态：内部只读适配器已实现并完成针对性验证，无amend确认／RPC／UI。

固定canonical仓库旧HEAD原字节与完整raw Index，保留原author／parents，新committer与消息显式提供。允许Index tree不变的消息修改；公开显示action=amend、旧HEAD／旧tree／父列表及新tree／commitOID。

私有amend快照与普通commit WeakMap隔离，普通consume／apply不得消费amend摘要；公开summary无正文Buffer和执行权限。

独立真实Git golden1/1通过：same-tree root修改消息可预览，原作者和空parent列表保持，normal consume／apply拒绝amend摘要，Index／对象／HEAD不变。模块＋独立golden22/22、旧commit capability＋golden38/38通过，独立静态复核无当前范围确认缺陷。构建、66文件包闭包与隔离安装通过，最终npm默认全量1729/1729通过，无失败／取消／跳过／todo（426.3秒）。

仍按现有严格仓库guard与双capture稳定性政策，只读取，不追加对象或更新ref。root／merge只读计划支持不等于生产历史改写授权。
