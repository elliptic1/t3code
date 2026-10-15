import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { RelayUsageResetReminder } from "@t3tools/contracts/relay";
import * as UsageResetReminderPublisher from "./UsageResetReminderPublisher.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as LiveActivities from "./LiveActivities.ts";
import * as ApnsDeliveries from "./ApnsDeliveries.ts";
import * as FcmClient from "./FcmClient.ts";
import * as DeliveryAttempts from "./DeliveryAttempts.ts";

const reminder: RelayUsageResetReminder = {
  providerInstanceId: "claude",
  providerLabel: "Claude",
  windowId: "five_hour",
  remainingPercent: 50,
  resetsAt: "1970-01-01T01:00:00.000Z",
};
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function harness(
  options: {
    platform?: "ios" | "android";
    deviceEnabled?: boolean;
    environmentEnabled?: boolean;
    pushToken?: string | null;
    supported?: boolean;
  } = {},
) {
  const target: LiveActivities.TargetRow = {
    user_id: "user",
    device_id: "device",
    platform: options.platform ?? "android",
    ios_major_version: 18,
    app_version: "1",
    bundle_id: null,
    aps_environment: null,
    push_token: options.pushToken === undefined ? "push-token" : options.pushToken,
    push_to_start_token: null,
    preferences_json: encodeJson({
      notificationsEnabled: options.deviceEnabled ?? true,
      usageResetRemindersSupported: options.supported ?? true,
      liveActivitiesEnabled: true,
      notifyOnCompletion: false,
      notifyOnFailure: false,
      notifyOnApproval: false,
      notifyOnInput: false,
    }),
    activity_push_token: null,
    remote_start_queued_at: null,
    remote_started_at: null,
    ended_at: null,
    last_aggregate_json: null,
    last_live_activity_delivery_at: null,
  };
  const sent = vi.fn<FcmClient.FcmClient["Service"]["send"]>(() =>
    Effect.succeed({ unregistered: false }),
  );
  const ios = vi.fn<ApnsDeliveries.ApnsDeliveries["Service"]["sendPushNotification"]>((input) =>
    Effect.succeed({
      deviceId: input.target.device_id,
      kind: "push_notification",
      ok: true,
      apnsStatus: 200,
      apnsReason: null,
      apnsId: null,
    }),
  );
  let claimed = false;
  const layer = UsageResetReminderPublisher.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(EnvironmentLinks.EnvironmentLinks, {
          listDeliveryUsersForEnvironment: () =>
            Effect.succeed([
              {
                userId: "user",
                notificationsEnabled: options.environmentEnabled ?? true,
                liveActivitiesEnabled: true,
              },
            ]),
        }),
        Layer.mock(LiveActivities.LiveActivities, { listTargets: () => Effect.succeed([target]) }),
        Layer.mock(ApnsDeliveries.ApnsDeliveries, { sendPushNotification: ios }),
        Layer.mock(FcmClient.FcmClient, { send: sent }),
        Layer.mock(DeliveryAttempts.DeliveryAttempts, {
          claimSourceJob: () =>
            Effect.sync(() => {
              if (claimed) return "completed";
              claimed = true;
              return "claimed";
            }),
          completeSourceJob: () => Effect.void,
        }),
      ),
    ),
  );
  const publish = (value = reminder) =>
    Effect.gen(function* () {
      const publisher = yield* UsageResetReminderPublisher.UsageResetReminderPublisher;
      return yield* publisher.publish({
        environmentId: "env",
        environmentPublicKey: "key",
        reminder: value,
      });
    }).pipe(Effect.provide(layer));
  return { publish, sent, ios };
}

describe("usage reset reminder delivery", () => {
  it.effect("sends an Android alert once without activity payloads", () =>
    Effect.gen(function* () {
      const test = harness();
      expect(yield* test.publish()).toEqual({ delivered: true });
      expect(yield* test.publish()).toEqual({ delivered: true });
      expect(test.sent).toHaveBeenCalledTimes(1);
      expect(test.sent.mock.calls[0]?.[0]).toMatchObject({
        alert: true,
        data: {
          type: "usage-reset",
          alert_path: "/settings/usage",
          alert_title: "Claude allowance resets soon",
          alert_body: "50% used · 50% remaining. Resets in 60 minutes.",
        },
      });
      expect(test.sent.mock.calls[0]?.[0].data).not.toHaveProperty("active");
    }),
  );
  it.effect("delivers usage reports when little or no allowance remains", () =>
    Effect.gen(function* () {
      for (const remainingPercent of [10, 0.5, 0]) {
        const test = harness();
        expect(
          yield* test.publish({
            ...reminder,
            providerInstanceId: "codex",
            providerLabel: "Codex",
            remainingPercent,
          }),
        ).toEqual({ delivered: true });
        expect(test.sent.mock.calls[0]?.[0].data.alert_body).toBe(
          `${100 - remainingPercent}% used · ${remainingPercent}% remaining. Resets in 60 minutes.`,
        );
      }
    }),
  );
  it.effect("sends an iOS push independent of completion preferences", () =>
    Effect.gen(function* () {
      const test = harness({ platform: "ios" });
      expect(yield* test.publish()).toEqual({ delivered: true });
      expect(test.ios).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceJobId: expect.stringContaining("usage-reset:"),
          notification: expect.objectContaining({ deepLink: "/settings/usage", threadId: "" }),
        }),
      );
      expect(test.sent).not.toHaveBeenCalled();
    }),
  );
  it.effect("respects device and environment notification switches and absent tokens", () =>
    Effect.gen(function* () {
      for (const options of [
        { deviceEnabled: false },
        { environmentEnabled: false },
        { pushToken: null },
        { supported: false },
      ]) {
        const test = harness(options);
        expect(yield* test.publish()).toEqual({ delivered: false });
        expect(test.sent).not.toHaveBeenCalled();
        expect(test.ios).not.toHaveBeenCalled();
      }
    }),
  );
  it.effect("rejects expired or premature reminders before sending", () =>
    Effect.gen(function* () {
      const test = harness();
      for (const resetsAt of ["1970-01-01T00:00:00.000Z", "1970-01-01T01:00:01.000Z", "invalid"])
        expect(yield* test.publish({ ...reminder, resetsAt })).toEqual({ delivered: false });
      expect(test.sent).not.toHaveBeenCalled();
    }),
  );
});
