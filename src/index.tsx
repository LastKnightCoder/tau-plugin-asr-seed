import { definePlugin } from "@tau/plugins";
import { createSeedASR, MODEL_ID, parseConfig } from "./provider";
declare const __PLUGIN_META__: { id: string; name: string; version: string };

export default definePlugin({
  ...__PLUGIN_META__,
  create: () => ({
    activate(context) {
      context.asr.register({
        id: context.pluginId,
        name: __PLUGIN_META__.name,
        create: (config, modelId) => createSeedASR(context.websocket, config, modelId),
      });
      context.settings.register({
        id: "asr",
        title: "豆包语音",
        target: "asr",
        models: [{ id: MODEL_ID }],
        form: {
          groups: [
            {
              title: "账号",
              description: "需在豆包语音控制台开通「流式语音识别 2.0」。录音会发送到豆包语音服务识别。",
              link: { label: "控制台", url: "https://console.volcengine.com/speech/new/" },
              fields: [
                { key: "apiKey", label: "API Key", type: "secret", description: "在控制台「API Key 管理」中创建" },
                {
                  key: "resourceId",
                  label: "计费资源",
                  type: "choice",
                  default: "volc.seedasr.sauc.duration",
                  description: "需与控制台开通的资源一致",
                  options: [
                    { value: "volc.seedasr.sauc.duration", label: "按时长", description: "按识别音频时长计费，适合个人日常输入" },
                    { value: "volc.seedasr.sauc.concurrent", label: "按并发", description: "按购买的并发路数计费，需在控制台单独开通" },
                  ],
                },
              ],
            },
          ],
          beforeSave: async values => parseConfig(values),
        },
      });
    },
  }),
});
