import { messages } from "./i18n";
import { definePlugin } from "@tau/plugins";
import { createSeedASR, MODEL_ID, parseConfig } from "./provider";
declare const __PLUGIN_META__: { id: string; name: string; version: string };

export default definePlugin({
  ...__PLUGIN_META__,
  i18n: messages,
  create: () => ({
    activate(context) {
      context.asr.register({
        id: context.pluginId,
        name: __PLUGIN_META__.name,
        create: (config, modelId) =>
          createSeedASR(context.websocket, context.fetch, config, modelId),
      });
      context.settings.register({
        id: "asr",
        title: "豆包语音",
        target: "asr",
        models: [{ id: MODEL_ID }],
        form: {
          groups: [
            {
              title: messages.ref("account.title"),
              description: messages.ref("account.description"),
              link: {
                label: messages.ref("account.console"),
                url: "https://console.volcengine.com/speech/new/",
              },
              fields: [
                {
                  key: "apiKey",
                  label: messages.ref("apiKey.label"),
                  type: "secret",
                  description: messages.ref("apiKey.description"),
                },
                {
                  key: "resourceId",
                  label: messages.ref("resource.label"),
                  type: "choice",
                  default: "volc.seedasr.sauc.duration",
                  description: messages.ref("resource.description"),
                  options: [
                    {
                      value: "volc.seedasr.sauc.duration",
                      label: messages.ref("resource.duration.label"),
                      description: messages.ref("resource.duration.description"),
                    },
                    {
                      value: "volc.seedasr.sauc.concurrent",
                      label: messages.ref("resource.concurrent.label"),
                      description: messages.ref("resource.concurrent.description"),
                    },
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
