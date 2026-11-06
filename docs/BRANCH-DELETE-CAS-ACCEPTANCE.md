# 条件删除原语验收

- 非当前精确portable本地ref＋expectedOID；当前casealias拒绝，oldOID变化CAS拒绝；current HEADraw／tip／reflogs不变。
- Work／Index正文／objects无写，目标ref与其reflog删除属预期；不调用checkout或对象回收。
- 事务hook ownempty override、noincludes pinnedconfig、fixed identity，clean onlyownedempty temp。
- prestart拒绝具体错误，poststart cancel／authloss／回调错误／CAS竞争unknown，无自动retry／recreate／rollback。
- Git symbolic resolvedoldOID语义已实测：目标rawtype竞争不受oldOID原子保护；再次direct检查只是观察，不把它当无窗口保证。
