# Tag计划ID绑定

ID使用SHA256的版本化domain JSON tuple，字段为objectFormat、已认证target OID、canonical tag对象OID、完整refs/tags路径。tag对象OID同时绑定tagger身份／时间／消息／短tag名称；targetOID绑定原始commit和tree，不接受独立caller tree覆盖。

同输入确定性ID；元数据或目标变化得到不同候选。ID不是授权token，不能代替WeakMap／Sessiongrant／ref状态验证。

输出body是独立mutablebuffer；改字节不会更新ID，publisher必须检查hash／语义不一致并拒绝，不能依赖frozen wrapper防改字节。
