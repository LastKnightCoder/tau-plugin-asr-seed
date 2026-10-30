import {
  ASRError,
  createASRStreamSession,
  type ASRInstance,
  type JsonValue,
  type PluginWebSocket,
} from "@tau/plugins";
import { encodeRequest, decodeResponse } from "./protocol";
import { SeedResults } from "./results";

export const MODEL_ID = "seed-asr-2.0";
export function parseConfig(value: JsonValue) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.apiKey !== "string" ||
    !value.apiKey.trim()
  )
    throw new Error("请填写豆包语音控制台的 API Key");
  const resourceId = value.resourceId ?? "volc.seedasr.sauc.duration";
  if (!["volc.seedasr.sauc.duration", "volc.seedasr.sauc.concurrent"].includes(String(resourceId)))
    throw new Error("请选择流式识别 2.0 的计费资源");
  return { apiKey: value.apiKey.trim(), resourceId: String(resourceId) };
}
export function createSeedASR(
  websocket: PluginWebSocket,
  value: JsonValue,
  modelId: string
): ASRInstance {
  const stored = structuredClone(value);
  const capabilities = {
    execution: "remote" as const,
    textUpdates: "partial" as const,
    timestamps: "segment" as const,
    speakerLabels: false,
    acceptedAudio: {
      streamFormats: [
        { encoding: "pcm-s16le" as const, sampleRateHz: 16000, channels: 1 as const },
      ],
    },
    maxDurationMs: 120000,
  };
  return {
    async probe(request, signal) {
      signal.throwIfAborted();
      if (
        request.input !== "stream" ||
        !["zh-CN", "zh", "en-US", "en", "auto"].includes(request.language)
      )
        return { ...capabilities, state: "unsupported", reason: "此提供方仅支持中英实时语音输入" };
      try {
        if (modelId !== MODEL_ID) throw new Error("请保存识别模型配置");
        parseConfig(stored);
        return { ...capabilities, state: "ready" };
      } catch (error) {
        return {
          ...capabilities,
          state: "needs-config",
          reason: error instanceof Error ? error.message : "账号未配置",
        };
      }
    },
    async openStream(request, options) {
      if (modelId !== MODEL_ID) throw new Error("识别模型不受支持");
      if (
        request.format.encoding !== "pcm-s16le" ||
        request.format.channels !== 1 ||
        request.format.sampleRateHz !== 16000
      )
        throw new Error("此模型需要 16 kHz 单声道 PCM Int16");
      const config = parseConfig(stored);
      const lifetime = new AbortController();
      const signal = AbortSignal.any([options.signal, lifetime.signal]);
      let failure: unknown;
      const socket = websocket.connect(
        "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
        [],
        {
          signal,
          headers: {
            "X-Api-Key": config.apiKey,
            "X-Api-Resource-Id": config.resourceId,
            "X-Api-Request-Id": options.taskId,
            "X-Api-Connect-Id": options.taskId,
            "X-Api-Sequence": "-1",
          },
        }
      );
      socket.binaryType = "arraybuffer";
      const session = createASRStreamSession(
        { ...options, signal },
        request.format,
        async (signal, emit) => {
          const results = new SeedResults();
          let sequence = 1;
          let ended = false;
          const initial = new TextEncoder().encode(
            JSON.stringify({
              user: { uid: "tau" },
              audio: { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 },
              request: {
                model_name: "bigmodel",
                result_type: "full",
                show_utterances: true,
                enable_nonstream: true,
                enable_itn: true,
                enable_punc: true,
                end_window_size: 800,
              },
            })
          );
          let resolveOpen!: () => void;
          let rejectOpen!: (error: unknown) => void;
          const opened = new Promise<void>((resolve, reject) => {
            resolveOpen = resolve;
            rejectOpen = reject;
          });
          const receiving = new Promise<ReturnType<SeedResults["transcript"]>>(
            (resolve, reject) => {
              socket.onopen = () => resolveOpen();
              const fail = (error: unknown) => {
                rejectOpen(error);
                reject(error);
              };
              socket.onerror = event =>
                fail(
                  new ASRError(
                    "unavailable",
                    "message" in event && typeof event.message === "string" && event.message
                      ? event.message
                      : "语音连接失败，请检查网络与账号"
                  )
                );
              socket.onclose = () => fail(new ASRError("internal", "语音服务在返回最终文字前断开"));
              socket.onmessage = event => {
                try {
                  signal.throwIfAborted();
                  if (!(event.data instanceof ArrayBuffer))
                    throw new ASRError("protocol", "语音服务未返回二进制结果");
                  const response = decodeResponse(new Uint8Array(event.data));
                  if (response.errorCode !== undefined)
                    throw new Error(`语音服务返回错误（${response.errorCode}），请检查账号与额度`);
                  const update = results.update(response.payload, response.last);
                  if (update) emit(update);
                  if (response.last) {
                    if (!ended) throw new Error("语音服务提前结束，请缩短录音后重试");
                    resolve(results.transcript());
                  }
                } catch (error) {
                  fail(error);
                }
              };
            }
          );
          void receiving.catch(error => {
            failure = error;
            lifetime.abort();
          });
          await opened;
          signal.throwIfAborted();
          socket.send(encodeRequest("config", sequence++, initial));
          return {
            async write(frame) {
              signal.throwIfAborted();
              socket.send(encodeRequest("audio", sequence++, frame.data));
            },
            async finish() {
              ended = true;
              socket.send(encodeRequest("audio", sequence++, new Uint8Array(), true));
              return receiving;
            },
            async dispose() {
              socket.close();
              await receiving.catch(() => undefined);
            },
          };
        }
      );
      const result = session.result
        .catch(error => {
          throw failure ?? error;
        })
        .finally(() => socket.close());
      void result.catch(() => undefined);
      return {
        ...session,
        result,
        async cancel() {
          lifetime.abort();
          await session.cancel();
          await result.catch(() => undefined);
        },
      };
    },
  };
}
