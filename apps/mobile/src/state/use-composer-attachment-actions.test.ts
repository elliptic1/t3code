import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  pickComposerMedia: vi.fn(async () => ({ attachments: [], error: null })),
}));

vi.mock("react", () => ({ useRef: (value: unknown) => ({ current: value }) }));
vi.mock("../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../lib/composerImages", () => ({
  pickComposerMedia: mocks.pickComposerMedia,
  pickComposerFiles: vi.fn(),
  convertPastedImagesToAttachments: vi.fn(),
  createPastedTextComposerAttachment: vi.fn(),
  removePersistedComposerAttachmentFile: vi.fn(),
}));
vi.mock("./use-composer-drafts", () => ({
  appendComposerDraftAttachments: vi.fn(async () => 0),
  captureComposerDraftInsertion: vi.fn(() => ({})),
  countComposerDraftAttachmentsAfterSelection: vi.fn(() => 0),
  getComposerDraftSnapshot: vi.fn(),
}));
vi.mock("./composerDraftOperations", () => ({
  startComposerDraftOperation: () => ({
    signal: new AbortController().signal,
    finish: () => {},
  }),
}));

import { useComposerAttachmentActions } from "./use-composer-attachment-actions";

describe("useComposerAttachmentActions", () => {
  it("forwards the camera source to the picker", async () => {
    const { onPickDraftMedia } = useComposerAttachmentActions({
      draftKey: "draft",
      serverConfig: null,
    });

    await onPickDraftMedia("camera");
    expect(mocks.pickComposerMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "camera" }),
    );

    await onPickDraftMedia();
    expect(mocks.pickComposerMedia).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ source: expect.anything() }),
    );
  });
});
