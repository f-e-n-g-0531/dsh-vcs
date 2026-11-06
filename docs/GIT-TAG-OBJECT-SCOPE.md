# 未签名annotated tag对象模型

状态：纯对象编码与核验已实现并完成独立oracle验证，无tag引用创建／删除／RPC／UI。

固定type commit目标、便携短tag名、显式tagger与精确消息，计算Git tag长度NUL完整hash。parser先owned capture再核验rawhash和严格ordered header，不执行签名工具、不接受未知header或签名。

独立literal framing与真实Git hash-object／cat-file SHA1／SHA256 oracle4/4通过，与既有对象／parser组合26/26通过；独立静态复核无当前范围确认缺陷。专用模块12/12、独立4项组合16/16、verified对象roster106/106通过，syntax／whitespace检查通过；本批不新增全量声明。

对象身份不证明目标commit存在或refs/tags安全；后续必须独立认证对象／ref不存在条件／用户授权。支持SHA1／SHA256，消息64KiB、identity各1024字节、tag短名1000总字节／255组件。
