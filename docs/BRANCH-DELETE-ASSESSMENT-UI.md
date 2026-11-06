# 删除分支只读安全评估界面

状态：候选只读界面已接入并验证，未更新日常GUI。

仅提交短name到branch-delete-preview，展示固定当前／目标tip及认证祖先proof，明确“未执行删除”。无token／checkbox／确认删除按钮，不提供force；未合并／不完整／超限拒绝。

编辑／取消／scope变化丢弃过时结果，readonly取消不锁仓库unknown；共享pending／unknown时不读评估，避免旧handler绕过门禁。

独立proof方向／禁止token／same-tip单点golden1/1通过，backend只读15/15、相邻UI53/53通过；完整专用10项含dense10000／10001、deepfreeze及组合40/40通过，全部client roster捕获183/183通过（新增deepfreeze项另已完整复验）。独立静态复核无当前范围确认缺陷。构建、隔离Edge完整浏览器含branch-delete-preview、74文件包检查与隔离安装通过；本批未重跑全量，不新增全量声明。初轮组件fixture尚未创建导致ENOENT，补齐后复验通过，保留该过程。

评估不授予删除能力，rawref外部竞争限制未解决，因此无实际删除用户入口。
