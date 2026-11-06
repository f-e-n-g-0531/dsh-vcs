# 认证tag发布验收

- 两个rawbody都owned capture后再auth，明确bound与strictown字段，不允许parsedmeta／ref注入。
- targetcommit hash/header和taghash/header分别核验，必须同objectFormat且tag.object=target.oid。
- existingvalid tag无start，existing坏压缩／错字节拒绝不覆盖，mutation以ownedtemp＋NOREPLACE。
- onStart只在实际写前一次，poststart任何失败unknownappendOnly；不写target／refs／HEAD／Index／Work，不rollbackGC。
- suppliedtarget真实性与仓库存在性分开，后续ref事务再验证。
