# 0.3.44 历史目录面包屑正式发布记录

冻结实现6cb259d：根与祖先原生按钮、当前路径aria-current、中英文区域标签；复用go清空查询/分页/预览。不新增RPC、后端读取或网络能力，不改变边界。

- 两项新增路径单测覆盖精确祖先及特殊名称。第337轮npm run check、verify:package、test:install全部退出0；临时stub注册不等同现有宿主安装或GUI验收。
- [组件Chrome回归](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36714153479)通过：双语、特殊路径、返回根/祖先、分页和搜索重置、预览取消与迟到响应、树请求仅一次。
- 本地候选包779371字节，SHA256 `f621b02cb00ef49c6a5f85947069bdc1f5fdbfb3f9c6bd9a0f79f973a78d92e2`。
- 固定标签源码f60828c019c415d567489e21b3611c7b0336f671；[四平台CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36714608277)与[同标签Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36714694605)均成功。
- Artifact Ubuntu24=11095474252、Windows22=11095053767、Ubuntu22=11095039148、Windows24=11095028930；四份下载均与本地候选大小及SHA256一致。
- [正式发布工作流](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36715170094)成功，npm latest=0.3.44，GitHub非草稿/非预发布且披露真实GUI未验收。实际下载两端tgz均779371字节，上述SHA256与候选及SHA256SUMS一致。未移动标签，未安装或重启。
- 真实GUI待验：确认已加载构建身份，深目录键盘/鼠标跳祖先，预览/搜索/分页重置及取消，窄窗口长路径可用性。隔离测试不替代物理键盘、辅助技术与真实宿主验证。
- 不安装、不重启；真实GUI未验收必须在发布披露。
