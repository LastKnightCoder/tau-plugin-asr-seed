import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tau/plugins", () => ({}));
import { parseFileResult, recognizeSeedFile } from "./file";

const ok = (body: unknown = {}, code = "20000000") =>
  new Response(JSON.stringify(body), { status: 200, headers: { "X-Api-Status-Code": code } });
const denied = () => new Response("{}", { status: 403, headers: { "X-Api-Status-Code": "45000030" } });
const result = {
  result: {
    text: "你好世界",
    utterances: [
      { text: "你好", start_time: 0, end_time: 600 },
      { text: "世界", start_time: 700, end_time: 1300 },
    ],
  },
  audio_info: { duration: 1300 },
};

function audio(url?: string, mimeType = "audio/ogg", sizeBytes = 3) {
  return {
    name: "a",
    mimeType,
    sizeBytes,
    ...(url ? { url } : {}),
    open: async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
  };
}

function run(
  fetch: typeof globalThis.fetch,
  url?: string,
  signal = new AbortController().signal,
  file = audio(url)
) {
  const emit = vi.fn();
  const result = recognizeSeedFile(
    fetch,
    { apiKey: "k" },
    { language: "zh-CN", audio: file },
    "t",
    signal,
    emit
  );
  void result.catch(() => undefined);
  return { task: { result }, emit };
}

const calls = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.map(([input, init]) => ({
    url: String(input).replace("https://openspeech.bytedance.com/api/v3/auc/bigmodel", ""),
    resource: new Headers((init as RequestInit).headers).get("X-Api-Resource-Id"),
    body: JSON.parse(String((init as RequestInit).body)),
  }));

describe("Seed 录音文件识别", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("有地址：标准版提交后轮询，排队中继续等，成功返回分句", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok({}, "20000002"))
      .mockResolvedValueOnce(ok(result));
    const { task } = run(fetch, "https://cdn.example.com/a.ogg");
    await vi.runAllTimersAsync();
    const transcript = await task.result;
    expect(transcript.segments?.map(s => [s.text, s.startMs, s.final])).toEqual([
      ["你好", 0, true],
      ["世界", 700, true],
    ]);
    const sent = calls(fetch);
    expect(sent.map(call => [call.url, call.resource])).toEqual([
      ["/submit", "volc.seedasr.auc"],
      ["/query", "volc.seedasr.auc"],
      ["/query", "volc.seedasr.auc"],
    ]);
    expect(sent[0].body.audio).toEqual({
      url: "https://cdn.example.com/a.ogg",
      format: "ogg",
      codec: "opus",
    });
  });

  it("标准版未开通：改用极速版上传字节", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(denied()).mockResolvedValueOnce(ok(result));
    const { task } = run(fetch, "https://cdn.example.com/a.ogg");
    await vi.runAllTimersAsync();
    await expect(task.result).resolves.toMatchObject({ text: "你好世界" });
    const sent = calls(fetch);
    expect(sent[1].url).toBe("/recognize/flash");
    expect(sent[1].resource).toBe("volc.bigasr.auc_turbo");
    expect(sent[1].body.audio).toEqual({ data: "AQID", format: "ogg", codec: "opus" });
  });

  it("没有地址只走极速版；两个版本都未开通时报可读错误", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(denied());
    const { task } = run(fetch);
    await vi.runAllTimersAsync();
    await expect(task.result).rejects.toThrow("未开通录音文件识别");
    expect(calls(fetch).map(call => call.url)).toEqual(["/recognize/flash"]);
  });

  it("轮询中取消：不再查询，不改用极速版", async () => {
    // 每次返回新的 Response：正文只能读一次
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async input => (String(input).endsWith("/submit") ? ok() : ok({}, "20000001")));
    const controller = new AbortController();
    const { task } = run(fetch, "https://cdn.example.com/a.ogg", controller.signal);
    await vi.advanceTimersByTimeAsync(2500);
    const before = fetch.mock.calls.length;
    controller.abort();
    await vi.runAllTimersAsync();
    await expect(task.result).rejects.toThrow();
    expect(before).toBe(2);
    expect(calls(fetch).map(call => call.url)).toEqual(["/submit", "/query"]);
  });

  it("按宿主交来的格式传参：MP3 原样上传", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(ok(result));
    const { task } = run(fetch, undefined, undefined, audio(undefined, "audio/mpeg"));
    await vi.runAllTimersAsync();
    await task.result;
    expect(calls(fetch)[0].body.audio).toEqual({ data: "AQID", format: "mp3" });
  });

  it("没有地址且超过 100 MB：不发请求，提示放到远程存储", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { task } = run(fetch, undefined, undefined, audio(undefined, "audio/ogg", 101 * 1024 * 1024));
    await vi.runAllTimersAsync();
    await expect(task.result).rejects.toThrow("远程存储");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("静音返回空文字稿；分句缺时间时不补假值", () => {
    expect(parseFileResult({ result: { text: "嗯", utterances: [{ text: "嗯" }] } }).segments).toEqual([
      { id: "seed-file-0", text: "嗯", final: true },
    ]);
  });
});
