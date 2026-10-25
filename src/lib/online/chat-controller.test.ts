import { describe, expect, it, vi } from "vitest";
import type { ChatHandlers, ChatTransport } from "./chat";
import { createChatController } from "./chat-controller";
import { FakeChatBackend } from "./fake-chat-backend";

const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

const ROOM = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM = "22222222-2222-4222-8222-222222222222";

function setup() {
  const backend = new FakeChatBackend();
  backend.addRoom(ROOM, { ann: "Ann", ben: "Ben" });
  backend.addRoom(OTHER_ROOM, { cat: "Cat", dan: "Dan" });
  let ids = 0;
  let clock = 0;
  const make = (userId: string, roomId = ROOM, myName = "whatever-the-client-says", transport: ChatTransport = backend.transportFor(userId)) =>
    createChatController({ transport, roomId, userId, myName, newId: () => `${userId}-${++ids}`, now: () => clock });
  return { backend, make, advance: (ms: number) => (clock += ms) };
}

describe("exchanging messages", () => {
  it("both players see the same conversation in near real time, scoped to the room", async () => {
    const { make, backend } = setup();
    const ann = make("ann");
    const ben = make("ben");
    const cat = make("cat", OTHER_ROOM);
    await tick();
    expect(ann.getState().status).toBe("ready");

    expect(await ann.send("hello Ben")).toBe(true);
    await tick();
    expect(await ben.send("hi Ann 👋")).toBe(true);
    await tick();

    for (const c of [ann, ben]) expect(c.getState().messages.map((m) => m.content)).toEqual(["hello Ben", "hi Ann 👋"]);
    expect(cat.getState().messages).toHaveLength(0); // other room never sees it
    expect(backend.messages).toHaveLength(2);
  });

  it("loads the existing history for someone who opens the chat later", async () => {
    const { make } = setup();
    const ann = make("ann");
    await tick();
    await ann.send("one");
    await ann.send("two");
    await tick();
    const ben = make("ben");
    await tick();
    expect(ben.getState().messages.map((m) => m.content)).toEqual(["one", "two"]);
    expect(ben.getState().unread).toBe(0); // history is not "new"
  });

  it("shows my message immediately, then confirms it without duplicating", async () => {
    for (const echoFirst of [false, true]) {
      const { make, backend } = setup();
      backend.echoBeforeReply = echoFirst;
      const ann = make("ann");
      await tick();
      const pending = ann.send("hey");
      expect(ann.getState().messages).toHaveLength(1); // visible before the server replied
      if (!echoFirst) {
        expect(ann.getState().messages[0]?.state).toBe("sending");
        expect(ann.getState().sending).toBe(true);
      }
      await pending;
      await tick();
      expect(ann.getState().messages).toHaveLength(1); // optimistic copy + realtime copy = ONE message
      expect(ann.getState().messages[0]?.state).toBe("sent");
      expect(ann.getState().sending).toBe(false);
    }
  });

  it("takes sender name from the server, not from the client", async () => {
    const { make } = setup();
    const ann = make("ann", ROOM, "Definitely The Admin");
    const ben = make("ben");
    await tick();
    await ann.send("hi");
    await tick();
    expect(ann.getState().messages[0]?.senderName).toBe("Ann");
    expect(ben.getState().messages[0]?.senderName).toBe("Ann");
    expect(ben.getState().messages[0]?.senderId).toBe("ann");
  });
});

