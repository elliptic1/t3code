import { useAtomValue } from "@effect/atom-react";
import {
  THREAD_ARTIFACT_MAX_BYTES,
  type EnvironmentId,
  type ThreadId,
  type ThreadArtifact,
} from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { readPreparedConnection } from "../../state/session";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

export function ThreadArtifactsPanel(props: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const [open, setOpen] = useState(false);
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  if (config?.environment.capabilities.threadArtifacts !== true) return null;
  return (
    <ThreadDetailsSection
      data-thread-artifacts-panel
      headingId="thread-artifacts-heading"
      title="Artifacts"
      actions={
        <Button size="micro" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Open"}
        </Button>
      }
    >
      {open ? <ArtifactFiles key={`${props.environmentId}:${props.threadId}`} {...props} /> : null}
    </ThreadDetailsSection>
  );
}

function ArtifactFiles(props: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const query = useEnvironmentQuery(
    serverEnvironment.artifactsLive({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const canUpload = useAtomValue(
    serverEnvironment.createArtifactUploadUrl.permissionAtom(props.environmentId),
  );
  const canRename = useAtomValue(
    serverEnvironment.renameArtifact.permissionAtom(props.environmentId),
  );
  const canDelete = useAtomValue(
    serverEnvironment.deleteArtifact.permissionAtom(props.environmentId),
  );
  const canDownload = useAtomValue(
    serverEnvironment.createArtifactDownloadUrl.permissionAtom(props.environmentId),
  );
  const uploadUrl = useAtomCommand(serverEnvironment.createArtifactUploadUrl);
  const downloadUrl = useAtomCommand(serverEnvironment.createArtifactDownloadUrl);
  const rename = useAtomCommand(serverEnvironment.renameArtifact);
  const remove = useAtomCommand(serverEnvironment.deleteArtifact);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ThreadArtifact | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const replacing = useRef<ThreadArtifact | null>(null);
  const transfer = useRef<AbortController | null>(null);
  useEffect(() => () => transfer.current?.abort(), []);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    await action().catch((cause: unknown) => {
      if (!transfer.current?.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    transfer.current = null;
    setBusy(false);
  }
  function absoluteUrl(relativeUrl: string) {
    const connection = readPreparedConnection(props.environmentId);
    if (!connection) throw new Error("Reconnect to the server to transfer files.");
    return new URL(relativeUrl, connection.httpBaseUrl).href;
  }
  async function upload(file: File, previous: ThreadArtifact | null) {
    await perform(async () => {
      if (file.size > THREAD_ARTIFACT_MAX_BYTES) throw new Error("Artifacts can be up to 2 GB.");
      const controller = new AbortController();
      transfer.current = controller;
      const result = await uploadUrl({
        environmentId: props.environmentId,
        input: {
          threadId: props.threadId,
          name: previous?.name ?? file.name,
          mimeType:
            file.type ||
            (file.name.toLowerCase().endsWith(".apk")
              ? "application/vnd.android.package-archive"
              : "application/octet-stream"),
          sizeBytes: file.size,
          ...(previous
            ? { replace: { id: previous.id, expectedRevision: previous.revision } }
            : {}),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const response = await fetch(absoluteUrl(result.value.relativeUrl), {
        method: "POST",
        body: file,
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error((await response.text()) || "Could not upload the artifact.");
    });
  }
  async function download(artifact: ThreadArtifact) {
    await perform(async () => {
      const result = await downloadUrl({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, id: artifact.id },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const link = document.createElement("a");
      link.href = absoluteUrl(result.value.relativeUrl);
      link.download = artifact.name;
      document.body.append(link);
      link.click();
      link.remove();
    });
  }
  return (
    <div className="space-y-2 px-1.5">
      <p className="text-xs text-muted-foreground">
        Files saved with this thread, available on every connected client.
      </p>
      <Input
        ref={picker}
        type="file"
        hidden
        aria-label="Choose artifact file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const previous = replacing.current;
          replacing.current = null;
          event.target.value = "";
          if (file) void upload(file, previous);
        }}
      />
      <div className="flex gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={!canUpload || busy}
          onClick={() => {
            replacing.current = null;
            picker.current?.click();
          }}
        >
          Add file
        </Button>
        {busy ? (
          <Button size="xs" variant="ghost" onClick={() => transfer.current?.abort()}>
            Cancel transfer
          </Button>
        ) : null}
      </div>
      {busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          Working…
        </p>
      ) : null}
      {error || query.error ? (
        <p role="alert" className="text-xs text-destructive">
          {error ?? query.error}
        </p>
      ) : null}
      {!query.data && query.isPending ? (
        <p className="text-xs text-muted-foreground">Loading artifacts…</p>
      ) : null}
      {query.data?.artifacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No artifacts yet. Add a file or ask the agent to publish one.
        </p>
      ) : null}
      <div className="max-h-96 space-y-3 overflow-y-auto">
        {query.data?.artifacts.map((artifact) => (
          <div key={artifact.id} className="space-y-1">
            <p className="break-all text-sm font-medium">{artifact.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatAttachmentSize(artifact.sizeBytes)}
            </p>
            {editing?.id === artifact.id ? (
              <form
                className="space-y-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(async () => {
                    const result = await rename({
                      environmentId: props.environmentId,
                      input: {
                        threadId: props.threadId,
                        id: artifact.id,
                        expectedRevision: editing?.revision ?? artifact.revision,
                        name: name.trim(),
                      },
                    });
                    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                    setEditing(null);
                  });
                }}
              >
                <Input
                  size="compact"
                  aria-label="Artifact name"
                  value={name}
                  onValueChange={setName}
                  autoFocus
                />
                <div className="flex gap-1">
                  <Button
                    size="micro"
                    variant="outline"
                    type="submit"
                    disabled={busy || !canRename || !name.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    size="micro"
                    variant="ghost"
                    type="button"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-1">
                <Button
                  size="micro"
                  variant="outline"
                  disabled={busy || !canDownload}
                  onClick={() => void download(artifact)}
                >
                  Download
                </Button>
                <Button
                  size="micro"
                  variant="ghost"
                  disabled={busy || !canRename}
                  onClick={() => {
                    setEditing(artifact);
                    setName(artifact.name);
                  }}
                >
                  Rename
                </Button>
                <Button
                  size="micro"
                  variant="ghost"
                  disabled={busy || !canUpload}
                  onClick={() => {
                    replacing.current = artifact;
                    picker.current?.click();
                  }}
                >
                  Replace
                </Button>
                <Button
                  size="micro"
                  variant="ghost"
                  disabled={busy || !canDelete}
                  onClick={() => setDeleting(artifact.id)}
                >
                  Delete
                </Button>
              </div>
            )}
            {deleting === artifact.id ? (
              <div className="space-y-1">
                <p className="text-xs">Delete this artifact from the server?</p>
                <div className="flex gap-1">
                  <Button
                    size="micro"
                    variant="destructive"
                    disabled={busy || !canDelete}
                    onClick={() =>
                      void perform(async () => {
                        const result = await remove({
                          environmentId: props.environmentId,
                          input: {
                            threadId: props.threadId,
                            id: artifact.id,
                            expectedRevision: artifact.revision,
                          },
                        });
                        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                        setDeleting(null);
                      })
                    }
                  >
                    Delete file
                  </Button>
                  <Button size="micro" variant="ghost" onClick={() => setDeleting(null)}>
                    Keep file
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
