# 提交对象图发布验收

- 输入tree图完整reachable且bottom-up，root唯一空路径、commit指向root；每个目录子引用在前、path与父目录对应。
- rawtree mode／UTF8名／字节排序／OID宽度必须规范，重建图精确对比body和OID；重复／orphan／缺失／顺序／循环拒绝，不用仅hash正确代表语义有效。
- 所有Buffer先owned capture再回调，无论授权回调改原始tree或commit均不影响写入。
- 预校验容量总和／节点／深度，全部before IO；外部blob存在性留给提交快照，不冒称可达图完全存在。
- 已有对象完整验证、无通知无覆盖；首个新对象触发一次start，后续失败unknown且保留已追加，父tree／commit不得早于child。
- 不更新HEAD／refs／Index／Work，发布成功只能称对象保存，不称提交完成。
