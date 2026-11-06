# 分支创建协调器验收

- prepare严格sessionId／repositoryId／name自有数据同步捕获，禁止ref／OID／path／mode替换。
- 私有snapshot不被publictarget改写，公开projection复制target，不暴露baseline。
- token同scope跨commit／amend／branchswitch／Index不能互换，unknown只在started后、prestart具体错误保留。
- genericreader／writer互斥、TTL／cap／grant失效与绑定clone拒绝，clear／invalidate有效。
- fixed server起点，确认无checkout，unknown须核对refs／HEAD而非自动重试／删除新分支。
