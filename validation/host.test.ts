import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { describe, expect, it, vi } from "vitest";
import * as sdk from "@tau/plugins";
import { PluginHost, createMemoryStorage } from "@tau/test-host";
import { evaluatePortablePluginPackage } from "@tau/test-rendering";
import { ASRProviderRegistry } from "@tau/test-registry";
import { createBridgeWebSocket } from "@tau/test-websocket";
import { gunzipSync } from "fflate";
class Close extends Event {
  constructor(type: string, init: any) {
    super(type);
    Object.assign(this, { code: init.code, reason: init.reason, wasClean: init.wasClean });
  }
}
vi.stubGlobal("CloseEvent", Close);
function response(text: string, last: boolean) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      result: {
        text,
        utterances: text ? [{ text, definite: last, start_time: 0, end_time: 200 }] : [],
      },
    })
  );
  const packet = new Uint8Array(8 + bytes.length);
  packet.set([0x11, last ? 0x92 : 0x90, 0x10, 0]);
  new DataView(packet.buffer).setUint32(4, bytes.length, false);
  packet.set(bytes, 8);
  return packet;
}
async function fixture(platform: "desktop" | "android" | "ios", mode = "normal") {
  const report = JSON.parse(readFileSync("dist/tau-build-tau.asr-seed.json", "utf8"));
  const directory = path.join("dist", report.directory);
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const definition = evaluatePortablePluginPackage(
    { manifest, code: readFileSync(path.join(directory, "main.js"), "utf8") },
    { "@tau/plugins": sdk, react: React, "react/jsx-runtime": jsx, "@tau/ui": {} },
    {
      appVersion: "1.0.0",
      profiles: ["web-v1"],
      environment: {
        platform,
        input: { coarsePointer: platform !== "desktop", finePointer: platform === "desktop" },
      },
    }
  );
  const registry = new ASRProviderRegistry();
  const received: Uint8Array[] = [];
  let reader: ((event: any) => void) | undefined;
  const queue: any[] = [];
  const deliver = (event: any) => {
    if (reader) {
      const done = reader;
      reader = undefined;
      done(event);
    } else queue.push(event);
  };
  let handshake: any;
  const dispose = vi.fn(async () =>
    deliver({ type: "close", code: 1006, reason: "", wasClean: false })
  );
  const websocket = createBridgeWebSocket({
    open: async (_id: string, request: any) => {
      handshake = request;
      if (mode === "handshake-error") throw new Error("private detail");
      if (mode === "auth-error") throw new Error("WebSocket 握手失败（HTTP 401）");
      if (mode === "permission-error") throw new Error("WebSocket 握手失败（HTTP 403）");
      if (mode === "tls-error") throw new Error("WebSocket TLS 安全连接失败");
      return { protocol: "", extensions: "" };
    },
    send: async (_id: string, message: Uint8Array) => {
      received.push(message);
      const kind = message[1] >> 4;
      if (kind === 2 && message[1] & 2) {
        if (mode === "disconnect")
          deliver({ type: "close", code: 1006, reason: "", wasClean: false });
        else
          setTimeout(
            () =>
              deliver({
                type: "message",
                data: response(mode === "silence" ? "" : "春夏秋冬雨", true),
              }),
            20
          );
      } else if (kind === 2) deliver({ type: "message", data: response("春夏秋", false) });
    },
    receive: async () =>
      queue.length
        ? queue.shift()
        : new Promise(resolve => {
            reader = resolve;
          }),
    close: async (_id: string, code: number, reason: string) =>
      deliver({ type: "close", code: code ?? 1005, reason: reason ?? "", wasClean: true }),
    dispose,
  });
  const host = new PluginHost({
    workspaceId: "test",
    storage: createMemoryStorage(),
    asr: registry,
    websocket,
    settings: { register: () => ({ dispose() {}, open() {} }) },
  });
  host.registerTrusted(definition);
  await host.enable("tau.asr-seed");
  const events: any[] = [];
  const session = await registry.openStream(
    "tau.asr-seed",
    { apiKey: "fixture-only" },
    "seed-asr-2.0",
    { language: "zh-CN", format: { encoding: "pcm-s16le", sampleRateHz: 16000, channels: 1 } },
    {
      taskId: "fixture",
      signal: new AbortController().signal,
      onEvent: (event: any) => events.push(event),
    }
  );
  return {
    host,
    session,
    events,
    received,
    dispose,
    get handshake() {
      return handshake;
    },
  };
}
describe("真实构建产物接入宿主", () => {
  for (const platform of ["desktop", "android", "ios"] as const)
    it(`${platform}：事件输入、临时修订、结束标记与尾句`, async () => {
      const test = await fixture(platform);
      try {
        await test.session.write({ seq: 0, startSample: 0, data: new Uint8Array(6400) });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(
          test.events.some(
            event => event.type === "segments" && event.segments[0].text === "春夏秋"
          )
        ).toBe(true);
        await test.session.endInput();
        const result = await test.session.result;
        expect(result.text).toBe("春夏秋冬雨");
        expect(test.handshake.headers["X-Api-Key"]).toBe("fixture-only");
        const packets = test.received;
        expect(packets.map(packet => packet[1] >> 4)).toEqual([1, 2, 2]);
        expect(new DataView(packets[2].buffer).getInt32(4, false)).toBe(-3);
        expect(gunzipSync(packets[2].subarray(12))).toHaveLength(0);
      } finally {
        await test.host.dispose();
      }
    });
  for (const mode of ["disconnect", "handshake-error"])
    it(`${mode}：不能当作成功或泄露网络内部错误`, async () => {
      const test = await fixture("desktop", mode);
      try {
        if (mode !== "handshake-error") {
          await test.session.write({ seq: 0, startSample: 0, data: new Uint8Array(2) });
          await test.session.endInput();
        }
        await expect(test.session.result).rejects.toThrow();
      } finally {
        await test.host.dispose();
      }
    });
  for (const [mode, message] of [
    ["auth-error", "服务鉴权失败（HTTP 401）"],
    ["permission-error", "服务拒绝访问（HTTP 403）"],
    ["tls-error", "WebSocket TLS 安全连接失败"],
  ])
    it(`${mode}：保留宿主脱敏后的连接失败原因`, async () => {
      const test = await fixture("android", mode);
      try {
        await expect(test.session.result).rejects.toThrow(message);
      } finally {
        await test.host.dispose();
      }
    });
  it("停用插件回收连接并取消尚未结束的识别", async () => {
    const test = await fixture("android");
    await test.session.write({ seq: 0, startSample: 0, data: new Uint8Array(2) });
    await test.host.disable("tau.asr-seed");
    await expect(test.session.result).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(test.dispose).toHaveBeenCalled();
    await test.host.dispose();
  });
  it("静音最终结果为空，不保留临时草稿", async () => {
    const test = await fixture("ios", "silence");
    try {
      await test.session.endInput();
      expect((await test.session.result).text).toBe("");
    } finally {
      await test.host.dispose();
    }
  });
});
