# Tag append-only存储验收

- SHA1／256 tag完整framing与原body字节，authorization回调篡改caller bytes不影响已捕获输出。
- 已有对象需完整inflate／typeheader／长度／hash一致，无trailing compressedbytes；有效已有对象不onStart，不覆写。
- 新对象exclusive temp＋hardlink NOREPLACE，权限／取消在start前无写，start后unknown保留append对象，cleanup仅自有temp。
- 标签body128KiB含边界，opaque语义不接受为真实tag解析证明。
- 原不支持type列表中tag改为拼错tagg，继续验证未知类型拒绝；不放松其他存储约束。
