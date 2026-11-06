# 删除确认协调器验收

- 准备字段own-data同步捕获且全部required；OID／ref／force／graph不可注入。
- Public current／target／proof为新对象，改public不改原private snapshot；fixed branch-delete kind与create／switch／commit／amend／Index双向隔离。
- expiry／容量／grant／Session／cwd／repo身份绑定，consume-before-check，invalidate与clear有效。
- 所有write共用互斥，existing reader拒绝确认；prestart保留具体失败，poststartunknown不retry／recreate。
- 仅内部工厂，无RPC／UI；不宣称raw-ref外部竞争已解决。
