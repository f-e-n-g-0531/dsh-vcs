# 分支切换未知结果恢复

切换操作可能修改HEAD、Index与Work；确认请求发送后取消或卸载不能证明未执行，必须与其余写操作共用仓库unknown，不自动checkout回去或retry。

显式恢复仅刷新状态并由用户核对当前分支，不承诺撤销。成功仍需固定target ref／OID匹配，预览中的dirty或配置拒绝不能被前端门禁扩展为force。

切换文件选择不算scope切换；Session／仓库／mode／refresh／scan变化使旧候选失效。
