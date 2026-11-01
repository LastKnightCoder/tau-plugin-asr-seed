import {
  ASRError,
  createASRTask,
  type ASREventPayload,
  type ASRFileRequest,
  type ASRRunOptions,
  type ASRSegment,
  type ASRTask,
  type ASRTranscript,
} from "@tau/plugins";

const HOST = "https://openspeech.bytedance.com/api/v3/auc/bigmodel";
/** 标准版：音频按地址下载，提交后轮询 */
const STANDARD_RESOURCE = "volc.seedasr.auc";
/** 极速版：请求里直接带音频，一次返回 */
const FLASH_RESOURCE = "volc.bigasr.auc_turbo";
const OK = "20000000";
const PENDING = new Set(["20000001", "20000002"]);
const SILENT = "20000003";
const POLL_START_MS = 2000;
const POLL_MAX_MS = 5000;
/** 标准版排队加识别的等待上限 */
const STANDARD_TIMEOUT_MS = 30 * 60 * 1000;
/** 极速版单次 100 MB（时长另有 2 小时上限，由服务端判断） */
const FLASH_MAX_BYTES = 100 * 1024 * 1024;

/** 两个版本都收的格式；宿主只会交来其中一种 */
const FORMATS: Record<string, { format: string; codec?: string }> = {
  "audio/ogg": { format: "ogg", codec: "opus" },
  "audio/mpeg": { format: "mp3" },
  "audio/wav": { format: "wav" },
};
export const FILE_MIME_TYPES = Object.keys(FORMATS);

type Config = { apiKey: string };

/** SDK 0.48 的类型还没有 url；宿主有远程副本时提供 */
const audioUrl = (request: ASRFileRequest) => {
  const url = (request.audio as { url?: unknown }).url;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : undefined;
};

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const time = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** 结果正文：分句全部视为最终结果 */
export function parseFileResult(body: unknown): ASRTranscript {
  const result = object(object(body)?.result);
  const utterances = Array.isArray(result?.utterances) ? result.utterances : [];
  const segments: ASRSegment[] = [];
  utterances.forEach((value, index) => {
    const row = object(value);
    if (!row || typeof row.text !== "string" || !row.text.trim()) return;
    const startMs = time(row.start_time);
    const endMs = time(row.end_time);
    segments.push({
      id: `seed-file-${index}`,
      text: row.text,
      final: true,
      ...(startMs !== undefined && endMs !== undefined && startMs <= endMs
        ? { startMs, endMs }
        : {}),
    });
  });
  const text =
    typeof result?.text === "string" ? result.text : segments.map(segment => segment.text).join("");
  const duration = time(object(object(body)?.audio_info)?.duration);
  return { text, segments, ...(duration !== undefined ? { durationMs: duration } : {}) };
}

class SeedFileError extends Error {
  constructor(
    message: string,
    /** 极速版还能接着试 */
    readonly fallback: boolean,
    /** 音频本身不符合要求（超出上限等），而不是服务或账号问题 */
    readonly invalidInput = false
  ) {
    super(message);
  }
}

function statusError(response: Response, code: string | null): SeedFileError {
  if (response.status === 401) return new SeedFileError("API Key 无效，请检查账号", false);
  if (response.status === 403)
    return new SeedFileError("账号未开通录音文件识别，请在豆包语音控制台开通", true);
  // 协议错误只展示错误码，不回显服务端正文
  return new SeedFileError(`录音文件识别返回错误（${code ?? response.status}）`, true);
}

function headers(config: Config, resource: string, requestId: string) {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": config.apiKey,
    "X-Api-Resource-Id": resource,
    "X-Api-Request-Id": requestId,
    "X-Api-Sequence": "-1",
  };
}

