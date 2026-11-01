import { useAtomValue } from "@effect/atom-react";
import {
  THREAD_ARTIFACT_MAX_BYTES,
  type EnvironmentId,
  type ThreadId,
  type ThreadArtifact,
} from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { useEffect, useRef, useState } from "react";
import { Alert, Modal, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import {
  downloadAndShareAttachment,
  installAndOpenApk,
  isApkFile,
  openAttachmentInViewer,
} from "../../lib/attachmentDownload";
import { beginForegroundHandoff } from "../../lib/foreground-handoff";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePreparedConnection } from "../../state/session";

export function ThreadArtifactsModal(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onClose: () => void;
}) {
  return (
    <Modal visible animationType="slide" onRequestClose={props.onClose}>
      <ArtifactFiles {...props} />
    </Modal>
  );
}

function ArtifactFiles(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const connection = usePreparedConnection(props.environmentId);
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
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ThreadArtifact | null>(null);
  const [name, setName] = useState("");
  const transfer = useRef<AbortController | null>(null);
  useEffect(() => () => transfer.current?.abort(), []);

  function absoluteUrl(relativeUrl: string) {
    if (Option.isNone(connection)) throw new Error("Reconnect to the server to transfer files.");
    return new URL(relativeUrl, connection.value.httpBaseUrl).href;
  }
  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const controller = new AbortController();
    transfer.current = controller;
    setBusy(true);
    setError(null);
    try {
      await action(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      transfer.current = null;
      setBusy(false);
      setStatus(null);
    }
  }
  async function upload(previous?: ThreadArtifact) {
    await perform(async (signal) => {
      const { getDocumentAsync } = await import("expo-document-picker");
      const endHandoff = beginForegroundHandoff();
      const picked = await getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      }).finally(endHandoff);
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      const { File, UploadType } = await import("expo-file-system");
      const file = new File(asset.uri);
      try {
        if (signal.aborted) return;
        const sizeBytes = asset.size ?? file.size;
        if (sizeBytes > THREAD_ARTIFACT_MAX_BYTES) throw new Error("Artifacts can be up to 2 GB.");
        const mimeType =
          asset.mimeType ||
          (asset.name.toLowerCase().endsWith(".apk")
            ? "application/vnd.android.package-archive"
            : "application/octet-stream");
        setStatus("Preparing upload…");
        const result = await uploadUrl({
          environmentId: props.environmentId,
          input: {
            threadId: props.threadId,
            name: previous?.name ?? asset.name,
            mimeType,
            sizeBytes,
            ...(previous
              ? { replace: { id: previous.id, expectedRevision: previous.revision } }
              : {}),
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        if (signal.aborted) return;
        const response = await file.upload(absoluteUrl(result.value.relativeUrl), {
          httpMethod: "POST",
          uploadType: UploadType.BINARY_CONTENT,
          signal,
          headers: { "Content-Type": mimeType },
          onProgress: ({ bytesSent, totalBytes }) =>
            setStatus(
              `Uploading… ${totalBytes > 0 ? Math.floor((bytesSent / totalBytes) * 100) : 0}%`,
            ),
        });
        if (response.status < 200 || response.status >= 300)
          throw new Error(response.body || "Could not upload the artifact.");
      } finally {
        // The picker returned a disposable cache copy, never the user's original file.
        if (file.exists) file.delete();
      }
    });
  }
  async function download(artifact: ThreadArtifact, action: "open" | "install" | "share") {
    await perform(async (signal) => {
      setStatus("Downloading…");
      const result = await downloadUrl({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, id: artifact.id },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const url = absoluteUrl(result.value.relativeUrl);
      if (action === "install") await installAndOpenApk({ url, attachment: artifact, signal });
      else if (action === "open")
        await openAttachmentInViewer({ uri: url, attachment: artifact, signal });
      else await downloadAndShareAttachment({ url, attachment: artifact, signal });
    });
  }
  function confirmDelete(artifact: ThreadArtifact) {
    Alert.alert("Delete artifact?", `Remove ${artifact.name} from the server?`, [
      { text: "Keep file", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
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
          }),
      },
    ]);
  }
  return (
    <View
      className="flex-1 bg-screen"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center justify-between border-b border-border px-4 py-2">
        <Text className="text-lg font-semibold text-foreground">Artifacts</Text>
        <MaterialButton label="Done" tone="text" onPress={props.onClose} />
      </View>
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        <Text className="text-sm text-foreground-muted">
          Files saved with this thread, available on every connected client.
        </Text>
        <MaterialButton
          label="Add file"
          disabled={busy || !canUpload}
          onPress={() => void upload()}
        />
        {busy ? (
          <View className="gap-2">
            <Text accessibilityRole="text" className="text-sm text-foreground-muted">
              {status ?? "Working…"}
            </Text>
            <MaterialButton
              label="Cancel transfer"
              tone="text"
              onPress={() => transfer.current?.abort()}
            />
          </View>
        ) : null}
        {error || query.error ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {error ?? query.error}
          </Text>
        ) : null}
        {!query.data && query.isPending ? (
          <Text className="text-sm text-foreground-muted">Loading artifacts…</Text>
        ) : null}
        {query.data?.artifacts.length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            No artifacts yet. Add a file or ask the agent to publish one.
          </Text>
        ) : null}
        {query.data?.artifacts.map((artifact) => (
          <View key={artifact.id} className="gap-2 rounded-xl border border-border p-3">
            <Text className="text-base font-semibold text-foreground">{artifact.name}</Text>
            <Text className="text-xs text-foreground-muted">
              {formatAttachmentSize(artifact.sizeBytes)}
            </Text>
            {editing?.id === artifact.id ? (
              <View className="gap-2">
                <TextInput
                  accessibilityLabel="Artifact name"
                  className="rounded-lg border border-border px-3 py-2 text-foreground"
                  value={name}
                  onChangeText={setName}
                  maxLength={255}
                  autoFocus
                />
                <View className="flex-row flex-wrap gap-2">
                  <MaterialButton
                    label="Save name"
                    disabled={busy || !canRename || !name.trim()}
                    onPress={() =>
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
                      })
                    }
                  />
                  <MaterialButton label="Cancel" tone="text" onPress={() => setEditing(null)} />
                </View>
              </View>
            ) : (
              <>
                <View className="flex-row flex-wrap gap-2">
                  <MaterialButton
                    label={isApkFile(artifact) ? "Install and open" : "Open"}
                    disabled={busy || !canDownload}
                    onPress={() =>
                      void download(artifact, isApkFile(artifact) ? "install" : "open")
                    }
                  />
                  <MaterialButton
                    label="Save or share"
                    disabled={busy || !canDownload}
                    onPress={() => void download(artifact, "share")}
                  />
                </View>
                <View className="flex-row flex-wrap gap-2">
                  <MaterialButton
                    label="Rename"
                    tone="text"
                    disabled={busy || !canRename}
                    onPress={() => {
                      setEditing(artifact);
                      setName(artifact.name);
                    }}
                  />
                  <MaterialButton
                    label="Replace"
                    tone="text"
                    disabled={busy || !canUpload}
                    onPress={() => void upload(artifact)}
                  />
                  <MaterialButton
                    label="Delete"
                    tone="text"
                    disabled={busy || !canDelete}
                    onPress={() => confirmDelete(artifact)}
                  />
                </View>
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
