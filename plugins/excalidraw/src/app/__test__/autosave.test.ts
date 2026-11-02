import { it, expect, vi } from "vitest";
import { createEditorController } from "../editor.ts";
import type { Diagram } from "../../contract.ts";
import { makeScene } from "../../domain/scene.ts";
const doc = (id = "one", revision = 1): Diagram => ({ id, revision, title: id, updatedAt: 1, scene: { elements: [], appState: { viewBackgroundColor: `#00000${revision}` }, files: {} } });
it("coalesces edits behind one in-flight commit and only marks saved after ACK", async () => {
  let finish!: () => void;
  const commit = vi.fn(async input => { await new Promise<void>(r => { finish = r; }); return { ...doc(input.id, input.expectedRevision + 1), scene: input.scene }; });
  const editor = createEditorController({ read: async id => doc(id), commit, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene);
  editor.edit(doc("one", 3).scene); editor.edit(doc("one", 4).scene);
  expect(commit).toHaveBeenCalledTimes(1); expect(editor.state().dirty).toBe(true);
  finish(); await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  expect(commit.mock.calls[1][0].scene).toEqual(doc("one", 4).scene);
  finish(); await editor.flush(); expect(editor.state().dirty).toBe(false);
});
it("keeps a conflicted document draft when visiting another document", async () => {
  const editor = createEditorController({ read: async id => doc(id), commit: async () => { throw new Error("revision_conflict"); }, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  await editor.open("two"); expect(editor.state().document?.id).toBe("two");
  await editor.open("one"); expect(editor.scene()).toEqual(doc("one", 2).scene); expect(editor.state().error).toContain("revision_conflict");
});
it("never silently retries an unknown save result after edits or visibility resume", async () => {
  const commit = vi.fn(async () => { throw new Error("Disconnected"); });
  const editor = createEditorController({ read: async id => doc(id), commit, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  editor.edit(doc("one", 3).scene); editor.resume(); await Promise.resolve();
  expect(commit).toHaveBeenCalledTimes(1); expect(editor.state().dirty).toBe(true);
});

it("retries only a proven unaccepted busy request when the host is available again", async () => {
  let busy = true;
  const commit = vi.fn(async input => { if (busy) throw Object.assign(new Error("busy"), { data: { code: "plugin_app_busy", notAccepted: true } }); return { ...doc(input.id, input.expectedRevision + 1), scene: input.scene }; });
  const editor = createEditorController({ read: async id => doc(id), commit, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  expect(editor.state().dirty).toBe(true); busy = false; editor.resume(); await editor.flush();
  expect(commit).toHaveBeenCalledTimes(2); expect(editor.state().dirty).toBe(false);
});
it("keeps a dirty scene on resource updates and stops autosave on revision conflict", async () => {
  let loaded = doc();
  const editor = createEditorController({ read: async () => loaded, commit: async () => { throw new Error("unknown_result"); }, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  loaded = doc("one", 3); await editor.refresh();
  expect(editor.scene()).toEqual(doc("one", 2).scene); expect(editor.state().dirty).toBe(true); expect(editor.state().error).toContain("草稿已保留");
});

it("keeps edits made to a conflicted document while the next tab is still loading", async () => {
  let finishRead!: (value: Diagram) => void;
  const read = vi.fn(async id => doc(id));
  const editor = createEditorController({ read, commit: async () => { throw new Error("revision_conflict"); }, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const switching = editor.open("two");
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  editor.edit(doc("one", 4).scene); finishRead(doc("two")); await switching;
  await editor.open("one"); expect(editor.scene()).toEqual(doc("one", 4).scene);
});

it("coalesces refresh notifications behind one read and follows up with the latest revision", async () => {
  let inFlight = 0, maximum = 0;
  const reads: Array<(value: Diagram) => void> = [];
  const read = vi.fn(async id => doc(id));
  const editor = createEditorController({ read, commit: vi.fn(), onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one");
  read.mockImplementation(id => new Promise<Diagram>(resolve => {
    maximum = Math.max(maximum, ++inFlight);
    reads.push(value => { inFlight--; resolve(value); });
  }));
  const pending = [editor.refresh(), editor.refresh(), editor.refresh(), editor.refresh()];
  expect(read).toHaveBeenCalledTimes(2); expect(maximum).toBe(1);
  reads[0](doc("one", 2));
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(inFlight).toBe(1); reads[1](doc("one", 4));
  await Promise.all(pending);
  expect(maximum).toBe(1); expect(read).toHaveBeenCalledTimes(3);
  expect(editor.state().document?.revision).toBe(4);
});
it("does not apply an old refresh after switching away and back to the same document", async () => {
  let finishRead!: (value: Diagram) => void;
  const read = vi.fn(async id => doc(id));
  const onScene = vi.fn();
  const editor = createEditorController({ read, commit: vi.fn(), onScene, onState: vi.fn() });
  await editor.open("one");
  read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const refreshing = editor.refresh();
  await editor.open("two"); await editor.open("one");
  const changes = onScene.mock.calls.length;
  finishRead(doc("one", 9)); await refreshing;
  expect(editor.state().document).toMatchObject({ id: "one", revision: 1 });
  expect(onScene).toHaveBeenCalledTimes(changes);
});

it("does not lose a refresh queued while the previous read is settling", async () => {
  let latest = doc();
  const read = vi.fn(async () => latest);
  let editor!: ReturnType<typeof createEditorController>;
  editor = createEditorController({ read, commit: vi.fn(), onScene: vi.fn(), onState(state) {
    if (state.document?.revision === 2) queueMicrotask(() => { latest = doc("one", 3); void editor.refresh(); });
  } });
  await editor.open("one"); latest = doc("one", 2);
  await editor.refresh();
  await vi.waitFor(() => expect(editor.state().document?.revision).toBe(3));
  expect(read).toHaveBeenCalledTimes(3);
});

it("does not save the normalized canvas echoed asynchronously after loading or an Agent update", async () => {
  let loaded = { ...doc(), scene: makeScene([{ id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }]) };
  const commit = vi.fn(async input => ({ ...loaded, revision: input.expectedRevision + 1, scene: input.scene }));
  let editor!: ReturnType<typeof createEditorController>;
  editor = createEditorController({ read: async () => loaded, commit, onState: vi.fn(), onScene(scene) {
    const normalized = { ...scene, appState: { ...scene.appState, gridSize: 20, gridStep: 5 },
      elements: scene.elements.map(el => ({ ...el, index: "a0", boundElements: [], version: el.version + 1, versionNonce: 42, updated: 100 })) };
    // React emits onChange after updateScene has returned, outside the synchronous applying guard.
    queueMicrotask(() => editor.edit(normalized));
    return normalized;
  } });
  await editor.open("one"); await editor.flush();
  expect(editor.state()).toMatchObject({ dirty: false, error: null });
  expect(commit).not.toHaveBeenCalled();
  loaded = { ...loaded, revision: 2, scene: makeScene([{ id: "box", type: "rectangle", x: 10, y: 0, width: 100, height: 50 }]) };
  await editor.refresh(); await editor.flush();
  expect(commit).not.toHaveBeenCalled();
  const scene = structuredClone(editor.scene()); scene.elements[0]!.x = 30;
  editor.edit(scene); await editor.flush();
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0]![0]).toMatchObject({ id: "one", expectedRevision: 2, scene: { elements: [{ x: 30 }] } });
});

it("waits quietly on proven busy admission and resumes with only the latest draft", async () => {
  let busy = true;
  const commit = vi.fn(async input => {
    if (busy) throw Object.assign(new Error("plugin_app_busy"), { data: { code: "plugin_app_busy", notAccepted: true } });
    return { ...doc(input.id, input.expectedRevision + 1), scene: input.scene };
  });
  const editor = createEditorController({ read: async id => doc(id), commit, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  expect(editor.state()).toMatchObject({ dirty: true, waiting: true, saving: false, error: null });
  editor.edit(doc("one", 3).scene); editor.edit(doc("one", 4).scene);
  expect(commit).toHaveBeenCalledTimes(1);
  await editor.refresh(); busy = false; editor.resume(); await editor.flush();
  expect(commit).toHaveBeenCalledTimes(2);
  expect(commit.mock.calls[1]![0].scene).toEqual(doc("one", 4).scene);
  expect(editor.state()).toMatchObject({ dirty: false, waiting: false, error: null });
});

it("retains a waiting draft across document switches and only retries proven unaccepted saves", async () => {
  let hidden = true;
  const commit = vi.fn(async input => {
    if (hidden) throw Object.assign(new Error("hidden"), { data: { code: "plugin_app_hidden", notAccepted: true } });
    return { ...doc(input.id, input.expectedRevision + 1), scene: input.scene };
  });
  const editor = createEditorController({ read: async id => doc(id), commit, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  await editor.open("two"); expect(editor.state()).toMatchObject({ dirty: false, waiting: false });
  await editor.open("one"); expect(editor.scene()).toEqual(doc("one", 2).scene);
  expect(editor.state()).toMatchObject({ dirty: true, waiting: true, error: null });
  hidden = false; editor.resume(); await editor.flush();
  expect(commit).toHaveBeenCalledTimes(2);
  expect(commit.mock.calls[1]![0]).toMatchObject({ id: "one", expectedRevision: 1 });
});

it("stops waiting on a real remote revision conflict and keeps the draft without retrying", async () => {
  let loaded = doc();
  const commit = vi.fn(async () => { throw Object.assign(new Error("busy"), { data: { code: "plugin_app_busy", notAccepted: true } }); });
  const editor = createEditorController({ read: async id => id === "one" ? loaded : doc(id), commit, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one"); editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  loaded = doc("one", 3); await editor.refresh(); editor.resume();
  expect(editor.state()).toMatchObject({ dirty: true, waiting: false });
  expect(editor.state().error).toContain("草稿已保留");
  await editor.open("two"); await editor.open("one");
  expect(editor.scene()).toEqual(doc("one", 2).scene);
  expect(commit).toHaveBeenCalledTimes(1);
});

it.each([
  ["busy", Object.assign(new Error("busy"), { data: { code: "plugin_app_busy", notAccepted: true } })],
  ["unknown result", new Error("unknown_result")],
  ["permission denied", new Error("permission_denied")],
])("keeps edits rejected by %s when a same-document read finishes with a newer revision", async (_name, rejection) => {
  let finishRead!: (value: Diagram) => void;
  const read = vi.fn(async () => doc());
  const commit = vi.fn(async () => { throw rejection; });
  const editor = createEditorController({ read, commit, onScene: vi.fn(), onState: vi.fn() });
  await editor.open("one");
  read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const reopening = editor.open("one");
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  editor.edit(doc("one", 2).scene); await editor.flush().catch(() => {});
  finishRead(doc("one", 3)); await reopening;
  expect(editor.state()).toMatchObject({ dirty: true, waiting: false, document: { revision: 1 } });
  expect(editor.scene()).toEqual(doc("one", 2).scene);
  expect(editor.state().error).toBeTruthy();
  editor.resume(); await Promise.resolve();
  expect(commit).toHaveBeenCalledTimes(1);
});