describe("validation and errors", () => {
  it("rejects empty, whitespace-only and over-long messages without sending anything", async () => {
    const { make, backend } = setup();
    const ann = make("ann");
    await tick();
    for (const bad of ["", "   ", "\n\t", "x".repeat(501)]) {
      expect(await ann.send(bad)).toBe(false);
      expect(ann.getState().error).toBeTruthy();
    }
    expect(backend.messages).toHaveLength(0);
    expect(ann.getState().messages).toHaveLength(0);
    expect(await ann.send("x".repeat(500))).toBe(true);
  });

  it("a network failure marks the message as failed; retry sends it exactly once", async () => {
    const { make, backend } = setup();
    const ann = make("ann");
    const ben = make("ben");
    await tick();
    backend.failNext = "network";
    expect(await ann.send("are you there?")).toBe(false);
    expect(ann.getState().messages[0]?.state).toBe("failed");
    expect(ann.getState().error).toContain("Couldn't reach");
    expect(ben.getState().messages).toHaveLength(0);

    const id = ann.getState().messages[0]!.id;
    expect(await ann.retry(id)).toBe(true);
    await tick();
    expect(ann.getState().messages).toHaveLength(1);
    expect(ann.getState().messages[0]?.state).toBe("sent");
    expect(backend.messages).toHaveLength(1);
    expect(ben.getState().messages.map((m) => m.content)).toEqual(["are you there?"]);
  });

  it("history load errors are shown and can be retried", async () => {
    const { make, backend } = setup();
    backend.failNext = "network";
    const ann = make("ann");
    await tick();
    expect(ann.getState().status).toBe("error");
    await ann.reload();
    expect(ann.getState().status).toBe("ready");
  });

  it("flooding is stopped by the rate limit", async () => {
    const { make } = setup();
    const ann = make("ann");
    await tick();
    const results: boolean[] = [];
    for (let i = 0; i < 9; i++) results.push(await ann.send(`m${i}`));
    expect(results.filter(Boolean)).toHaveLength(8);
    expect(ann.getState().error).toContain("too fast");
  });

  it("a closed room refuses new messages", async () => {
    const { make, backend } = setup();
    const ann = make("ann");
    await tick();
    backend.closedRooms.add(ROOM);
    expect(await ann.send("anyone?")).toBe(false);
    expect(ann.getState().error).toContain("closed");
  });
});

describe("unread badge", () => {
  it("counts opponent messages while closed, ignores my own and open-time messages, resets on open", async () => {
    const { make } = setup();
    const ann = make("ann");
    const ben = make("ben");
    await tick();
    await ben.send("1");
    await ben.send("2");
    await tick();
    expect(ann.getState().unread).toBe(2);
    await ann.send("mine");
    await tick();
    expect(ann.getState().unread).toBe(2);

    ann.setOpen(true);
    expect(ann.getState().unread).toBe(0);
    await ben.send("3");
    await tick();
    expect(ann.getState().unread).toBe(0); // reading it live

    ann.setOpen(false);
    await ben.send("4");
    await tick();
    expect(ann.getState().unread).toBe(1);
  });
});

describe("typing indicator", () => {
  it("expires a stale indicator on its own (opponent vanished without saying they stopped)", async () => {
    vi.useFakeTimers();
    const { backend } = setup();
    let handlers!: ChatHandlers;
    const real = backend.transportFor("ann");
    const ann = createChatController({ transport: { ...real, subscribe: (r, h) => ((handlers = h), real.subscribe(r, h)) }, roomId: ROOM, userId: "ann", myName: "Ann" });
    await tick();
    handlers.onTyping(true);
    expect(ann.getState().opponentTyping).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(ann.getState().opponentTyping).toBe(true);
    vi.advanceTimersByTime(600); // more than 3.5s with no new signal
    expect(ann.getState().opponentTyping).toBe(false);
    vi.useRealTimers();
  });

  it("shows for the opponent only, and clears the moment their message arrives", async () => {
    vi.useFakeTimers();
    const { make } = setup();
    const ann = make("ann");
    const ben = make("ben");
    await tick();
    ben.notifyTyping();
    expect(ann.getState().opponentTyping).toBe(true);
    expect(ben.getState().opponentTyping).toBe(false); // never my own
    await ben.send("done typing");
    await tick();
    expect(ann.getState().opponentTyping).toBe(false);
    vi.useRealTimers();
  });

  it("tells the opponent when I go idle, and throttles the signal while I keep typing", async () => {
    vi.useFakeTimers();
    const { backend, advance } = setup();
    const sent: boolean[] = [];
    const real = backend.transportFor("ben");
    const spy: ChatTransport = { ...real, subscribe: (r, h) => { const s = real.subscribe(r, h); return { ...s, sendTyping: (t) => (sent.push(t), s.sendTyping(t)) }; } };
    const ann = createChatController({ transport: backend.transportFor("ann"), roomId: ROOM, userId: "ann", myName: "Ann", now: () => 0 });
    let clock = 0;
    const ben = createChatController({ transport: spy, roomId: ROOM, userId: "ben", myName: "Ben", now: () => clock });
    await tick();
    for (let i = 0; i < 6; i++) { ben.notifyTyping(); clock += 300; advance(300); }
    expect(sent).toEqual([true]); // 6 keystrokes within 2s -> one signal
    clock += 2500;
    vi.advanceTimersByTime(2600);
    expect(sent).toEqual([true, false]); // idle -> "stopped"
    expect(ann.getState().opponentTyping).toBe(false);
    vi.useRealTimers();
  });

  it("is not stored as chat history", async () => {
    const { make, backend } = setup();
    const ben = make("ben");
    make("ann");
    await tick();
    ben.notifyTyping();
    expect(backend.messages).toHaveLength(0);
  });
});

