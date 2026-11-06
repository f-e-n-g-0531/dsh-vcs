# 提交对象基础

状态：纯tree／commit编码模型已实现并完成针对性验证，不追加对象、不更新ref，不提供用户commit。

## Tree

单目录条目mode＋原始UTF8名称＋完整OID编码，OID宽度由固定objectFormat决定。Git树排序不是简单字符串排序：目录按name后接slash与文件比较；不允许重复路径、空／点／dotdot／.git或header分隔符。

## Commit

固定tree、父提交列表、author／committer姓名邮箱与秒级时间／时区，以及消息原始UTF8字节。身份禁止换行／NUL／尖括号等注入；消息保留末行换行状态，容量有界。不自动签名、运行hook或改写用户配置。

对象OID按Git规范type＋空格＋十进制body字节数＋NUL＋body哈希，支持显式SHA1／SHA256。模型只返回独立body／OID，不移动HEAD或分支。

## 后续提交事务

Tree从受控完整Index快照生成，不从Work生成；未暂存工作必须保留。预览展示将提交的精确tree、父提交、消息与身份，服务器保存私有快照。确认后追加已验证对象，再以oldOID条件更新已授权当前分支；处理hooks／签名／reflog／ref事务和未知结果须另行验证，不能直接把对象编码存在称为支持commit。

## 当前独立literal验证

SHA1／SHA256的foo.bar／foo目录／foo0排序和rawOID字节2/2通过；不同author／committer身份、+0530／-0330时区及header-looking／CRLF／中文无末行换行消息独立literal1/1通过，输入Buffer修改不影响结果。模块10项＋独立literal3项合计13/13通过，包含真实SHA1／SHA256 Git hash-object／mktree／cat-file临时对象round-trip。消息64KiB、身份1024字节、父提交16个、tree8MiB／10万项等负例通过；最终npm默认全量1290/1290通过，无失败／取消／跳过／todo（429.3秒）。模块尚未导入生产提交流程或包闭包，未创建用户提交。

测试需真实Git tree／commit哈希与cat-file、Unicode和目录排序、SHA256、身份／父提交／消息容量与注入拒绝；不在用户仓库创建提交或修改引用。
