# 图片扩展冻结范围

以0.3.57为基线，先A/B及Git工作区PNG独立交付；复用静态非交错PNG完整验证、元数据剥离、2MiB/8192维/16M像素/64MiB解码/并发2。A/B固定OID与opaque pair ID重新验证、rename oldPath、added/deleted明确absent。工作区必须status模式ID重验、文件安全句柄与前后状态校验、stage/HEAD/blob精确侧语义，失败不给旧图。SVN工作区图片暂不纳入，JPEG/WebP单独冻结验证，拒绝SVG/动画，未验证格式不放行。

首轮复用历史PNG读取helper并新增A/B adapter；待真实仓库/RPC/UI、取消释放/stale及全部发布门禁，不安装不重启。
