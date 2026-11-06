# 候选amend编辑与历史改写确认

状态：未发布候选界面已接入，非正式发布或当前GUI验收。

Amend是替换当前提交，不是创建以旧HEAD为父的新提交。用户显式输入新committer与消息；原author与有序parents由服务器保留，预览显示旧HEAD／旧tree／父列表／新tree／新commitOID后另行确认。

允许仅改消息而Index tree不变；不自动stage、push或force。编辑使旧预览失效，确认仅token，与normal commit不能互换。

八类变更共用仓库pending／unknown门禁。开始后取消／失败可能历史已替换或只留下对象，需核对HEAD／Index，不自动重试或回滚。

## 当前验证

新amend组件13项及normalcommit11项24/24通过，独立candidate topology golden通过；独立静态复核无当前范围确认缺陷。初期同时挂载表单顺序导致既有测试无范围textarea选择误填amend，已保留normalcommit先显示、amend测试按region选择，不修改提交语义。最终组件＋独立golden25/25通过，构建、隔离Edge完整浏览器含amend步骤、67文件包检查与隔离安装通过；npm默认全量1803/1803通过，无失败／取消／跳过／todo（421.7秒）。

严格仓库配置／签名／hooks／packedrefs等限制与外部竞争非全局原子性保持，不代表任意Git历史改写兼容。
