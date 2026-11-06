# 从固定HEAD创建分支的只读预览

状态：内部只读预览已实现并完成初轮验证，尚无确认／RPC／UI。

输入仅安全分支短名，服务器派生refs/heads路径并固定当前hashverified HEAD为目标。不接受caller起点OID／路径／revision表达式；不checkout、不创建ref／日志／对象。

目标ref及日志、命名空间前缀均需不存在冲突，packedrefs初期保守拒绝。名称保持UTF8原始拼写，控制字符／Windows保留名／.lock／路径逃逸等拒绝。

独立真实Git golden1/1通过：Unicode嵌套短名目标固定为HEAD，未创建目标目录或任何ref／object，raw Index保持。模块＋独立golden／portable guard75/75通过，旧fixedHEAD＋golden42/42通过。复核发现portable名缺少Windows禁用字符，最终实现已拒绝引号／尖括号／pipe并增加HEAD保留名／组件255字节边界，独立preIO4/4通过。模块最终70项与独立golden／portable guard75/75通过；npm默认全量1949/1949通过，无失败／取消／跳过／todo（430.7秒）。尚未导入生产包／确认／RPC／UI。

两次固定HEAD读取及配置／命名空间观察用于拒绝可见变化，不提供外部进程原子隔离；后续真正创建仍依赖独立授权和Git条件更新。
