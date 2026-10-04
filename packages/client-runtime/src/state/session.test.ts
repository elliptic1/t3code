import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { FetchHttpClient } from "effect/unstable/http";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { runAtomCommand } from "./runtime.ts";
import { createEnvironmentSessionAtoms } from "./session.ts";

it.effect(
  "reads the live connection without mounting its UI projection, including after reconnect",
  () =>
    Effect.gen(function* () {
      const target = new PrimaryConnectionTarget({
        environmentId: EnvironmentId.make("upload-environment"),
        label: "Upload environment",
        httpBaseUrl: "https://old.example.test",
        wsBaseUrl: "wss://old.example.test",
      });
      const connection: PreparedConnection = {
        environmentId: target.environmentId,
        label: target.label,
        httpBaseUrl: target.httpBaseUrl,
        socketUrl: target.wsBaseUrl,
        httpAuthorization: null,
        target,
      };
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
        prepared: yield* SubscriptionRef.make(Option.some(connection)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      });
      const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_, effect) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
      const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
        _,
        stream,
      ) =>
        Stream.unwrap(
          Effect.promise(async () =>
            Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
          ),
        );
      const runtime = Atom.runtime(
        Layer.merge(
          FetchHttpClient.layer,
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, {
            run,
            followStream,
          } as EnvironmentRegistry.EnvironmentRegistry["Service"]),
        ),
      );
      const session = createEnvironmentSessionAtoms(runtime);
      const registry = AtomRegistry.make();
      const read = () =>
        runAtomCommand(registry, session.readPreparedConnection, {
          environmentId: target.environmentId,
          input: undefined,
        });

      try {
        // A cold synchronous read sees the projection's initial None, not the supervisor.
        expect(registry.get(session.preparedConnectionValueAtom(target.environmentId))).toEqual(
          Option.none(),
        );
        expect(yield* Effect.promise(read)).toMatchObject({
          _tag: "Success",
          value: Option.some(connection),
        });

        const reconnected = { ...connection, httpBaseUrl: "https://new.example.test" };
        yield* SubscriptionRef.set(supervisor.prepared, Option.some(reconnected));
        expect(yield* Effect.promise(read)).toMatchObject({
          _tag: "Success",
          value: Option.some(reconnected),
        });

        yield* SubscriptionRef.set(supervisor.prepared, Option.none());
        expect(yield* Effect.promise(read)).toMatchObject({
          _tag: "Success",
          value: Option.none(),
        });
      } finally {
        registry.dispose();
      }
    }),
);
