import path from "node:path";
import { defineConfig } from "vitest/config";
const root = process.env.TAU_HOST_ROOT;
if (!root || !path.isAbsolute(root)) throw new Error("请通过 TAU_HOST_ROOT 指定宿主源码绝对路径");
export default defineConfig({
  resolve: {
    alias: [
      { find: "@tau/test-host", replacement: path.join(root, "packages/plugins/src/host.ts") },
      {
        find: "@tau/test-rendering",
        replacement: path.join(root, "packages/plugins/src/rendering.ts"),
      },
      {
        find: "@tau/test-registry",
        replacement: path.join(root, "packages/plugins/src/asr-host.ts"),
      },
      {
        find: "@tau/test-websocket",
        replacement: path.join(root, "packages/plugins/src/websocket-bridge.ts"),
      },
      { find: /^@tau\/plugins$/, replacement: path.join(root, "packages/plugins/src/index.ts") },
    ],
  },
  test: { environment: "node", include: ["validation/*.test.ts"] },
});
