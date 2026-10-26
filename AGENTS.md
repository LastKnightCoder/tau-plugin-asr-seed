# 插件开发约定

- SDK API 从 @tau/plugins 导入，UI 从 @tau/ui 导入；当前要求 SDK 0.47.0。
- 协议只放本仓库，禁止将 Seed 地址、封包或账号字段放进 Tau 宿主。
- 浏览器运行，不引入 Node 依赖；WebSocket 使用 context.websocket。
- 配置声明 form，由宿主在插件页保存，不写 context.storage，不提交真实密钥、录音或正文日志。
- 每次任务固定配置，支持结束输入、尾句、取消与插件停用。
- 遵循 DEVELOPMENT.md 的候选 SDK 验证和锁文件规则。发布、上架和打标签须有明确授权。
- 完成修改后运行类型检查、单元测试、构建及宿主集成验证；如实记录未完成的平台或账号验证。
