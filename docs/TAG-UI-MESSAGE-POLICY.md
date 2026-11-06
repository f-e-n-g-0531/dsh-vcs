# Tag界面消息与identity

Tagger字段由用户显式填写，不自动取commit作者；时间戳与timezone也需有效输入。消息严格UTF8、非空白、64KiB，允许CR／LF／TAB与BOM并保留EOF，禁止其他Cc和PGP signature marker。

候选messageBytes按UTF8字节计算，不按JS字符数，publictagger与提交草稿四字段逐一相等；编辑任一字段立即废弃候选和ack。

只支持服务端HEAD目标，无任意OID／ref或签名工具输入。
