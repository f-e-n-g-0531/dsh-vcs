# 固定提交对象图发布

状态：内部组合已实现并通过针对性验证，不移动ref、不提供用户commit。

输入完整tree图与commit原字节，全部Buffer在首次await／授权回调前捕获；核对Git type-hash、canonical tree图／子目录依赖、root与commit header tree一致，再按bottom-up trees→commit顺序调用有类型仅追加存储。

所有体积／节点／哈希／路径验证必须在任何对象写入前完成。发布过程中逐步复验授权／预算，onStart只通知一次；开始后的失败append-only unknown，已追加对象不删除／GC回滚。重复已有对象只验证不覆盖。

独立golden1/1通过：授权回调改写所有caller tree／commit Buffer后，实际落盘仍为预捕获原始内容；重复已有图只读不调用onStart。graph＋typedstore针对性组合76/76通过，包含真实Git两种format对象、graph畸形拒绝与部分发布取消留存；独立静态复核未发现当前范围确认缺陷。模块最终37项、独立golden及typedstore组合76项通过；稳定源码npm默认全量1518/1518通过，无失败／取消／跳过／todo（372.7秒）。

该层不证明外部blob依赖存在或当前branch授权／新鲜度，后续提交事务必须绑定受控仓库快照并独立refCAS；对象图发布不是提交成功。
