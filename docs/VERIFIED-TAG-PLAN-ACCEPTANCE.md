# 认证tag计划验收

- 固定target fullOID和rawcommit hash匹配，从已认证header固定tree；消息伪header不得覆盖目标。
- object／type／targetTree／parents／ref／force等caller额外字段拒绝，tagger／message先捕获再signal callbacks。
- tagobject由严格encoder生成并验证，ID绑定所有可变元数据经tagOID与固定target，结果无mutable calleralias。
- 返回ownedbody可被调用方改写，publisher必须重新验证，planID不授权引用创建。
- SHA1／256、BOM／CRLF／EOF、unsigned限制、2MiBcommit／64KiBmessage边界明确。
