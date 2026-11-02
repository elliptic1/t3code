import { FILL_PREVIEW_VIEWPORT, type ScopedThreadRef } from "@t3tools/contracts";
import { GripHorizontal, PanelRightIcon, PictureInPicture2, XIcon } from "lucide-react";
import { previewPdfAssetUrl } from "@t3tools/shared/preview";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { create } from "zustand";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import { useChatCanvas } from "../chat/ChatCanvasContext";
import type { ChatCanvasPreview } from "../chat/chatCanvasLayout";
import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import {
  findActiveBrowserRecordingRuntimeTabId,
  useActiveBrowserRecordingTabIds,
} from "~/browser/browserRecording";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import type { BrowserViewportResizeDirection } from "~/browser/browserViewportLayout";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { rendersServerTabNatively } from "~/browser/previewRuntime";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { type ServerBrowserHandle, ServerBrowserSurface } from "~/browser/ServerBrowserSurface";
import {
  closeServerPictureInPicture,
  openServerPictureInPicture,
  serverPictureInPictureKey,
  supportsServerPictureInPicture,
  useServerPictureInPictureKey,
} from "~/browser/serverPictureInPicture";
import { useBrowserLayoutZoomFactor } from "~/browser/useBrowserLayoutZoomFactor";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useThreadPreviewState } from "~/previewStateStore";
import {
  type PreviewMiniPlayerSize,
  type PreviewMiniPlayerSource,
  type PreviewMiniPlayerState,
  browserMiniPlayerSource,
  previewMiniPlayerSourceKey,
  usePreviewMiniPlayerStore,
} from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useDeviceState } from "~/state/device";

import { DeviceStreamView } from "../device/DeviceStreamView";
import type { DeviceScreenSize } from "@t3tools/client-runtime/device/stream";
import { Atom } from "effect/reactivity";
import { deviceScreenKey, deviceStreamScreenAtom } from "../device/deviceStreamSession";
import type { PreviewStreamViewport } from "@t3tools/client-runtime/preview/server-browser-stream";
import { previewBridge } from "./previewBridge";
import { showPreviewPopup } from "./showPreviewPopup";
import { startPreviewMiniPlayerGesture } from "./previewMiniPlayerGesture";
import {
  clampPreviewMiniPlayerPosition,
  PREVIEW_MINI_PLAYER_CORNER_RADIUS,
  PREVIEW_MINI_PLAYER_HEADER_HEIGHT,
  PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX,
  type PreviewMiniPlayerFrame,
  resizePreviewMiniPlayer,
  resolveDeviceMiniPlayerCornerRadius,
  resolveDeviceMiniPlayerSourceSize,
  resolvePreviewMiniPlayerSourceSize,
} from "./previewMiniPlayerLayout";

// A touch that travels less than this is a tap on the handle, not a drag.
const HANDLE_TAP_SLOP_PX = 6;

interface Props {
  readonly threadRef: ScopedThreadRef;
  readonly miniPlayer: PreviewMiniPlayerState;
}

const frameCornerRadius = () => PREVIEW_MINI_PLAYER_CORNER_RADIUS;

const RESIZE_HANDLES: ReadonlyArray<{
  readonly direction: BrowserViewportResizeDirection;
  readonly className: string;
}> = [
  { direction: "north", className: "inset-x-0 -top-1 h-2 cursor-ns-resize" },
  { direction: "south", className: "inset-x-0 -bottom-1 h-2 cursor-ns-resize" },
  { direction: "west", className: "inset-y-0 -left-1 w-2 cursor-ew-resize" },
  { direction: "east", className: "inset-y-0 -right-1 w-2 cursor-ew-resize" },
  { direction: "northwest", className: "-left-2 -top-2 size-4 cursor-nwse-resize" },
  { direction: "northeast", className: "-right-2 -top-2 size-4 cursor-nesw-resize" },
  { direction: "southwest", className: "-bottom-2 -left-2 size-4 cursor-nesw-resize" },
  { direction: "southeast", className: "-bottom-2 -right-2 size-4 cursor-nwse-resize" },
];

// What the stream reports about its source. It lives outside the player so the
// chat canvas lays out the frame from the same source size the player uses. One
// slot is enough, since only the shown thread renders a player, and it keeps the
// store from collecting an entry for every tab a session ever streamed.
const useStreamedSourceSize = create<{
  readonly key: string;
  readonly viewport: PreviewStreamViewport;
} | null>(() => null);

