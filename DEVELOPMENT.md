# 开发与验证

此仓库只实现 Seed 协议、账号表单和结果归约。麦克风、PCM 转换、连接传输、输入目标与持久设置由 Tau 宿主提供。

## 接口与候选版本

代码依赖 SDK 0.43.0 的 context.asr、context.websocket 和 asrConfig。此源码版本属于候选接入，不代表 SDK 已发布 npm 或插件已上架。SDK 未发布时，在仓库外副本安装主仓库生成的 SDK tarball 再构建，不提交本机路径或把候选包冒充 npm 发行物。

发布 SDK 后，按 package.json 的 npm 别名生成并提交 pnpm-lock.yaml，执行冻结安装再发行本插件；未取得可下载的正式 SDK 时不伪造 registry 锁文件。当前不创建发行标签，不上传插件中心。

## 运行

```bash
pnpm install
pnpm test
pnpm build
```

发布前必须验证桌面、Android、iOS 对应宿主；构建通过不等于真实账号的识别质量或费用已验证。单元测试只使用合成协议包，不接触真实密钥；使用真实账号验证时，在宿主设置表单中填写密钥，不写进源码、脚本或报告。

## 协议依据

- [火山引擎实时识别 API](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)
- [火山引擎官方二进制协议实现](https://github.com/volcengine/ai-app-lab/blob/88c983d70a098110fc839f8cd05e29fa7715e6ce/arkitect/utils/binary_protocol.py)
- [火山引擎官方 ASR 数据模型](https://github.com/volcengine/ai-app-lab/blob/88c983d70a098110fc839f8cd05e29fa7715e6ce/arkitect/core/component/asr/model.py)

使用 V1 二进制帧，配置与音频分别编码，发送递增正序号，最终空音频包使用负序号及末包标记。配置启用二遍识别和 VAD 句界；结果选择 full，按完整分句快照归约。中间文字可替换，已确定分句不得被后续包无声改写。最终结果只在结束输入且收到服务端末包后交付。

WebSocket、SDK 的任务控制器由宿主提供，因此协议与结果纯函数可独立单测，提供方整体在宿主集成测试中装配真实 SDK 验证。

## WebSocket 与宿主集成测试

连接使用 `context.websocket.connect(url, [], { headers, signal })`，同步取得 CONNECTING 连接。通过 onopen/onmessage/onerror/onclose 观察连接；binaryType 固定 arraybuffer，send/close 均返回 void，背压由宿主管理。finish 发结束标记后等服务端末包，不用关闭连接代替完成识别。

在已构建的仓库外副本中运行：

```bash
TAU_HOST_ROOT=/绝对路径/editor pnpm exec vitest run --config validation/vitest.host.config.ts
```

该测试加载实际构建产物，用宿主源码的公开 API 实现、PluginHost、ASR 注册表及标准 WebSocket 适配器验证三种平台声明、临时修订、尾句、停用、断线和握手失败。厂商服务由合成协议夹具代替，不访问账号、不验证界面，也不冒充手机真机测试。
