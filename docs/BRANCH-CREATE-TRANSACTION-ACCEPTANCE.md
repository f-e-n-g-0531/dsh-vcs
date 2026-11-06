# 私有分支创建确认验收

- 只有issued摘要对象可执行，clone／wrongrepo／publicref或commit替换拒绝，失败亦烧毁grant。
- 创建前old HEAD／配置／namespace不变，在最后prestart授权回调后再验证，不用fresh重建覆盖baseline。
- 使用固定ref／OID调用zero-old创建原语，实际竞争CAS不覆盖；结束后仅exacttarget与log／必要祖先新增可豁免。
- oldrows文件version精确不变，ancestor目录identity保留；外来ref／log／rename不作为自有变化接收。
- HEAD不移动，Index／Work／objects保持；poststart失败unknown不重试rollback。
- 调用方共享writer为必要前提，不伪称外部原子隔离。
