# Lightweight tag纯计划验收

- rawcommit先ownedcopy再读取输入／signal，strictown target／name，无caller annotatedmetadata。
- SHA1／256完整hash与strictcommitheader，targetTree只从已认证header来，message伪header不影响。
- 输出frozen全标量，无object／body／message／tagger，domainID独立绑定format／ref／target。
- portable名称与2MiB边界／cancel／inputmutation回归，不normalize或force。
- realGit target读字节、无refs变更；不证明目标仓库存在性或授权。
