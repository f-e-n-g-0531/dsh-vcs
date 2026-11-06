# Amend界面验收

- 独立组件及RPC，不用公开mode把commit变amend；prepare禁止author／parents传入，committer／message精确绑定。
- 旧HEAD／旧tree／原author／全部有序parents显示，root无parents也明确；新commit不是oldHEAD的子提交，文案须显式历史改写。
- 完整format／OID宽度／ref／digest／tokenTTL校验，parents最多16唯一；服务端author校验但不任意覆盖。
- 修改废弃candidate和ack，旧confirm与checkbox回调不能确认替代token；成功四字段与预览完全一致。
- staged已加载空changes也能message-only，不在非Git／review／读取失败状态挂载。
- amend加入现有七类pending／unknown同步门禁，八类互斥，取消／scope／卸载confirm为unknown，显式刷新核对后才恢复。
- 不自动stage／push／force；当前严格backend子集和外部竞争限制准确披露。
