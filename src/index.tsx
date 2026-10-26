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
        title: "语音识别账号",
        target: "asr",
        models: [{ id: MODEL_ID }],
        form: {
          groups: [{ title: "语音识别账号", fields: [
            { key: "apiKey", label: "豆包语音 API Key", type: "secret" },
            { key: "resourceId", label: "计费资源", type: "choice", default: "volc.seedasr.sauc.duration", options: [
              { value: "volc.seedasr.sauc.duration", label: "按时长" },
              { value: "volc.seedasr.sauc.concurrent", label: "按并发" },
            ] },
          ] }],
          beforeSave: async values => parseConfig(values),
        },
      });
    },
  }),
});
