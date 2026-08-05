/**
 * Clipboard helper regressions (issue #16): unguarded navigator.clipboard
 * calls threw a TypeError on insecure origins (plain-HTTP LAN Foundry
 * installs), where `navigator.clipboard` is undefined. copyText() must pick
 * `navigator.clipboard.writeText` when the browser exposes it, fall back to a
 * hidden <textarea> + `document.execCommand("copy")` otherwise, and never
 * throw — returning a boolean success flag instead.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { copyText } from "../scripts/shared/clipboard.mjs";

/**
 * Swap a global for the duration of a test and restore it afterwards.
 * Node's `navigator` is an accessor, so plain assignment silently fails —
 * replace the property descriptor instead.
 */
async function withGlobal(name, value, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (saved) Object.defineProperty(globalThis, name, saved);
    else delete globalThis[name];
  }
}

/** Install stubbed navigator + document globals for one test body. */
async function withClipboardEnv(navigatorValue, doc, fn) {
  await withGlobal("navigator", navigatorValue, () =>
    withGlobal("document", doc.document, fn));
}

/** A fake DOM recording textarea lifecycle + execCommand calls. */
function fakeDocument({ execResult = true, execThrows = false, activeElement = null } = {}) {
  const calls = { created: 0, appended: 0, selected: 0, removed: 0, copies: [] };
  const textarea = {
    value: "",
    style: {},
    select() { calls.selected++; },
    remove() { calls.removed++; },
  };
  const document = {
    activeElement,
    createElement(tag) {
      calls.created++;
      assert.equal(tag, "textarea");
      return textarea;
    },
    body: {
      appendChild(el) {
        calls.appended++;
        assert.equal(el, textarea);
      },
    },
    execCommand(cmd) {
      calls.copies.push({ cmd, value: textarea.value });
      if (execThrows) throw new Error("execCommand blew up");
      return execResult;
    },
  };
  return { document, textarea, calls };
}

test("copyText uses navigator.clipboard.writeText when available", async () => {
  const doc = fakeDocument();
  const written = [];
  await withGlobal("navigator", {
    clipboard: { writeText: async (t) => written.push(t) },
  }, () => copyText("hello"));
  assert.deepEqual(written, ["hello"]);
  assert.equal(doc.calls.created, 0, "DOM fallback must not run when writeText works");
});

test("copyText falls back to execCommand when writeText rejects", async () => {
  const doc = fakeDocument();
  await withClipboardEnv({
    clipboard: { writeText: async () => { throw new Error("permission denied"); } },
  }, doc, async () => {
    assert.equal(await copyText("hello"), true);
  });
  assert.equal(doc.calls.created, 1);
  assert.equal(doc.calls.selected, 1);
  assert.equal(doc.calls.removed, 1, "textarea must be cleaned up after the copy");
  assert.deepEqual(doc.calls.copies, [{ cmd: "copy", value: "hello" }]);
});

test("copyText falls back to execCommand when navigator.clipboard is missing", async () => {
  const doc = fakeDocument();
  await withClipboardEnv({}, doc, async () => {
    assert.equal(await copyText("hello"), true);
  });
  assert.equal(doc.calls.created, 1);
  assert.deepEqual(doc.calls.copies, [{ cmd: "copy", value: "hello" }]);
});

test("copyText falls back to execCommand when navigator is entirely absent", async () => {
  const doc = fakeDocument();
  await withClipboardEnv(undefined, doc, async () => {
    assert.equal(await copyText("hello"), true);
  });
  assert.equal(doc.calls.created, 1);
  assert.deepEqual(doc.calls.copies, [{ cmd: "copy", value: "hello" }]);
});

test("copyText returns false when execCommand reports failure", async () => {
  const doc = fakeDocument({ execResult: false });
  await withClipboardEnv({}, doc, async () => {
    assert.equal(await copyText("hello"), false);
  });
});

test("copyText returns false, not a throw, when execCommand throws", async () => {
  const doc = fakeDocument({ execThrows: true });
  await withClipboardEnv({}, doc, async () => {
    assert.equal(await copyText("hello"), false);
  });
  assert.equal(doc.calls.removed, 1, "textarea must be removed even when the copy throws");
});

test("copyText restores focus to the previously focused element", async () => {
  let focusCalls = 0;
  const focused = { isConnected: true, focus() { focusCalls++; } };
  const doc = fakeDocument({ activeElement: focused });
  await withClipboardEnv({}, doc, async () => {
    assert.equal(await copyText("hello"), true);
  });
  assert.equal(focusCalls, 1, "focus must return to the previously focused element");
});

test("copyText restores focus even when the copy throws", async () => {
  let focusCalls = 0;
  const focused = { isConnected: true, focus() { focusCalls++; } };
  const doc = fakeDocument({ execThrows: true, activeElement: focused });
  await withClipboardEnv({}, doc, async () => {
    assert.equal(await copyText("hello"), false);
  });
  assert.equal(focusCalls, 1, "focus restore must not be skipped on a failed copy");
});

test("copyText skips focus restore when the element left the document", async () => {
  let focusCalls = 0;
  const doc = fakeDocument({ activeElement: { isConnected: false, focus() { focusCalls++; } } });
  await withClipboardEnv({}, doc, async () => {
    assert.equal(await copyText("hello"), true);
  });
  assert.equal(focusCalls, 0, "a detached element must not be focused");
});

test("copyText returns false when no DOM is available at all", async () => {
  await withGlobal("navigator", {}, async () => {
    assert.equal(await copyText("hello"), false);
  });
});