const requestBody = (request: ASRFileRequest, audio: Record<string, unknown>) => ({
  user: { uid: "tau" },
  audio: { ...audio, ...FORMATS[request.audio.mimeType] },
  request: {
    model_name: "bigmodel",
    enable_itn: true,
    enable_punc: true,
    show_utterances: true,
  },
});

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function standard(
  fetch: typeof globalThis.fetch,
  config: Config,
  request: ASRFileRequest,
  url: string,
  requestId: string,
  signal: AbortSignal
): Promise<ASRTranscript> {
  const init = (body: unknown) => ({
    method: "POST",
    headers: headers(config, STANDARD_RESOURCE, requestId),
    body: JSON.stringify(body),
    signal,
  });
  const submitted = await fetch(`${HOST}/submit`, init(requestBody(request, { url })));
  const submitCode = submitted.headers.get("X-Api-Status-Code");
  if (!submitted.ok || submitCode !== OK) throw statusError(submitted, submitCode);
  const deadline = Date.now() + STANDARD_TIMEOUT_MS;
  let delay = POLL_START_MS;
  while (Date.now() < deadline) {
    await wait(delay, signal);
    delay = Math.min(POLL_MAX_MS, delay + 1000);
    const queried = await fetch(`${HOST}/query`, init({}));
    const code = queried.headers.get("X-Api-Status-Code");
    if (code && PENDING.has(code)) continue;
    if (code === SILENT) return { text: "", segments: [] };
    // 下载失败等在查询时才暴露，交给极速版重试
    if (!queried.ok || code !== OK) throw statusError(queried, code);
    return parseFileResult(await queried.json());
  }
  throw new SeedFileError("录音文件识别超时", true);
}

async function readBase64(request: ASRFileRequest, signal: AbortSignal): Promise<string> {
  if (request.audio.sizeBytes > FLASH_MAX_BYTES)
    throw new SeedFileError(
      "音频超过 100 MB，需要放在可公开访问的远程存储里才能转文字",
      false,
      true
    );
  const reader = (await request.audio.open(signal)).getReader();
  let binary = "";
  for (;;) {
    signal.throwIfAborted();
    const { value, done } = await reader.read();
    if (done) break;
    for (let index = 0; index < value.length; index += 0x8000)
      binary += String.fromCharCode(...value.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function flash(
  fetch: typeof globalThis.fetch,
  config: Config,
  request: ASRFileRequest,
  requestId: string,
  signal: AbortSignal
): Promise<ASRTranscript> {
  const data = await readBase64(request, signal);
  const response = await fetch(`${HOST}/recognize/flash`, {
    method: "POST",
    headers: headers(config, FLASH_RESOURCE, requestId),
    body: JSON.stringify(requestBody(request, { data })),
    signal,
  });
  const code = response.headers.get("X-Api-Status-Code");
  if (code === SILENT) return { text: "", segments: [] };
  if (!response.ok || code !== OK) throw statusError(response, code);
  return parseFileResult(await response.json());
}

/** 有公网地址先用标准版（不受 2 小时限制）；标准版不可用或失败时用极速版上传字节。不依赖 SDK 运行时，可单测 */
export async function recognizeSeedFile(
  fetch: typeof globalThis.fetch,
  config: Config,
  request: ASRFileRequest,
  taskId: string,
  signal: AbortSignal,
  emit: (payload: ASREventPayload) => void
): Promise<ASRTranscript> {
  if (!FORMATS[request.audio.mimeType])
    throw new SeedFileError("此服务不支持这种音频格式", false, true);
  const url = audioUrl(request);
  if (url) {
    emit({ type: "progress", stage: "recognizing" });
    try {
      return await standard(fetch, config, request, url, `${taskId}-std`, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof SeedFileError) || !error.fallback) throw error;
    }
  }
  emit({ type: "progress", stage: "uploading" });
  return flash(fetch, config, request, `${taskId}-flash`, signal);
}

export function transcribeSeedFile(
  fetch: typeof globalThis.fetch,
  config: Config,
  request: ASRFileRequest,
  options: ASRRunOptions
): ASRTask {
  return createASRTask(options, async (signal, emit) => {
    try {
      return await recognizeSeedFile(fetch, config, request, options.taskId, signal, emit);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof SeedFileError)
        throw new ASRError(error.invalidInput ? "invalid-input" : "unavailable", error.message);
      throw error;
    }
  });
}
