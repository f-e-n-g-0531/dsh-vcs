# 已核验最近提交信息模型

状态：纯读取模型已实现，不读取移动HEAD、不写对象或引用，amend尚未开放。

输入固定OID和完整原始commit body，先复制全部字节再验证哈希与严格header语法；提取author／committer独立身份和秒级时间／时区、原始消息（保留BOM／CRLF／末行状态），不从log格式化输出重组。

该模型可读取root和merge父列表，不意味着支持amend这些提交；签名／未知header仍按当前严格parser拒绝。显示消息容量与UTF8边界独立限制，不能用消息内伪造header替换身份。

独立literal2/2通过：两个objectFormat的author／committer身份独立，消息内伪造author不影响header，BOM／CRLF／无末行LF原样且不暴露Buffer。继承parser与独立golden组合15/15通过，独立静态复核无当前范围确认缺陷；完整模块12项＋独立2项14/14通过、与parser组合24/24通过。默认全量捕获1610/1610通过，无失败／取消／跳过／todo；该run启动后新增12项模块测试另行通过，不冒称包含于1610计数。

后续最近提交RPC必须固定当前授权HEAD并复验，复用消息也须用户明确选择，不能自动修改作者或历史。
