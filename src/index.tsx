import { useState } from "react";
import { definePlugin, type PluginSettingsProps } from "@tau/plugins";
import { Button, Input, SettingRow } from "@tau/ui";
import { createSeedASR, MODEL_ID, parseConfig } from "./provider";

declare const __PLUGIN_META__: { id: string; name: string; version: string };
function Settings({ context, asrConfig }: PluginSettingsProps) {
  const value = asrConfig?.value;
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const [apiKey, setApiKey] = useState(typeof stored.apiKey === "string" ? stored.apiKey : "");
  const [resourceId, setResourceId] = useState(
    typeof stored.resourceId === "string" ? stored.resourceId : "volc.seedasr.sauc.duration"
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  if (!asrConfig) return <p>请在语音输入设置中配置账号。</p>;
  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      context.signal.throwIfAborted();
      await asrConfig.save(parseConfig({ apiKey, resourceId }), MODEL_ID);
      if (!context.signal.aborted) setMessage("账号已保存，可在宿主中选用。");
    } catch (error) {
      if (!context.signal.aborted) setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      if (!context.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <SettingRow title="API Key">
        <Input
          type="password"
          autoComplete="off"
          aria-label="豆包语音 API Key"
          value={apiKey}
          onChange={event => setApiKey(event.target.value)}
        />
      </SettingRow>
      <SettingRow title="计费资源">
        <select
          aria-label="计费资源"
          className="bg-surface text-ink-1 rounded-tau-md p-2"
          value={resourceId}
          onChange={event => setResourceId(event.target.value)}
        >
          <option value="volc.seedasr.sauc.duration">按时长</option>
          <option value="volc.seedasr.sauc.concurrent">按并发</option>
        </select>
      </SettingRow>
      <p className="text-tau-meta text-ink-3">
        使用豆包语音控制台开通的流式识别 2.0 资源。音频会发送给所配置的语音服务。
      </p>
      <Button variant="secondary" loading={busy} onClick={() => void save()}>
        保存账号
      </Button>
      {message && (
        <p role="status" className="text-tau-meta">
          {message}
        </p>
      )}
    </div>
  );
}
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
        component: Settings,
      });
    },
  }),
});
