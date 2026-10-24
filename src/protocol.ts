import { gzipSync, gunzipSync } from "fflate";

const MAX_PAYLOAD = 1024 * 1024;
export function encodeRequest(
  type: "config" | "audio",
  sequence: number,
  payload: Uint8Array,
  last = false
): Uint8Array {
  const compressed = gzipSync(payload, { mtime: 0 });
  const packet = new Uint8Array(12 + compressed.length);
  packet.set([
    0x11,
    ((type === "config" ? 1 : 2) << 4) | (last ? 3 : 1),
    (type === "config" ? 0x10 : 0) | 1,
    0,
  ]);
  const view = new DataView(packet.buffer);
  view.setInt32(4, last ? -sequence : sequence, false);
  view.setUint32(8, compressed.length, false);
  packet.set(compressed, 12);
  return packet;
}
export interface SeedResponse {
  last: boolean;
  payload?: Record<string, unknown>;
  errorCode?: number;
}
export function decodeResponse(packet: Uint8Array): SeedResponse {
  if (packet.length < 8 || packet[0] >> 4 !== 1) throw new Error("语音服务返回了无效协议头");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const type = packet[1] >> 4,
    flags = packet[1] & 15;
  let offset = (packet[0] & 15) * 4;
  if (offset < 4 || flags > 3) throw new Error("语音服务协议版本不受支持");
  const take = () => {
    if (offset + 4 > packet.length) throw new Error("语音服务响应不完整");
    const value = view.getUint32(offset, false);
    offset += 4;
    return value;
  };
  if (flags & 1) take();
  if (type === 11) return { last: false };
  if (type !== 9 && type !== 15) throw new Error("语音服务响应类型不受支持");
  const errorCode = type === 15 ? take() : undefined;
  const size = take();
  if (size > MAX_PAYLOAD || offset + size !== packet.length)
    throw new Error("语音服务响应长度无效");
  if (errorCode !== undefined) return { last: true, errorCode };
  let bytes = packet.subarray(offset);
  const compression = packet[2] & 15;
  if (compression === 1) {
    if (bytes.length < 18) throw new Error("语音服务压缩数据不完整");
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      bytes.length - 4,
      true
    );
    if (length > MAX_PAYLOAD) throw new Error("语音服务解压结果过大");
    bytes = gunzipSync(bytes, { out: new Uint8Array(length) });
  } else if (compression !== 0) throw new Error("语音服务压缩格式不受支持");
  if (packet[2] >> 4 !== 1) throw new Error("语音服务结果必须为 JSON");
  const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("语音识别结果无效");
  return { last: Boolean(flags & 2), payload: payload as Record<string, unknown> };
}