const NO_DEVICE_SCREEN_ATOM = Atom.make<DeviceScreenSize | null>(null).pipe(
  Atom.withLabel("device-stream-screen:none"),
);

const streamedSourceKey = (threadRef: ScopedThreadRef, sourceKey: string) =>
  `${scopedThreadKey(threadRef)}\u0000${sourceKey}`;

// The mini player's device stream view, named so the canvas can read the
// screen size that view reports.
const miniPlayerDeviceViewId = (
  threadRef: ScopedThreadRef,
  source: Extract<PreviewMiniPlayerSource, { kind: "device" }>,
) =>
  `preview-mini-player\u0000${scopedThreadKey(threadRef)}\u0000${deviceScreenKey(threadRef.environmentId, source.hostId, source.deviceId)}`;

function useBrowserMiniPlayerSource(threadRef: ScopedThreadRef | null, tabId: string | null) {
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = tabId === null ? null : (previewState.sessions[tabId] ?? null);
  const runtimeTabId =
    threadRef && tabId !== null
      ? previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId)
      : null;
  const desktopOverlay = tabId === null ? null : (previewState.desktopByTabId[tabId] ?? null);
  const layoutZoomFactor = useBrowserLayoutZoomFactor(desktopOverlay?.zoomFactor ?? 1);
  const fittedSourceContent = useBrowserSurfaceStore((state) =>
    runtimeTabId === null ? null : (state.byTabId[runtimeTabId]?.fittedSourceContent ?? null),
  );
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const serverTab =
    threadRef !== null &&
    snapshot?.runtime === "server" &&
    !rendersServerTabNatively(threadRef.environmentId, primaryEnvironmentId, snapshot);
  const streamViewport = useStreamedSourceSize((state) =>
    threadRef &&
    tabId !== null &&
    state?.key ===
      streamedSourceKey(threadRef, previewMiniPlayerSourceKey(browserMiniPlayerSource(tabId)))
      ? state.viewport
      : null,
  );
  const sourceSize: PreviewMiniPlayerSize =
    serverTab && streamViewport
      ? streamViewport
      : resolvePreviewMiniPlayerSourceSize(
          snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT,
          fittedSourceContent,
          layoutZoomFactor,
        );
  return { serverEpoch: previewState.serverEpoch, snapshot, desktopOverlay, serverTab, sourceSize };
}

/** The mini player as the chat canvas lays it out; null when no player renders. */
export function useThreadPreviewCanvasSource(
  threadRef: ScopedThreadRef | null,
  miniPlayer: PreviewMiniPlayerState | null,
): ChatCanvasPreview | null {
  const source = miniPlayer?.source ?? null;
  const browser = useBrowserMiniPlayerSource(
    threadRef,
    source?.kind === "browser" ? source.tabId : null,
  );
  const sourceKey = source ? previewMiniPlayerSourceKey(source) : null;
  const screen = useAtomValue(
    threadRef && source?.kind === "device"
      ? deviceStreamScreenAtom(miniPlayerDeviceViewId(threadRef, source))
      : NO_DEVICE_SCREEN_ATOM,
  );
  if (!miniPlayer || !source || sourceKey === null) return null;
  if (source.kind === "browser" && !browser.snapshot) return null;
  return {
    key: sourceKey,
    width: miniPlayer.width,
    position: miniPlayer.position,
    lastInteraction: miniPlayer.lastInteraction,
    source:
      source.kind === "browser"
        ? browser.sourceSize
        : resolveDeviceMiniPlayerSourceSize(source.platform, screen),
    ...(source.kind === "browser"
      ? { headerHeight: PREVIEW_MINI_PLAYER_HEADER_HEIGHT, overlay: true }
      : {}),
  };
}

export function ThreadPreviewMiniPlayer({ threadRef, miniPlayer }: Props) {
  const { source } = miniPlayer;
  return source.kind === "browser" ? (
    <BrowserMiniPlayer
      key={source.tabId}
      threadRef={threadRef}
      tabId={source.tabId}
      miniPlayer={miniPlayer}
    />
  ) : (
    <DeviceMiniPlayer
      key={previewMiniPlayerSourceKey(source)}
      threadRef={threadRef}
      source={source}
      miniPlayer={miniPlayer}
    />
  );
}

