# 证明路径分页验收

- 收起无li；展开最多100项，10000项总共100页，首末globalindex准确。
- prev／next只改已验证快照的page，不能调用RPC或追踪HEAD。
- current→target端点及完整proof验证仍按1万上限，不只验证当前页；分页不是graph截断。
- 新结果重置open与page，编辑／cancel／scope清除；旧buttonhandler不改变替换结果。
- 原生details与有label按钮可操作，边界按钮disabled并显示页码／总项数。
