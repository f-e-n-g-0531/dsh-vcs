# Annotated tag引用不覆盖创建原语

状态：内部引用原语已实现并完成真实Git验证，无Host／RPC／UI。

固定refs/tags短名与expectedTagOID，必须已存在strict unsigned tag对象，rawhash／内部tag名与ref精确一致，目标commit同样从仓库核验存在。Git zero-old条件创建不覆盖已有引用，不发布对象。

HEAD／当前tip／日志与Index metadata固定，禁用事务hook，开始后失败unknown不retry／rollback／删除新ref。调用方必须持writer及授权，仓库子集和外部并发观察限制保持。

独立真实Git dirtyWork／rawIndex／HEAD／objects保持golden1/1通过；当前Git2.56实际tag namespace dangling symbolic zero-old创建拒绝并保留原条目，characterization1/1通过，不泛化所有版本。初轮characterizationfixture路径仍写heads导致ENOENT，修正测试路径后通过。相邻Git ref CAS＋独立golden50/50通过，静态复核无当前范围确认缺陷。初轮专用矩阵发现snapshot漏算必要logs/refs/tags目录，以及非commit目标实际Git命令错误与测试预期invalid不符；修正测试oracle后最终89专用＋2独立91/91通过，包含born／dangling symbolic竞争实际拒绝、target对象及tag名绑定、HEAD／log／index固定和poststartunknown保留竞争变更。未扩大生产范围，不新增全量声明。
