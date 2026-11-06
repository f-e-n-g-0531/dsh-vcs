# Lightweight tag内部确认协调器

状态：内部工厂实现，无RPC／UI。

仅strict own Session／repositoryId／短name，fixed lightweight-tag-create kind，公开8字段标量不泄漏原snapshot；不接受tagger／message／OID／ref覆盖。

独立real事务与annotated token隔离golden2/2、与tagHost组合29/29通过，独立静态复核无当前范围确认缺陷；专用初生成literal SyntaxError及把U+FFFD误当surrogate测试失败已修正；最终30/30通过，完整专用＋独立golden32项通过，生产无更改。不新增全量声明。

独立singleuse token绑定grant／repo对象／cwd／Session，共享writer；poststartunknown核对refs／HEAD，不retry／rollback／删引用。与annotated tag能力分离，无外部原子性承诺。
