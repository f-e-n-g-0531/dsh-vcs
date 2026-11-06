# 只读提交预览验收

- 完整raw Index checksum／语义扩展guard，不能用git status推算内容或readWork。
- 读取固定HEAD commit body并独立复算OID，parentTree只能来自已核验header。
- 两次canonical root/gitdir/common/format/HEAD ref/config/rawIndex/metadata稳定；ref名字语法正确不等于tip稳定。
- 作者／提交者／消息在任何await前严格own-data捕获，公开summary无私有Buffer或执行能力。
- 对所有Git调用禁replace／lazyfetch／环境覆盖，hooks／签名／filter／attributes等不隐式执行；初期不支持配置fail closed。
- SHA1／SHA256 staged与Work不同的真实仓库，预览tree匹配Index且rawIndex／对象目录／refs／logs／Work全不变。
- signal／ambient预算终止，HEAD／Index／config变化拒绝，不解释为可执行快照。
- 两次采样存在race窗口，只有未来授权和refCAS事务能把预览接到写入；当前不开放commit。
