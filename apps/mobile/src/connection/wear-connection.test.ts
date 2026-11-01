import { EnvironmentId } from "@t3tools/contracts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  type ConnectionCatalogDocument,
} from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "vite-plus/test";

import { connectionForWatch } from "./wear-connection";

function savedConnections(): ConnectionCatalogDocument {
  const targets = ["first", "second"].map(
    (id) =>
      new BearerConnectionTarget({
        connectionId: id,
        environmentId: EnvironmentId.make(id),
        label: id,
      }),
  );
  return {
    ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
    targets,
    profiles: targets.map(
      (target) =>
        new BearerConnectionProfile({
          connectionId: target.connectionId,
          environmentId: target.environmentId,
          label: target.label,
          httpBaseUrl: `https://${target.connectionId}.example.test`,
          wsBaseUrl: `wss://${target.connectionId}.example.test`,
        }),
    ),
    credentials: targets.map((target) => ({
      connectionId: target.connectionId,
      credential: new BearerConnectionCredential({ token: `${target.connectionId}-token` }),
    })),
  };
}

describe("phone connection restored for the watch", () => {
  it("restores an existing pairing without registering a new connection", () => {
    expect(connectionForWatch(savedConnections())).toEqual({
      baseUrl: "https://second.example.test",
      token: "second-token",
      label: "second",
    });
  });

  it("syncs the preferred route of the latest environment instead of its fallback", () => {
    const catalog = savedConnections();
    const preferred = catalog.targets[1]!;
    const fallback = new BearerConnectionTarget({
      ...preferred,
      connectionId: "second-tailnet",
    });
    const withFallback = {
      ...catalog,
      targets: [...catalog.targets, fallback],
      profiles: [
        ...catalog.profiles,
        new BearerConnectionProfile({
          connectionId: fallback.connectionId,
          environmentId: fallback.environmentId,
          label: fallback.label,
          httpBaseUrl: "http://100.100.0.1:3773",
          wsBaseUrl: "ws://100.100.0.1:3773",
        }),
      ],
      credentials: [
        ...catalog.credentials,
        {
          connectionId: fallback.connectionId,
          credential: new BearerConnectionCredential({ token: "fallback-token" }),
        },
      ],
    };

    expect(connectionForWatch(withFallback)).toEqual({
      baseUrl: "https://second.example.test",
      token: "second-token",
      label: "second",
    });
    expect(
      connectionForWatch({
        ...withFallback,
        credentials: withFallback.credentials.filter(
          (entry) => entry.connectionId !== preferred.connectionId,
        ),
      })?.baseUrl,
    ).toBe("http://100.100.0.1:3773");
  });

  it("keeps another enabled connection when one is disabled or removed", () => {
    const catalog = savedConnections();
    const disabled = { ...catalog, disabledEnvironmentIds: [EnvironmentId.make("second")] };
    expect(connectionForWatch(disabled)?.label).toBe("first");
    expect(connectionForWatch({ ...catalog, targets: catalog.targets.slice(0, 1) })?.label).toBe(
      "first",
    );
    expect(
      connectionForWatch({
        ...disabled,
        disabledEnvironmentIds: catalog.targets.map((t) => t.environmentId),
      }),
    ).toBeNull();
  });

  it("does not send a stale or incompatible credential to the watch", () => {
    const catalog = savedConnections();
    expect(connectionForWatch({ ...catalog, credentials: [] })).toBeNull();
    expect(
      connectionForWatch({
        ...catalog,
        profiles: catalog.profiles.map((profile) =>
          profile._tag === "BearerConnectionProfile"
            ? new BearerConnectionProfile({ ...profile, authorization: "t3-connect" })
            : profile,
        ),
      }),
    ).toBeNull();
  });
});
