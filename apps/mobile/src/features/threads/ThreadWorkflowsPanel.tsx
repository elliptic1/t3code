/* oxlint-disable react/no-array-index-key -- Stage order is immutable for the lifetime of a workflow, so indices are stable keys. */
import { useAtomValue } from "@effect/atom-react";
import {
  APK_WORKFLOW_STAGES,
  CommandId,
  WorkflowId,
  workflowControls,
  type EnvironmentId,
  type ThreadId,
  type WorkflowSummary,
  type WorkflowControlInput,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { uuidv4 } from "../../lib/uuid";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

export function ThreadWorkflowsPanel(props: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const query = useEnvironmentQuery(
    serverEnvironment.workflowsLive({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const canCreate = useAtomValue(
    serverEnvironment.createWorkflow.permissionAtom(props.environmentId),
  );
  const canControl = useAtomValue(
    serverEnvironment.controlWorkflow.permissionAtom(props.environmentId),
  );
  const create = useAtomCommand(serverEnvironment.createWorkflow);
  const control = useAtomCommand(serverEnvironment.controlWorkflow);
  const [expanded, setExpanded] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function addDraft() {
    if (busy || !canCreate) return;
    setBusy(true);
    setError(null);
    const result = await create({
      environmentId: props.environmentId,
      input: {
        id: WorkflowId.make(uuidv4()),
        threadId: props.threadId,
        title: "Fork → APK → manual installation",
        stages: APK_WORKFLOW_STAGES,
      },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(String(squashAtomCommandFailure(result)));
    else if (result._tag === "Success") setShowDraft(false);
  }
  async function act(workflow: WorkflowSummary, action: WorkflowControlInput["action"]) {
    if (busy || !canControl) return;
    setBusy(true);
    setError(null);
    const result = await control({
      environmentId: props.environmentId,
      input: {
        id: workflow.id,
        threadId: props.threadId,
        commandId: CommandId.make(uuidv4()),
        expectedRevision: workflow.revision,
        action,
      },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(String(squashAtomCommandFailure(result)));
  }
  return (
    <View className="border-b border-border bg-screen px-3 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
      >
        <Text className="text-sm text-foreground">
          Workflows · {query.data?.workflows.length ?? "…"}
          {query.error ? " · unavailable" : ""}
        </Text>
      </Pressable>
      {expanded ? (
        <ScrollView style={{ maxHeight: 240 }} contentContainerClassName="gap-3 py-2">
          {query.error ? (
            <Text accessibilityRole="alert" className="text-xs text-destructive">
              Could not load workflows: {query.error}
            </Text>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" className="text-xs text-destructive">
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={!canCreate || busy}
            onPress={() => setShowDraft((value) => !value)}
          >
            <Text className="text-sm text-link">APK example</Text>
          </Pressable>
          {showDraft ? (
            <View className="gap-2">
              <Text className="text-xs text-muted-foreground">
                Save a draft, then start it with this thread’s agent and permissions. Installation
                remains manual.
              </Text>
              {APK_WORKFLOW_STAGES.map((stage, i) => (
                <Text key={stage.title} className="text-xs text-foreground">
                  {i + 1}. {stage.title}
                </Text>
              ))}
              <Pressable
                accessibilityRole="button"
                disabled={!canCreate || busy}
                onPress={() => void addDraft()}
              >
                <Text className="text-sm text-link">Save draft</Text>
              </Pressable>
            </View>
          ) : null}
          {query.data?.workflows.map((workflow) => (
            <View key={workflow.id} className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {workflow.title} · {workflow.status}
              </Text>
              {workflow.stages.map((stage, index) => (
                <View key={index}>
                  <Text className="text-xs text-foreground">
                    {index + 1}. {stage.title} · {stage.status} · {stage.attemptCount}/
                    {stage.maxAttempts} attempts
                  </Text>
                  {stage.latestEvidence ? (
                    <Text className="text-xs text-muted-foreground">{stage.latestEvidence}</Text>
                  ) : null}
                </View>
              ))}
              {workflow.lastError ? (
                <Text accessibilityRole="alert" className="text-xs text-destructive">
                  {workflow.lastError}
                </Text>
              ) : null}
              <WorkflowHistory environmentId={props.environmentId} workflow={workflow} />
              {workflow.status === "running" ? (
                <Text className="text-xs text-muted-foreground">
                  Pause or cancel stops later stages. Current work can finish.
                </Text>
              ) : null}
              <View className="flex-row flex-wrap gap-3">
                {workflowControls(workflow).map((action) => (
                  <Pressable
                    key={action}
                    accessibilityRole="button"
                    disabled={!canControl || busy}
                    onPress={() => void act(workflow, action)}
                    className="rounded-lg bg-subtle px-3 py-2"
                  >
                    <Text className="text-xs text-foreground">
                      {action === "resume" && workflow.status === "waiting"
                        ? "Resume when ready"
                        : action[0]!.toUpperCase() + action.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function WorkflowHistory(props: { environmentId: EnvironmentId; workflow: WorkflowSummary }) {
  const [open, setOpen] = useState(false);
  const query = useEnvironmentQuery(
    open
      ? serverEnvironment.workflowDetails({
          environmentId: props.environmentId,
          input: {
            id: props.workflow.id,
            threadId: props.workflow.threadId,
            revision: props.workflow.revision,
          },
        })
      : null,
  );
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
      >
        <Text className="text-xs text-link">Instructions and full evidence</Text>
      </Pressable>
      {query.error ? (
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {query.error}
        </Text>
      ) : null}
      {open && query.isPending && !query.data ? (
        <Text className="text-xs text-muted-foreground">Loading history…</Text>
      ) : null}
      {open
        ? query.data?.workflow.stages.map((stage, index) => (
            <View key={index} className="gap-1">
              <Text className="text-xs font-semibold text-foreground">{stage.title}</Text>
              <Text className="text-xs text-foreground">{stage.instruction}</Text>
              <Text className="text-xs text-muted-foreground">
                Success: {stage.successCriteria}
              </Text>
              {stage.attempts.map((attempt) => (
                <Text key={attempt.number} className="text-xs text-muted-foreground">
                  Attempt {attempt.number} · {attempt.status}:{" "}
                  {attempt.evidence ?? "No result recorded."}
                </Text>
              ))}
            </View>
          ))
        : null}
    </View>
  );
}
