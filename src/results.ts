import type { ASREventPayload, ASRSegment, ASRTranscript } from "@tau/plugins";

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const time = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const equal = (a: ASRSegment, b: ASRSegment) =>
  a.id === b.id &&
  a.text === b.text &&
  a.final === b.final &&
  a.startMs === b.startMs &&
  a.endMs === b.endMs;

export class SeedResults {
  private segments: ASRSegment[] = [];
  private text = "";
  private revision = 0;
  update(payload: Record<string, unknown> | undefined, last: boolean): ASREventPayload | undefined {
    const result = object(payload?.result);
    let next = this.segments.map(segment => ({ ...segment, final: last || segment.final }));
    if (result) {
      if (typeof result.text === "string") this.text = result.text;
      if (Array.isArray(result.utterances) && result.utterances.length) {
        next = result.utterances.map((value, index) => {
          const row = object(value);
          if (!row || typeof row.text !== "string") throw new Error("识别分句缺少文本");
          return {
            id: `seed-${index}`,
            text: row.text,
            final: last || row.definite === true,
            ...(time(row.start_time) !== undefined ? { startMs: time(row.start_time) } : {}),
            ...(time(row.end_time) !== undefined ? { endMs: time(row.end_time) } : {}),
          };
        });
        if (typeof result.text !== "string") this.text = next.map(segment => segment.text).join("");
      } else if (typeof result.text === "string") {
        if (this.segments.some(segment => segment.final))
          throw new Error("语音服务遗漏了已确认分句");
        next = result.text ? [{ id: "seed-0", text: result.text, final: last }] : [];
      }
    }
    let common = 0;
    while (
      common < next.length &&
      common < this.segments.length &&
      equal(next[common], this.segments[common])
    )
      common++;
    if (common === next.length && common === this.segments.length) return;
    if (this.segments.slice(common).some(segment => segment.final))
      throw new Error("语音服务改写了已确认分句");
    const event: ASREventPayload = {
      type: "segments",
      baseRevision: this.revision,
      revision: ++this.revision,
      startIndex: common,
      deleteCount: this.segments.length - common,
      segments: next.slice(common),
    };
    this.segments = next;
    return event;
  }
  transcript(): ASRTranscript {
    return { text: this.text, segments: this.segments };
  }
}
