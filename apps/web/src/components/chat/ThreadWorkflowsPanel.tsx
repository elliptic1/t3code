/* oxlint-disable react/no-array-index-key -- Stage order is immutable for the lifetime of a workflow, so indices are stable keys. */
import { randomUUID } from "../../lib/utils";
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
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(false);

  async function addDraft() {
    if (busy || !canCreate) return;
    setBusy(true);
    setError(null);
    const result = await create({
      environmentId: props.environmentId,
      input: {
        id: WorkflowId.make(randomUUID()),
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
        commandId: CommandId.make(randomUUID()),
        expectedRevision: workflow.revision,
        action,
      },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(String(squashAtomCommandFailure(result)));
  }
  return (
    <ThreadDetailsSection
      headingId="thread-workflows-heading"
      title="Workflows"
      actions={
        <Button
          size="micro"
          variant="ghost"
          disabled={!canCreate || busy}
          onClick={() => setShowDraft((value) => !value)}
        >
          APK example
        </Button>
      }
    >
      {query.error ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          Could not load workflows: {query.error}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {showDraft ? (
        <div className="space-y-2 px-2 text-xs">
          <p>
            Create a draft for syncing your fork, checking, building, verifying and publishing an
            APK, then confirming manual installation. Start runs these stages with this thread’s
            agent and permissions.
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            {APK_WORKFLOW_STAGES.map((stage) => (
              <li key={stage.title}>{stage.title}</li>
            ))}
          </ol>
          <Button
            size="xs"
            variant="outline"
            disabled={busy || !canCreate}
            onClick={() => void addDraft()}
          >
            Save draft
          </Button>
        </div>
      ) : null}
      {query.data?.workflows.length === 0 && !showDraft ? (
        <p className="px-2 text-xs text-muted-foreground">
          Ask your agent to create a workflow, or use the APK example.
        </p>
      ) : null}
      <div className="space-y-3 px-2">
        {query.data?.workflows.map((workflow) => (
          <div key={workflow.id} className="space-y-2">
            <p className="text-sm font-medium">
              {workflow.title}{" "}
              <span className="text-xs text-muted-foreground">· {workflow.status}</span>
            </p>
            <ol className="space-y-1 text-xs">
              {workflow.stages.map((stage, index) => (
                <li key={index}>
                  <details>
                    <summary className="cursor-pointer">
                      {index + 1}. {stage.title} · {stage.status}
                      {stage.attemptCount > 0
                        ? ` · attempt ${stage.attemptCount}/${stage.maxAttempts}`
                        : ""}
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                      {stage.latestEvidence ?? "No result recorded."}
                    </p>
                  </details>
                </li>
              ))}
            </ol>
            {workflow.lastError ? (
              <p role="alert" className="text-xs text-destructive">
                {workflow.lastError}
              </p>
            ) : null}
            <WorkflowHistory environmentId={props.environmentId} workflow={workflow} />
            {workflow.status === "running" ? (
              <p className="text-xs text-muted-foreground">
                Pause or cancel stops later stages. Current work can finish.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1">
              {workflowControls(workflow).map((action) => (
                <Button
                  key={action}
                  size="micro"
                  variant="outline"
                  disabled={!canControl || busy}
                  onClick={() => void act(workflow, action)}
                >
                  {action === "resume" && workflow.status === "waiting"
                    ? "Resume when ready"
                    : action[0]!.toUpperCase() + action.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ThreadDetailsSection>
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
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Instructions and full evidence
      </summary>
      {query.error ? (
        <p role="alert" className="text-xs text-destructive">
          {query.error}
        </p>
      ) : null}
      {open && query.isPending && !query.data ? (
        <p className="text-xs text-muted-foreground">Loading history…</p>
      ) : null}
      <div className="space-y-2 text-xs">
        {query.data?.workflow.stages.map((stage, index) => (
          <div key={index}>
            <p className="font-medium">{stage.title}</p>
            <p className="whitespace-pre-wrap break-words">{stage.instruction}</p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              Success: {stage.successCriteria}
            </p>
            {stage.attempts.map((attempt) => (
              <p key={attempt.number} className="mt-1 whitespace-pre-wrap break-words">
                Attempt {attempt.number} · {attempt.status}:{" "}
                {attempt.evidence ?? "No result recorded."}
              </p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
