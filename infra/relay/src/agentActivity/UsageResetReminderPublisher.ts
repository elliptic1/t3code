import type { RelayUsageResetReminder } from "@t3tools/contracts/relay";
import { RelayAgentAwarenessPreferences } from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FcmClient from "./FcmClient.ts";
import * as DeliveryAttempts from "./DeliveryAttempts.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as LiveActivities from "./LiveActivities.ts";
import * as ApnsDeliveries from "./ApnsDeliveries.ts";

type PublishError =
  | FcmClient.FcmClientError
  | DeliveryAttempts.DeliveryAttemptRecordPersistenceError
  | EnvironmentLinks.EnvironmentLinkUserListPersistenceError
  | LiveActivities.LiveActivityTargetListPersistenceError
  | LiveActivities.LiveActivityDeliveryMarkPersistenceError
  | ApnsDeliveries.ApnsDeliveryError;

export class UsageResetReminderPublisher extends Context.Service<
  UsageResetReminderPublisher,
  {
    readonly publish: (input: {
      readonly environmentId: string;
      readonly environmentPublicKey: string;
      readonly reminder: RelayUsageResetReminder;
    }) => Effect.Effect<{ readonly delivered: boolean }, PublishError>;
  }
>()("t3code-relay/agentActivity/UsageResetReminderPublisher") {}

const encodeIdentity = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const make = Effect.gen(function* () {
  const fcm = yield* FcmClient.FcmClient;
  const attempts = yield* DeliveryAttempts.DeliveryAttempts;
  const links = yield* EnvironmentLinks.EnvironmentLinks;
  const liveActivities = yield* LiveActivities.LiveActivities;
  const apnsDeliveries = yield* ApnsDeliveries.ApnsDeliveries;
  const decodePreferences = Schema.decodeUnknownOption(
    Schema.fromJsonString(RelayAgentAwarenessPreferences),
  );
  return UsageResetReminderPublisher.of({
    publish: Effect.fn("relay.usage_reset_reminder.publish")(function* (input) {
      const nowMs = (yield* DateTime.now).epochMilliseconds;
      const resetMs = Date.parse(input.reminder.resetsAt);
      if (!Number.isFinite(resetMs) || resetMs <= nowMs || resetMs - nowMs > 60 * 60_000) {
        return { delivered: false };
      }
      const users = yield* links.listDeliveryUsersForEnvironment(input);
      let delivered = false;
      for (const user of users) {
        if (!user.notificationsEnabled) continue;
        const targets = yield* liveActivities.listTargets({ userId: user.userId });
        for (const target of targets) {
          const preferences = decodePreferences(target.preferences_json);
          if (
            preferences._tag === "None" ||
            !preferences.value.notificationsEnabled ||
            preferences.value.usageResetRemindersSupported !== true ||
            !target.push_token
          )
            continue;
          const identity = encodeIdentity([
            input.environmentId,
            input.environmentPublicKey,
            input.reminder.providerInstanceId,
            input.reminder.windowId,
            String(resetMs),
            target.user_id,
            target.device_id,
          ]);
          const sourceJobId = `usage-reset:${identity}`;
          const title = `${input.reminder.providerLabel} allowance resets soon`;
          const body = `${Math.round((100 - input.reminder.remainingPercent) * 10) / 10}% used · ${Math.round(input.reminder.remainingPercent * 10) / 10}% remaining. Resets in ${Math.ceil((resetMs - nowMs) / 60_000)} minutes.`;
          if (target.platform === "ios") {
            const result = yield* apnsDeliveries.sendPushNotification({
              target,
              token: target.push_token,
              sourceJobId,
              notification: {
                title,
                body,
                environmentId: input.environmentId,
                threadId: "",
                deepLink: "/settings/usage",
                expiresAt: input.reminder.resetsAt,
              },
            });
            delivered ||= result.ok;
          } else {
            const claim = yield* attempts.claimSourceJob({
              sourceJobId,
              userId: target.user_id,
              deviceId: target.device_id,
              environmentId: input.environmentId,
              threadId: null,
              kind: "usage-reset",
              token: target.push_token,
            });
            if (claim === "completed") {
              delivered = true;
              continue;
            }
            if (claim === "in_flight") continue;
            const result = yield* fcm.send({
              token: target.push_token,
              packageName: target.bundle_id,
              alert: true,
              data: {
                device_id: target.device_id,
                user_id: target.user_id,
                updated_at: String(nowMs),
                type: "usage-reset",
                alert_id: sourceJobId,
                alert_title: title,
                alert_body: body,
                alert_path: "/settings/usage",
                alert_group: "t3-usage-reset",
                alert_expires_at: String(resetMs),
              },
            });
            yield* attempts.completeSourceJob({
              sourceJobId,
              apnsStatus: result.unregistered ? 410 : 200,
            });
            if (result.unregistered) {
              yield* liveActivities.invalidateDeliveryToken({
                userId: target.user_id,
                deviceId: target.device_id,
                kind: "push_notification",
                invalidatedAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
              });
            } else delivered = true;
          }
        }
      }
      return { delivered };
    }),
  });
});
export const layer = Layer.effect(UsageResetReminderPublisher, make);
