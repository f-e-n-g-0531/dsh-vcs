# 分支创建私有摘要权限边界

prepare公开摘要只有name／ref／fixed HEADtarget等显示字段，实际执行需进程内WeakMap身份，不信任JSON克隆或caller改过的目标。失败、取消、wrongrepo和badcallbacks也应一次消费。

此私有摘要仍非Session用户授权：Host后续必须绑定当前grant／Session／cwd／repo并提供授权回调及writer门禁，不能让客户端直接调用原语。

目标创建前后命名空间精确核对并不能隔离hostile path swap或外部ABA，不能把副作用回滚当恢复。
