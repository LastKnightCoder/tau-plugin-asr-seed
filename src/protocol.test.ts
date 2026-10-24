import { describe, expect, it } from "vitest";
import { gzipSync, gunzipSync } from "fflate";
import { encodeRequest, decodeResponse } from "./protocol";
import { SeedResults } from "./results";

function response(value: unknown, last = false, compressed = true) {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const body = compressed ? gzipSync(json) : json;
  const bytes = new Uint8Array(body.length + 12);
  bytes.set([0x11, last ? 0x93 : 0x91, compressed ? 0x11 : 0x10, 0]);
  new DataView(bytes.buffer).setInt32(4, last ? -2 : 2);
  new DataView(bytes.buffer).setUint32(8, body.length);
  bytes.set(body, 12);
  return bytes;
}
describe("Seed 二进制协议与结果", () => {
  it("配置和音频使用正确序列化标记，末包序号为负", () => {
    const data = new Uint8Array([1, 0, 2, 0]);
    const first = encodeRequest("config", 1, data);
    expect([...first.subarray(0, 4)]).toEqual([0x11, 0x11, 0x11, 0]);
    const audio = encodeRequest("audio", 3, data, true);
    expect([...audio.subarray(0, 4)]).toEqual([0x11, 0x23, 0x01, 0]);
    expect(new DataView(audio.buffer).getInt32(4)).toBe(-3);
    expect(gunzipSync(audio.subarray(12))).toEqual(data);
  });
  it("接受 gzip 与未压缩 JSON，尊重末包标记", () => {
    const payload = { result: { text: "中文" } };
    expect(decodeResponse(response(payload))).toEqual({ last: false, payload });
    expect(decodeResponse(response(payload, true, false))).toEqual({ last: true, payload });
  });
  it("拒绝截断、错误长度和超限解压声明", () => {
    const bytes = response({ result: { text: "正常" } });
    expect(() => decodeResponse(bytes.subarray(0, 7))).toThrow();
    expect(() => decodeResponse(bytes.subarray(0, bytes.length - 1))).toThrow();
    new DataView(bytes.buffer).setUint32(bytes.length - 4, 10 * 1024 * 1024, true);
    expect(() => decodeResponse(bytes)).toThrow("过大");
  });
  it("错误帧不把服务端正文回显为错误消息", () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x11, 0xf0, 0, 0]);
    new DataView(bytes.buffer).setUint32(4, 45000000);
    expect(decodeResponse(bytes)).toEqual({ last: true, errorCode: 45000000 });
  });
  it("修订替换临时结果，最终包确认尾句而不是重复拼接", () => {
    const state = new SeedResults();
    const one = state.update(
      {
        result: {
          text: "三点",
          utterances: [{ text: "三点", definite: false, start_time: 0, end_time: 800 }],
        },
      },
      false
    );
    const two = state.update(
      {
        result: {
          text: "三点半",
          utterances: [{ text: "三点半", definite: false, start_time: 0, end_time: 1000 }],
        },
      },
      true
    );
    expect(one).toMatchObject({ startIndex: 0, deleteCount: 0, revision: 1 });
    expect(two).toMatchObject({ startIndex: 0, deleteCount: 1, revision: 2 });
    expect(state.transcript().text).toBe("三点半");
    expect(state.transcript().segments?.[0].final).toBe(true);
  });
  it("已确认段被修改时失败，空音频可完成为空文字", () => {
    const state = new SeedResults();
    state.update(
      { result: { text: "已定", utterances: [{ text: "已定", definite: true }] } },
      false
    );
    expect(() =>
      state.update(
        { result: { text: "改写", utterances: [{ text: "改写", definite: true }] } },
        true
      )
    ).toThrow("改写");
    const silent = new SeedResults();
    silent.update(undefined, true);
    expect(silent.transcript()).toEqual({ text: "", segments: [] });
  });
});