function BrowserMiniPlayer({ threadRef, tabId, miniPlayer }: Props & { readonly tabId: string }) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const { serverEpoch, snapshot, desktopOverlay, serverTab, sourceSize } =
    useBrowserMiniPlayerSource(threadRef, tabId);
  const runtimeTabId = previewRuntimeTabId(threadRef, serverEpoch, tabId);
  const recordingTabIds = useActiveBrowserRecordingTabIds();
  const recording =
    recordingTabIds.has(runtimeTabId) ||
    findActiveBrowserRecordingRuntimeTabId(threadRef, tabId) !== null;
  const serverSurfaceRef = useRef<ServerBrowserHandle | null>(null);
  const serverPictureInPicture =
    useServerPictureInPictureKey() === serverPictureInPictureKey(threadRef.threadId, tabId);
  const viewportKey = streamedSourceKey(
    threadRef,
    previewMiniPlayerSourceKey(browserMiniPlayerSource(tabId)),
  );

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openBrowser(threadRef, tabId);
  };

  const toggleNativePictureInPicture = async () => {
    try {
      if (serverTab) {
        if (serverPictureInPicture) closeServerPictureInPicture();
        else
          await openServerPictureInPicture({
            ...threadRef,
            tabId,
            seed: serverSurfaceRef.current?.canvas() ?? null,
          });
      } else if (previewBridge) {
        const operation = desktopOverlay?.pictureInPicture
          ? previewBridge.pictureInPicture.close
          : previewBridge.pictureInPicture.open;
        await operation(runtimeTabId);
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: serverTab ? "Unable to pop out preview" : "Unable to update popped-out preview",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  if (!snapshot) return null;
  const pdfUrl =
    snapshot.navStatus._tag === "Success"
      ? previewPdfAssetUrl(snapshot.navStatus.url, httpBaseUrl)
      : null;
  const poppedOut = serverTab ? serverPictureInPicture : Boolean(desktopOverlay?.pictureInPicture);
  const canPopOut = serverTab
    ? poppedOut || (pdfUrl === null && supportsServerPictureInPicture())
    : true;

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      label="Floating browser preview"
      recording={recording}
      headerHeight={PREVIEW_MINI_PLAYER_HEADER_HEIGHT}
      onOpenInPanel={openInPanel}
      pillActions={
        canPopOut ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={poppedOut ? "secondary" : "ghost"}
                  size="icon-xs"
                  aria-label={
                    poppedOut ? "Close popped-out preview" : "Pop preview into separate window"
                  }
                  disabled={!serverTab && !desktopOverlay?.hasWebContents}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={toggleNativePictureInPicture}
                />
              }
            >
              <PictureInPicture2 />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {poppedOut ? "Close separate window" : "Pop into separate window"}
            </TooltipPopup>
          </Tooltip>
        ) : null
      }
    >
      {(frame) =>
        serverTab ? (
          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 top-[36px] overflow-hidden rounded-b-xl"
            style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
          >
            <ServerBrowserSurface
              ref={serverSurfaceRef}
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              tabId={tabId}
              pdfUrl={pdfUrl}
              visible
              followSize={false}
              controlPosition="bottom"
              onViewport={(viewport) =>
                useStreamedSourceSize.setState(
                  (state) =>
                    state?.key === viewportKey &&
                    state.viewport.width === viewport.width &&
                    state.viewport.height === viewport.height
                      ? state
                      : { key: viewportKey, viewport },
                  true,
                )
              }
              onPopup={(popupTabId) => showPreviewPopup(threadRef, popupTabId, "floating")}
              className="size-full"
            />
          </div>
        ) : (
          <>
            <BrowserSurfaceSlot
              tabId={runtimeTabId}
              visible={Boolean(desktopOverlay?.hasWebContents)}
              cornerRadius={PREVIEW_MINI_PLAYER_CORNER_RADIUS}
              zIndex={PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX}
              fitSourceContent
              layoutVersion={`${frame.x}:${frame.y}`}
              className="absolute inset-x-0 bottom-0 top-[36px]"
            />
            {!desktopOverlay?.hasWebContents ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[36px] z-[49] flex items-center justify-center rounded-[inherit] bg-muted text-xs text-muted-foreground">
                Reconnecting preview…
              </div>
            ) : null}
          </>
        )
      }
    </MiniPlayerShell>
  );
}

