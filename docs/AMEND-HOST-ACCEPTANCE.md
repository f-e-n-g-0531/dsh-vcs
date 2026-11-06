# Amend协调器验收

- 固定kind/action=amend，prepare仅committer／message，caller author／parents／direction不可覆盖。
- safe摘要复制parents与identity、不返回graphbody；确认执行server原snapshot不信publictamper。
- commit／amend／Index／branch同binding token不能互换，错token不消费其他namespace合法能力。
- 一次消费TTL／cap／binding／grant revoke，writer排他，prestart具体失败与poststart历史未知区分。
- unknown提示可能历史已改写和append-only残留，不重试／rollback。
- 仅内部工厂，无Session授权自动来源、无RPC入口。
