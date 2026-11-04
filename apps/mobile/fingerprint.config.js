// @ts-check
const fs = require("node:fs");
const path = require("node:path");

// Include the major version, which Expo ignores, to prevent OTAs reaching older store binaries.
const appConfig = fs.readFileSync(path.join(__dirname, "app.config.ts"), "utf8");
const version =
  process.env.T3CODE_MOBILE_VERSION ??
  appConfig.match(/^ {2}version: repoEnv\.T3CODE_MOBILE_VERSION \?\? "([^"]+)"/m)?.[1];
const majorVersion = version?.match(/^(\d+)\./)?.[1];
if (!majorVersion) {
  throw new Error("fingerprint.config.js could not read the app version from app.config.ts");
}

module.exports = {
  nativeModuleSourceType: "files",
  // The build label is JS metadata, not a change to the native runtime.
  /**
   * @param {{ type: string, id?: string }} source
   * @param {string | Buffer | null} chunk
   */
  fileHookTransform(source, chunk) {
    if (source.type !== "contents" || source.id !== "expoConfig" || chunk === null) return chunk;
    const config = JSON.parse(chunk.toString());
    if (config.extra) delete config.extra.buildTimestamp;
    return JSON.stringify(config);
  },
  extraSources: [{ type: "contents", id: "appMajorVersion", contents: majorVersion }],
};
