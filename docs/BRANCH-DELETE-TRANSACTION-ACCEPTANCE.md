# 私有分支删除事务验收

- exact issued summary身份，caller字段和clone无权限，先burn后检查，失败亦不能复用。
- 每次prestart授权后复验原完整metadata及固定HEAD／target，不用新基线掩盖状态变化。
- post仅允许targetref／targetlog与空祖先目录消失，保留其他文件version和目录identity／mode；外来变化unknown不回滚。
- 工作区dirty不被写入，Index只metadata固定，objects完整保持；oldOID或rawsymbolic callback竞争观察拒绝，不声称外部原始类型原子保护。
- finalauth后再次核对，不因授权回调后变化错误返回成功。