function DeviceMiniPlayer({
  threadRef,
  source,
  miniPlayer,
}: Props & { readonly source: Extract<PreviewMiniPlayerSource, { kind: "device" }> }) {
  const { state: deviceState } = useDeviceState(threadRef.environmentId);
  const viewId = miniPlayerDeviceViewId(threadRef, source);
  const screen = useAtomValue(deviceStreamScreenAtom(viewId));
  const sourceSize = resolveDeviceMiniPlayerSourceSize(source.platform, screen);
  const device = deviceState.devices.find(
    (entry) => entry.hostId === source.hostId && entry.id === source.deviceId,
  );
  const host = deviceState.hosts.find((entry) => entry.id === source.hostId);
  const hostLabel = host?.label ?? "Device host";
  const cornerRadius = (player: PreviewMiniPlayerSize) =>
    resolveDeviceMiniPlayerCornerRadius(source.platform, player);

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openDevice(threadRef, {
      hostId: source.hostId,
      deviceId: source.deviceId,
      platform: source.platform,
      name: source.name,
    });
  };

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      label="Floating device preview"
      onOpenInPanel={openInPanel}
      cornerRadius={cornerRadius}
    >
      {() => (
        <div
          className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
          style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
        >
          <DeviceStreamView
            environmentId={threadRef.environmentId}
            platform={source.platform}
            deviceId={source.deviceId}
            hostId={source.hostId}
            deviceName={device?.name ?? source.name}
            deviceDescription={`${hostLabel} · ${device?.version ?? source.platform}`}
            visible
            viewId={viewId}
            serveSimOnly={host?.kind === "simlock"}
          />
        </div>
      )}
    </MiniPlayerShell>
  );
}

