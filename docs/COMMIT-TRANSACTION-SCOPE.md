# 内部私有快照提交事务

状态：内部事务已实现并完成验证，尚无用户commit Host／RPC／界面。

从prepare发放的精确摘要WeakMap取得私有plan，apply先烧毁grant；原始raw Index／HEAD／配置／metadata与重建plan身份须一致，克隆／跨repo／重放拒绝。对象图仅追加后，metadata仅允许本事务新增且已验证的精确OID／fanout，不以fresh全量metadata替换baseline。

ref更新采用固定已出生loose本地分支oldOID CAS，引用事务hook禁用；成功后核对新commit、未改Index和配置，Work正文不写。对象追加或ref更新后失败均unknown，不自动重试／reset／GC／删除已发布对象。

现有保守范围：普通stage0既有Index、无hooks／签名／属性／转换／shared／packedrefs／操作锁；外部symbolicHEAD竞争和跨文件原子性仍无保证，必须明确披露。

独立真实Git golden1/1通过：新commit父为原HEAD，tree等于预览Index，原rawIndex与不同Work保持，重放拒绝。复核发现新对象复验只inflate而未验证压缩输入完整消费，可在late授权回调添加suffix后被纳入owned基线；已要求engine.bytesWritten等于输入长度，独立suffix回归通过，更新ref前unknown拒绝。初期真实事务测试把read atime变化误作Index写入，已改核对raw bytes／inode／mtime／ctime等写身份。最终确认组19/19（模块17＋独立happy／suffix2）通过，旧capability37/37通过。首轮全量因旧atime断言失败保留，稳定源码单组npm默认全量1575/1575通过，无失败／取消／跳过／todo（393.9秒）。

本轮只在临时仓库验证提交，未授权对用户工作仓库创建提交。
