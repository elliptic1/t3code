import { vi } from "vite-plus/test";
vi.mock("expo-secure-store", () => ({}));
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { EnvironmentId } from "@t3tools/contracts";
import {
  BearerConnectionTarget,
  BearerConnectionProfile,
  BearerConnectionCredential,
} from "@t3tools/client-runtime/connection";
import { EMPTY_CONNECTION_CATALOG_DOCUMENT } from "@t3tools/client-runtime/platform";
import * as MobileSecureStorage from "../persistence/mobile-secure-storage";
import { make, CONNECTION_CATALOG_KEY, LEGACY_CONNECTIONS_KEY } from "./catalog-store";

function storage(data: Map<string, string>) {
  return MobileSecureStorage.MobileSecureStorage.of({
    getItem: (key) => Effect.succeed(data.get(key) ?? null),
    setItem: (key, value) =>
      Effect.sync(() => {
        data.set(key, value);
      }),
    removeItem: (key) =>
      Effect.sync(() => {
        data.delete(key);
      }),
  });
}

describe("durable mobile pairings", () => {
  it.effect.each([CONNECTION_CATALOG_KEY, LEGACY_CONNECTIONS_KEY])(
    "preserves unreadable %s through reads and attempted updates",
    (key) =>
      Effect.gen(function* () {
        const data = new Map([[key, "unreadable saved pairing"]]);
        const service = yield* make().pipe(
          Effect.provideService(MobileSecureStorage.MobileSecureStorage, storage(data)),
        );
        expect((yield* service.read.pipe(Effect.result))._tag).toBe("Failure");
        expect(
          (yield* service.update(() => EMPTY_CONNECTION_CATALOG_DOCUMENT).pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(data).toEqual(new Map([[key, "unreadable saved pairing"]]));
      }),
  );
  it.effect("restores the same catalog after a fresh runtime starts", () =>
    Effect.gen(function* () {
      const data = new Map<string, string>();
      const deps = storage(data);
      const first = yield* make().pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, deps),
      );
      const environmentId = EnvironmentId.make("saved-mac");
      const connectionId = "saved-tailnet";
      const saved = {
        ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
        targets: [new BearerConnectionTarget({ connectionId, environmentId, label: "My Mac" })],
        profiles: [
          new BearerConnectionProfile({
            connectionId,
            environmentId,
            label: "My Mac",
            httpBaseUrl: "https://mac.example.test",
            wsBaseUrl: "wss://mac.example.test",
          }),
        ],
        credentials: [
          {
            connectionId,
            credential: new BearerConnectionCredential({ token: "saved-test-token" }),
          },
        ],
      };
      yield* first.update(() => saved);
      const restarted = yield* make().pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, deps),
      );
      expect(yield* restarted.read).toEqual(saved);
    }),
  );
});
