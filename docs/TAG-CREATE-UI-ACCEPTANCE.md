# Tag创建界面验收

- draft只短名／显式tagger／消息，无targetOID／ref／force／signing输入，serverHEAD固定。
- exactpreview name/ref/tagger/messageBytes/objectOID/planId/format/fullOIDs/currentRef/tokenTTL；不一致不显示可确认候选。
- ack默认unchecked，编辑／scope／cancel／expiry废弃，旧handler不能确认replacement。
- success五字段与candidate固定HEAD相符，否则unknown；共享第十一类confirm同步pending／unknown，旧按钮不可绕过。
- UI明确不覆盖／签名／push／checkout，Gitworkspace不依赖status／selection，SVN／review隐藏；隔离browsermock不称liveGUI升级。
