import * as NodeModule from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const { fileHookTransform } = require("../fingerprint.config.js") as {
  fileHookTransform: (source: { type: string; id: string }, chunk: string) => string;
};
const nativeFingerprintContent = (buildTimestamp: string, androidPackage = "com.example.app") =>
  fileHookTransform(
    { type: "contents", id: "expoConfig" },
    JSON.stringify({
      android: { package: androidPackage },
      extra: { buildTimestamp, appVariant: "production" },
    }),
  );

describe("build date and native runtime compatibility", () => {
  it("keeps builds with the same native config compatible across build dates", () => {
    expect(nativeFingerprintContent("2026-10-14T01:05:00.000Z")).toBe(
      nativeFingerprintContent("2026-10-15T01:05:00.000Z"),
    );
  });

  it("still distinguishes changes to native configuration", () => {
    expect(nativeFingerprintContent("2026-10-14T01:05:00.000Z", "com.example.first")).not.toBe(
      nativeFingerprintContent("2026-10-14T01:05:00.000Z", "com.example.second"),
    );
  });
});
