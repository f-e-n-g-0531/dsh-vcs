# Lightweight tag当前HEAD只读预览

状态：内部只读仓库预览实现，无Host／RPC／UI。

仅shortname与native signal；currentHEAD由仓库认证，原始commit固定OID读取并hash核验后生成lightweight计划，refs/tags及logs命名空间无碰撞，完整metadata／HEAD／config屏障贯穿。

不创建tag对象／ref／temp，不读取WorkIndex正文；strict bornembedded／packedrefs／shared／hooks等子集和15s／2万metadata上限保持。输出冻结8字段无body或执行能力。

初轮生成RegExp字符串转义导致运行时SyntaxError，替换为已核验regex literal后独立真实Git无写golden通过；最终专用51＋独立1项52/52、lightweight plan组合18/18、既有annotated preview60/60通过。独立静态复核无当前范围确认缺陷，不新增全量声明。
