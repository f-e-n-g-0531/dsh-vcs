# 已核验删除图验收

- 输入每节点oid／body且仅这两项，caller parents不可注入；tree／message内parents字样不影响边。
- 两种format完整raw commit type长度NUL hash，先全部capture后signal callbacks；对象合计16MiB与10000行边界在复制前核对。
- 关闭图缺失拒绝，所有节点均验证即使不在proof路径；错hash／未知header／签名拒绝，不假装root。
- current／target ref与oid完整严格，current删除／alias及反向祖先拒绝；输出与pure plan一致无graphbody。
- 真正仓库读取／授权／refCAS尚未实现，不以authenticated内容等同实时安全删除。
