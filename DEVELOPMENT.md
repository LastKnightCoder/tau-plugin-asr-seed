# 开发与验证

此仓库只实现 Seed 协议、账号表单和结果归约。麦克风、PCM 转换、连接传输、输入目标与持久设置由 Tau 宿主提供。

## 接口与版本

代码依赖 SDK 0.43.0 的 context.asr、context.websocket 和 asrConfig。正式发行使用 npm 注册表中的精确版本与 pnpm-lock.yaml，不使用本机依赖路径。

先校验 SDK 可从 npm 安装，再冻结安装、测试、构建并推送版本标签。当前使用 GitHub Release 上传 ZIP，再在插件中心提交同一份 ZIP 并绑定公开源码仓库。仓库尚未启用自动发行工作流；后续获得 workflow 权限后可接入模板的 GitHub Actions OIDC 流程。候选验证仍只在仓库外注入 tarball，不伪造注册表记录。

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
