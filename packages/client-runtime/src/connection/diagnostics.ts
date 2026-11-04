import { ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { EnvironmentPresentation } from "./presentation.ts";
import type { SupervisorConnectionState } from "./model.ts";
import { connectionRouteKind, connectionRoutes, routeHttpBaseUrl } from "./routes.ts";

/** Builds an offline handoff from local state; never exports stored credentials or server settings. */
export function connectionDiagnostics(input: {
  readonly environment: EnvironmentPresentation;
  readonly state: SupervisorConnectionState | null;
  readonly client: {
    readonly surface: string;
    readonly version: string;
    readonly platform: string;
  };
  readonly capturedAt: string;
}): string {
  const { environment, state } = input;
  const descriptor = environment.serverConfig?.environment;
  const report = {
    capturedAt: input.capturedAt,
    client: { ...input.client, orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION },
    environment: {
      expectedEnvironmentId: environment.entry.target.environmentId,
      label: environment.entry.target.label,
      enabled: environment.entry.enabled,
      connection: environment.connection,
      supervisor:
        state === null
          ? null
          : {
              phase: state.phase,
              stage: state.stage,
              network: state.network,
              desired: state.desired,
              attempt: state.attempt,
              retryAt: state.retryAt,
              failure:
                state.lastFailure === null
                  ? null
                  : {
                      type: state.lastFailure._tag,
                      reason: state.lastFailure.reason,
                      message: state.lastFailure.message,
                      traceId: state.lastFailure.traceId ?? null,
                    },
            },
      cachedServer:
        descriptor === undefined
          ? null
          : {
              environmentId: descriptor.environmentId,
              label: descriptor.label,
              version: descriptor.serverVersion,
              platform: descriptor.platform,
              orchestrationProtocolVersion: descriptor.orchestrationProtocolVersion ?? null,
            },
      routes: connectionRoutes(environment.entry).map((route, index) => {
        const profile = Option.getOrNull(route.profile);
        return {
          preference: index + 1,
          kind: connectionRouteKind(route),
          expectedEnvironmentId: route.target.environmentId,
          httpBaseUrl: diagnosticUrl(routeHttpBaseUrl(route)),
          wsBaseUrl: diagnosticUrl(
            route.target._tag === "PrimaryConnectionTarget"
              ? route.target.wsBaseUrl
              : profile?._tag === "BearerConnectionProfile"
                ? profile.wsBaseUrl
                : null,
          ),
          ssh:
            profile?._tag === "SshConnectionProfile"
              ? {
                  hostname: profile.target.hostname,
                  username: profile.target.username,
                  port: profile.target.port,
                }
              : null,
        };
      }),
    },
  };
  return [
    "T3 Code connection diagnostics",
    "Please diagnose and fix this connection failure. I cannot reach the environment through T3 Code.",
    "Captured locally; server details are cached and may be stale. Server logs are unavailable while disconnected.",
    "Routes are in preference order. Check the full error and expected environment ID against the server reached by each route.",
    "",
    JSON.stringify(report, null, 2),
  ].join("\n");
}

function diagnosticUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "Invalid URL";
  }
}
