import type { EnvironmentId, UnifiedSettings } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  cursorKeychainUsageEnabled,
  usageResetRemindersEnabled,
  usageResetReminderNtfyUrl,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly cursorKeychainUsageEnabled: boolean;
  readonly usageResetRemindersEnabled: boolean;
  readonly usageResetReminderNtfyUrl: string;
  readonly readOnly: boolean;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const updateCursorSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update Cursor account usage",
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const platform = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment
    .platform;
  const canUpdateReminders = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId),
  );
  const [ntfyDraft, setNtfyDraft] = useState<string | null>(null);
  const [updatingReminders, setUpdatingReminders] = useState(false);
  const updateReminderSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update usage reset reminders",
  });
  const [adding, setAdding] = useState(false);
  const [updatingCursor, setUpdatingCursor] = useState(false);
  const entries = Object.entries(sources);

  const setCursorUsageEnabled = async (enabled: boolean) => {
    setUpdatingCursor(true);
    const result = await updateCursorSettings({
      environmentId,
      input: { patch: { cursorKeychainUsageEnabled: enabled } },
    });
    if (result._tag === "Success") {
      await refreshProviders({ environmentId, input: {} });
    }
    setUpdatingCursor(false);
  };

  return (
    <>
      <SettingsSection
        {...searchableSetting("usage-providers")}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3" aria-hidden />
              Add hub
            </Button>
          ) : null
        }
      >
        <SettingsRow
          title="Usage reset reminders"
          description="Get a notification in the final hour before a Claude or Codex subscription window resets, showing usage and remaining allowance. Use your ntfy topic below, or T3 Connect with Device Notifications."
          control={
            <Switch
              aria-label="Usage reset reminders"
              checked={usageResetRemindersEnabled}
              disabled={readOnly || !canUpdateReminders || updatingReminders}
              onCheckedChange={(enabled) => {
                setUpdatingReminders(true);
                void updateReminderSettings({
                  environmentId,
                  input: { patch: { usageResetRemindersEnabled: enabled } },
                }).finally(() => setUpdatingReminders(false));
              }}
            />
          }
        />
        <SettingsRow
          title="ntfy topic URL"
          description="Subscribe to this topic in the ntfy app. Leave empty to use T3 Connect. Use an unguessable topic name on public servers."
          control={
            <div className="flex w-72 items-center gap-2">
              <Input
                aria-label="ntfy topic URL"
                type="url"
                placeholder="https://ntfy.sh/your-topic"
                value={ntfyDraft ?? usageResetReminderNtfyUrl}
                disabled={readOnly || !canUpdateReminders || updatingReminders}
                onChange={(event) => setNtfyDraft(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={
                  ntfyDraft === null || readOnly || !canUpdateReminders || updatingReminders
                }
                onClick={() => {
                  setUpdatingReminders(true);
                  void updateReminderSettings({
                    environmentId,
                    input: {
                      patch: {
                        usageResetReminderNtfyUrl: (ntfyDraft ?? usageResetReminderNtfyUrl).trim(),
                      },
                    },
                  }).finally(() => setUpdatingReminders(false));
                }}
              >
                Save
              </Button>
            </div>
          }
        />
        {platform?.os === "darwin" ? (
          <SettingsRow
            id="cursor-keychain-usage"
            title="Cursor account usage"
            description="Read your existing Cursor CLI login from macOS Keychain to show account history and monthly limits. macOS may ask you to allow access."
            control={
              <Switch
                aria-label="Cursor account usage"
                checked={cursorKeychainUsageEnabled}
                disabled={readOnly || updatingCursor}
                onCheckedChange={(enabled) => void setCursorUsageEnabled(enabled)}
              />
            }
          />
        ) : null}
        {entries.length === 0 ? (
          <SettingsRow title="No hubs configured." />
        ) : (
          entries.map(([id, source]) => {
            const label = source.label?.trim() || source.url;
            return (
              <SettingsRow
                key={id}
                title={label}
                description={
                  <span className="break-all">
                    CLI Proxy{source.enabled ? "" : " · Disabled"}
                    {label !== source.url ? ` · ${source.url}` : ""}
                  </span>
                }
                control={
                  !readOnly ? (
                    <RemoveUsageProviderButton
                      label={label}
                      onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                    />
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {adding && !readOnly ? (
        <AddUsageLimitSourceDialog
          open
          onOpenChange={setAdding}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
        />
      ) : null}
    </>
  );
}

function RemoveUsageProviderButton({
  label,
  onConfirm,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The hub's management key is deleted from this server. Its accounts leave the Limits
              view; the hub itself is untouched. Add it again with the URL and key to bring them
              back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Remove hub
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