/** Match native clipping and DOM radii to align their separately composited edges. */
function MiniPlayerShell({
  threadRef,
  miniPlayer,
  sourceSize,
  label,
  onOpenInPanel,
  pillActions,
  recording = false,
  headerHeight = 0,
  cornerRadius = frameCornerRadius,
  children,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly miniPlayer: PreviewMiniPlayerState;
  readonly sourceSize: PreviewMiniPlayerSize;
  readonly label: string;
  readonly onOpenInPanel: () => void;
  readonly pillActions?: ReactNode;
  readonly recording?: boolean;
  readonly headerHeight?: number;
  /** The clip radius for a given frame; the pill stays inside the curve. */
  readonly cornerRadius?: (frame: PreviewMiniPlayerSize) => number;
  readonly children: (frame: PreviewMiniPlayerFrame) => ReactNode;
}) {
  const canvas = useChatCanvas();
  const gestureCleanupRef = useRef<(() => void) | null>(null);
  // Touch has no hover, so tapping the handle toggles the pill instead.
  const [pillOpen, setPillOpen] = useState(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document pointerdown listener closes the open pill on an outside press
  useEffect(() => {
    if (!pillOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && handleRef.current?.contains(event.target)) return;
      setPillOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [pillOpen]);
  const container = canvas?.container ?? null;
  const sourceKey = previewMiniPlayerSourceKey(miniPlayer.source);
  const frame = canvas?.previewKey === sourceKey ? canvas.layout.frame : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels window pointer listeners when the gesture source changes
  useLayoutEffect(
    () => () => gestureCleanupRef.current?.(),
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Cancel gestures when their source or thread changes, as well as on unmount.
    [sourceKey, threadRef.environmentId, threadRef.threadId],
  );

  const radius = frame ? cornerRadius(frame) : PREVIEW_MINI_PLAYER_CORNER_RADIUS;
  const pillInset = Math.max(8, Math.round(radius * 0.55));

  const close = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
  };

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    direction: BrowserViewportResizeDirection | null,
  ) => {
    if (event.button !== 0 || !frame || !container || gestureCleanupRef.current) return;
    // Only toolbar background starts a drag; controls keep their own pointer behavior.
    if (
      event.target instanceof Element &&
      event.target.closest("button, input, textarea, select, a, [role='button'], [contenteditable]")
    )
      return;
    const gesture = {
      pointerType: event.pointerType,
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame,
      direction,
      moved: false,
    };
    event.preventDefault();
    event.stopPropagation();
    gestureCleanupRef.current = startPreviewMiniPlayerGesture({
      target: event.currentTarget,
      pointerId: event.pointerId,
      cursor: direction === null ? "grabbing" : getComputedStyle(event.currentTarget).cursor,
      finish: () => {
        gestureCleanupRef.current = null;
      },
      move: (event) => {
        const delta = { x: event.clientX - gesture.pointerX, y: event.clientY - gesture.pointerY };
        if (!gesture.moved && Math.hypot(delta.x, delta.y) < HANDLE_TAP_SLOP_PX) {
          // The header keeps its controls visible, so only the hover pill needs a tap.
          if (
            event.type === "pointerup" &&
            gesture.direction === null &&
            gesture.pointerType === "touch" &&
            !headerHeight
          ) {
            // Wait out the tap's click, which would otherwise land on the pill.
            setTimeout(() => setPillOpen((open) => !open), 0);
          }
          return;
        }
        gesture.moved = true;
        const store = usePreviewMiniPlayerStore.getState();
        if (gesture.direction === null) {
          store.move(
            threadRef,
            sourceKey,
            clampPreviewMiniPlayerPosition(
              { x: gesture.frame.x + delta.x, y: gesture.frame.y + delta.y },
              container,
              gesture.frame,
            ),
          );
          return;
        }
        const next = resizePreviewMiniPlayer({
          start: gesture.frame,
          direction: gesture.direction,
          delta,
          source: sourceSize,
          container,
          headerHeight,
        });
        store.resize(threadRef, sourceKey, next.width, { x: next.x, y: next.y });
      },
    });
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {frame ? (
        <section
          aria-label={label}
          data-preview-mini-player={sourceKey}
          className="pointer-events-none absolute select-none"
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
            borderRadius: radius,
          }}
        >
          <div
            ref={handleRef}
            data-pill-open={pillOpen ? "" : undefined}
            className={cn(
              "group pointer-events-auto absolute z-[49] touch-none cursor-grab active:cursor-grabbing",
              headerHeight
                ? "inset-x-0 top-0 h-[36px] rounded-t-xl border-b border-border/80 bg-popover"
                : "size-3 pointer-coarse:-m-2.5 pointer-coarse:size-8",
            )}
            style={headerHeight ? undefined : { right: pillInset, top: pillInset }}
            data-preview-mini-player-drag
            onPointerDown={(event) => beginGesture(event, null)}
          >
            <div
              role={recording && !headerHeight ? "status" : undefined}
              aria-label={recording && !headerHeight ? "Recording preview" : undefined}
              aria-hidden={!recording}
              className={cn(
                "absolute right-0 top-0 size-2 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 group-data-pill-open:opacity-0 pointer-coarse:right-2.5 pointer-coarse:top-2.5",
                headerHeight && "hidden",
              )}
            >
              <span
                className={cn(
                  "block size-2 rounded-full shadow-sm ring-1 ring-background/70",
                  recording
                    ? "bg-destructive motion-safe:animate-status-pulse"
                    : "bg-foreground/25",
                )}
              />
            </div>
            <div
              className={cn(
                "absolute flex items-center gap-0.5 p-0.5",
                headerHeight
                  ? "inset-0"
                  : "pointer-events-none right-0 top-0 h-8 cursor-grab rounded-lg border border-border/80 bg-popover/92 opacity-0 shadow-lg/20 backdrop-blur-xl transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-data-pill-open:pointer-events-auto group-data-pill-open:opacity-100 active:cursor-grabbing pointer-coarse:right-2.5 pointer-coarse:top-2.5",
              )}
            >
              {headerHeight ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <GripHorizontal className="size-4 shrink-0" />
                  <span className="truncate">Drag to move</span>
                </span>
              ) : null}
              {recording ? (
                <span
                  role={headerHeight ? "status" : undefined}
                  aria-label={headerHeight ? "Recording preview" : undefined}
                  aria-hidden={!headerHeight}
                  className="flex size-6 shrink-0 items-center justify-center"
                >
                  <span className="size-2 rounded-full bg-destructive motion-safe:animate-status-pulse" />
                </span>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Open preview in right panel"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={onOpenInPanel}
                    />
                  }
                >
                  <PanelRightIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">Open in right panel</TooltipPopup>
              </Tooltip>
              {pillActions}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Close floating preview"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={close}
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">Close floating preview</TooltipPopup>
              </Tooltip>
            </div>
          </div>

          <div className="absolute inset-0 z-[47] rounded-[inherit] bg-muted shadow-2xl/35" />
          {children(frame)}
          <div className="pointer-events-none absolute inset-0 z-[49] rounded-[inherit] ring-1 ring-inset ring-border/80" />
          {RESIZE_HANDLES.map(({ direction, className }) => (
            <div
              key={direction}
              role="presentation"
              data-preview-mini-player-resize={direction}
              className={cn("pointer-events-auto absolute z-[49] touch-none", className)}
              onPointerDown={(event) => beginGesture(event, direction)}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
