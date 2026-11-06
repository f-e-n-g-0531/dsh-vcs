# 最近消息复用验收

- 只读load只发送sessionId／repositoryId，不传任意OID／ref，加载不改draft／preview／ack、不发prepare或confirm。
- 按format／OID／parents／identity／UTF8和精确bytecount验证，保留BOM／CRLF／EOF，响应不完整拒绝。
- 显式reuse仅改message并同步清candidate与ack，identity和时间保持，旧confirmhandler不可发送。
- read允许但write拒绝的消息原样保留draft并提示，不隐式规范化。
- 独立read AbortController，scope／cancel／unmount忽略迟到，pending／unknown stalehandler不能load或reuse。
- 明确是新提交复用消息，非amend。
