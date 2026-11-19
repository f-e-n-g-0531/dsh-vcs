# 文档入口

从[项目说明](<../README.md>)了解可用功能，再按使用或维护场景查阅下列文档。

## 我要安装或使用

- [安装、升级与回滚](<INSTALL.md>)：具体命令和安装后检查。
- [运行环境与兼容性](<COMPATIBILITY.md>)：DSH、Node.js、操作系统与 Windows 下的 SVN 中文路径问题。
- [实机验证状态](<LIVE-ACCEPTANCE.md>)：哪些是用户实际反馈，哪些仅有自动测试。
- [SVN 远程历史与认证](<SVN-RUNTIME-SCOPE.md>)：网络授权、HTTPS Basic 与 401 排查。
- [安全说明](<../SECURITY.md>)：插件会读什么、保护什么、不能保证什么。
- [更新记录](<../CHANGELOG.md>)：每个版本改了什么。

## 我要开发或维护

- [贡献指南](<../CONTRIBUTING.md>)：准备环境、运行检查、提交要求。
- [架构说明](<ARCHITECTURE.md>)：模块分工和调用方向。
- [当前能力与验证入口](<CURRENT-CAPABILITIES.md>)：实现、测试、边界及旧计划的区别。
- [维护者发布流程](<RELEASING.md>)：测试、标签、发布与失败恢复。
- [常用术语](<GLOSSARY.md>)：Session、OID、RPC等词的含义。
- [第三方许可](<../THIRD_PARTY_NOTICES.md>)。

## 我要了解功能边界

- [已交付功能](<REVIEW-ROADMAP.md>)与[历史功能计划](<FEATURE-PLAN.md>)。
- [SVN 历史协议](<SVN-HISTORY-DESIGN.md>)：固定修订、传输与授权生命周期。
- [两个提交的比较](<REVISION-COMPARE-DESIGN.md>)、[重命名追溯](<RENAME-FOLLOW-SCOPE.md>)、[Blame定位](<BLAME-LOCATION-SCOPE.md>)。
- [图片范围](<IMAGE-EXTENSION-SCOPE.md>)、[JPEG](<JPEG-SCOPE.md>)、[WebP](<WEBP-SCOPE.md>)及[大文件阅读](<LARGE-FILE-SCOPE.md>)。

## 旧版本材料

`CANDIDATE-*.md` 和 `RELEASE-*.md` 分别保留当时的候选检查与发布记录。各版本说明见 [releases](<releases>)。这些材料用于追溯，不代表当前功能或实机验收状态。
