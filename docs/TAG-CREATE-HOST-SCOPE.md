# Tag创建内部确认协调器

状态：内部工厂实现，无RPC／UI。

only-own Session／repositoryId／短name／tagger／message在await前捕获并按tagencoder验证，fixed tag-create kind，公开tagger／object复制，原snapshot私有保留。

token默认60秒／32项，绑定grant／repository身份／cwd／Session，一次consume，sharedwriter与其他变更互斥。poststart unknown要求核对refs／HEAD，不自动retry／delete objects／rollback。

独立private目标／跨kind token golden1/1与相邻Host组合200/200、全部Host roster捕获326/326通过；静态复核无当前范围确认缺陷。真实coordinator→事务临时仓库创建／HEAD保持／token重放拒绝golden1/1通过，专用27＋独立fake／real2项完整29/29通过，最终全部Host roster352/352通过，不新增全量通过声明。

工厂不是认证入口，不提供外部进程原子隔离／签名／push，也不等于创建标签用户功能完成。
