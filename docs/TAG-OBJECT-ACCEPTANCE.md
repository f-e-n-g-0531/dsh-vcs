# Annotated tag对象验收

- type固定commit，object／tag／tagger／message全部own-data，不能注入type／signature／header。
- 精确UTF8消息BOM／CRLF／EOF保持，全body type-length-NUL hash；消息里的object／tagger字样不是header。
- Strict ordered四header＋blank separator，重复／续行／未知／签名拒绝；hash错即拒绝。
- 原始body先复制再signal callbacks，输出parser无Buffer，encoder输出是owned bytes。
- 真实Git SHA1／256 hash-object tag与cat-file oracle仅临时仓库，无refs变更。
- 纯对象模型不证明目标存在／真实type，也不授权tag ref创建。
