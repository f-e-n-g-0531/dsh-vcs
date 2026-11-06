# 独立行选择的边界拼接

独立删除／插入可保留before未选行后再追加after选中行，但原始token拼接可能改变物理行边界：

- before=a（NONE），after=b（NONE），只插入得到ab，保留字节但不保留独立行。
- before=a（CR），after=空文本（LF），只插入得到aCRLF，将两个token合为一条CRLF行。

因此接入写流程前应保守要求候选编码后重新tokenize的{text,terminator}序列与选择合成序列一致；否则拒绝不安全边界，不补换行、不隐式规范化。不因保留字节就宣称保留行语义。

全选after和空选before应继续精确；非法中间子集明确不支持。候选大小／行数独立限制，不能只检查输入端点。