describe("room isolation, access control and cleanup", () => {
  it("a player outside the room can't read, send, or receive anything", async () => {
    const { make, backend } = setup();
    const ann = make("ann");
    const eve = make("cat", ROOM); // member of a DIFFERENT room, trying to use this one
    await tick();
    expect(eve.getState().status).toBe("error"); // history read denied
    await ann.send("secret plan");
    ann.notifyTyping();
    await tick();
    expect(eve.getState().messages).toHaveLength(0);
    expect(eve.getState().opponentTyping).toBe(false);
    expect(await eve.send("let me in")).toBe(false);
    expect(eve.getState().messages[0]?.state).toBe("failed");
    expect(backend.messages.map((m) => m.content)).toEqual(["secret plan"]);
  });

  it("ignores messages for another room even if the transport delivers them", async () => {
    const { backend } = setup();
    let handlers!: ChatHandlers;
    const real = backend.transportFor("ann");
    const ann = createChatController({ transport: { ...real, subscribe: (r, h) => ((handlers = h), real.subscribe(r, h)) }, roomId: ROOM, userId: "ann", myName: "Ann" });
    await tick();
    handlers.onMessage({ id: "x", roomId: OTHER_ROOM, senderId: "dan", senderName: "Dan", content: "wrong room", createdAt: new Date().toISOString(), state: "sent" });
    expect(ann.getState().messages).toHaveLength(0);
  });

  it("dispose closes the subscription and ignores late events (no leak into the next room)", async () => {
    const { backend } = setup();
    let handlers!: ChatHandlers;
    const real = backend.transportFor("ann");
    const a1 = createChatController({ transport: { ...real, subscribe: (r, h) => ((handlers = h), real.subscribe(r, h)) }, roomId: ROOM, userId: "ann", myName: "Ann" });
    await tick();
    expect(backend.subscriberCount).toBe(1);
    a1.dispose();
    expect(backend.subscriberCount).toBe(0);
    handlers.onMessage({ id: "late", roomId: ROOM, senderId: "ben", senderName: "Ben", content: "late", createdAt: new Date().toISOString(), state: "sent" });
    handlers.onTyping(true);
    expect(a1.getState().messages).toHaveLength(0);
    expect(a1.getState().opponentTyping).toBe(false);

    const a2 = createChatController({ transport: backend.transportFor("cat"), roomId: OTHER_ROOM, userId: "cat", myName: "Cat" }); // new room, fresh state
    await tick();
    expect(a2.getState().messages).toHaveLength(0);
    a2.dispose();
    a2.dispose(); // idempotent
    expect(backend.subscriberCount).toBe(0);
  });
});

describe("connection loss", () => {
  it("shows reconnecting, then catches up on messages missed while offline", async () => {
    const { make, backend } = setup();
    const ann = make("ann");
    const ben = make("ben");
    await tick();
    backend.dropConnection("ann", ROOM);
    expect(ann.getState().status).toBe("reconnecting");
    // while Ann is offline, Ben's message is stored but her live channel doesn't deliver it
    const real = backend.transportFor("ben");
    await real.send(ROOM, "missed-1", "while you were away");
    await ben.send("also this");
    await tick();
    backend.restoreConnection("ann", ROOM);
    await tick();
    expect(ann.getState().status).toBe("ready");
    expect(ann.getState().messages.map((m) => m.content)).toContain("while you were away");
    expect(new Set(ann.getState().messages.map((m) => m.id)).size).toBe(ann.getState().messages.length); // no duplicates
  });
});
