# 仓库tag预览验收

- 仅显式shortname／tagger／message，不能输入OID／ref／type／签名选项，own-data preawait。
- currentHEAD原始commit从仓库固定OID读取并hash核验，plan固定targetTree／tagOID，无body或private授权输出。
- refs/tags/name与logs路径prefix／case冲突、已有ref／packedrefs／symbolic／links拒绝。
- 原始metadata版本／HEAD／config贯穿读取，取消／deadline只读，无WorkIndex正文／temp对象引用创建。
- 性能上限严格拒绝而非自动force，tag预览不代表发布完成。
