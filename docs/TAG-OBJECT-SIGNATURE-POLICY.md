# Tag签名与消息边界

本轮仅unsigned annotated tag，消息里的精确PGP signature begin标记保守拒绝，不执行gpg／ssh签名工具；这不是验签实现。type只支持commit目标，不支持nestedtag／tree／blob目标。

消息正文中的object／type／tag／tagger行在blank separator后只是正文，不影响目标和tagger。有效UTF8 BOM／CRLF／无末行换行保持，禁止NUL与非允许控制字符。

编码hash证明对象字节身份，不检查object目标真实存在／类型；未来发布需独立验证commit与ref名字不存在条件，不能只信caller objectOID。
