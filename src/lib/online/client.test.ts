import { describe, expect, it } from "vitest";
import { createOnlineClient, type OnlineClient } from "./client";
import { FakeBackend } from "./fake-backend";
import { viewRoom } from "./view";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

function setup() {
  const backend = new FakeBackend();
  const mk = (id: string, storage = memoryStorage()) => createOnlineClient(backend.transportFor(id), storage);
  return { backend, mk };
}

async function startedMatch(mode: "classic" | "modern" = "classic") {
  const { backend, mk } = setup();
  const host = mk("u-host");
  const guest = mk("u-guest");
  await host.createRoom("Ann", mode);
  const code = host.getState().room!.code;
  await guest.joinRoom(code, "Ben");
  await flush();
  return { backend, mk, host, guest, code };
}

/** Whoever's turn it is plays the next cell, through the real client path. */
async function playCells(host: OnlineClient, guest: OnlineClient, cells: number[]) {
  for (const c of cells) {
    const room = host.getState().room!;
    const hostToMove = viewRoom(room, host.getState().userId)!.myTurn;
    expect(await (hostToMove ? host : guest).playMove(c)).toBe(true);
    await flush();
  }
}

describe("online client: rooms", () => {
  it("creating a room gives a code and a waiting room; joining starts the match for both", async () => {
    const { host, guest, code } = await startedMatch();
    expect(code).toHaveLength(5);
    expect(host.getState().room?.status).toBe("playing");
    expect(guest.getState().room?.status).toBe("playing");
    const hv = viewRoom(host.getState().room!, host.getState().userId)!;
    const gv = viewRoom(guest.getState().room!, guest.getState().userId)!;
    expect([hv.myName, hv.oppName, hv.mySymbol]).toEqual(["Ann", "Ben", "X"]);
    expect([gv.myName, gv.oppName, gv.mySymbol]).toEqual(["Ben", "Ann", "O"]);
  });

  it("the host sees a waiting room until someone joins", async () => {
    const { mk } = setup();
    const host = mk("u-host");
    await host.createRoom("Ann", "modern");
    expect(host.getState().room?.status).toBe("waiting");
    expect(host.getState().room?.mode).toBe("modern");
  });

  it("joining shows helpful errors", async () => {
    const { host, mk, code } = await startedMatch();
    expect(host.getState().error).toBeNull();
    const c = mk("u-c");
    expect(await c.joinRoom("ZZZ", "Eve")).toBe(false);
    expect(c.getState().error).toContain("5 letters and numbers");
    expect(await c.joinRoom("QQQQQ", "Eve")).toBe(false);
    expect(c.getState().error).toContain("No room found");
    expect(await c.joinRoom(code, "Eve")).toBe(false);
    expect(c.getState().error).toContain("two players");
    expect(c.getState().room).toBeNull();
  });
});

describe("online client: synchronized play", () => {
  it("moves appear on both devices and turns are enforced", async () => {
    const { host, guest, backend } = await startedMatch();
    expect(await guest.playMove(0)).toBe(false); // guest is not on turn
    expect(guest.getState().error).toContain("not your turn");

    expect(await host.playMove(4)).toBe(true);
    await flush();
    expect(guest.getState().room?.game.board[4]).toBe("X");
    expect(host.getState().room?.game.board[4]).toBe("X");

    expect(await host.playMove(0)).toBe(false); // host just moved
    expect(await guest.playMove(4)).toBe(false); // occupied
    expect(guest.getState().error).toContain("isn't available");
    expect(backend.rejected).toBe(0); // blocked locally, never reached the server

    expect(await guest.playMove(0)).toBe(true);
    await flush();
    expect(host.getState().room?.game.board[0]).toBe("O");
  });

  it("the backend rejects a tampered client that skips the local checks", async () => {
    const { backend, code } = await startedMatch();
    const guestRaw = backend.transportFor("u-guest");
    const early = await guestRaw.call({ action: "move", code, index: 0 });
    expect(early).toEqual({ ok: false, error: "not_your_turn" });
    const stranger = backend.transportFor("u-evil");
    expect(await stranger.call({ action: "move", code, index: 0 })).toEqual({ ok: false, error: "not_member" });
    expect(await stranger.call({ action: "leave", code })).toEqual({ ok: false, error: "not_member" });
    expect(await stranger.fetchRoom(code)).toBeNull(); // RLS: not readable by outsiders
    expect(backend.rooms.get(code)?.status).toBe("playing");
  });

  it("classic win is shown to both players and scores update", async () => {
    const { host, guest } = await startedMatch();
    await playCells(host, guest, [0, 3, 1, 4, 2]);
    for (const c of [host, guest]) {
      const room = c.getState().room!;
      expect(room.status).toBe("finished");
      expect(room.game.winner).toBe("X");
      expect(room.scores).toEqual({ host: 1, guest: 0, draws: 0 });
    }
    expect(await guest.playMove(8)).toBe(false);
  });

  it("classic draw is shown to both players", async () => {
    const { host, guest } = await startedMatch();
    await playCells(host, guest, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    for (const c of [host, guest]) {
      expect(c.getState().room?.status).toBe("finished");
      expect(c.getState().room?.game.status).toBe("draw");
      expect(c.getState().room?.scores.draws).toBe(1);
    }
  });

  it("modern: the fourth mark vanishes on both devices", async () => {
    const { host, guest } = await startedMatch("modern");
    await playCells(host, guest, [0, 1, 3, 2, 8, 7, 4]);
    for (const c of [host, guest]) {
      const g = c.getState().room!.game;
      expect(g.board[0]).toBeNull();
      expect(g.marks.X).toEqual([3, 8, 4]);
      expect(g.marks.O).toEqual([1, 2, 7]);
    }
  });

  it("play again needs both players, then swaps symbols and clears the board", async () => {
    const { host, guest } = await startedMatch();
    await playCells(host, guest, [0, 3, 1, 4, 2]);
    expect(await host.requestRematch()).toBe(true);
    await flush();
    expect(guest.getState().room?.status).toBe("finished");
    expect(viewRoom(guest.getState().room!, guest.getState().userId)!.oppReady).toBe(true);

    expect(await guest.requestRematch()).toBe(true);
    await flush();
    for (const c of [host, guest]) {
      const room = c.getState().room!;
      expect(room.status).toBe("playing");
      expect(room.round).toBe(2);
      expect(room.game.board.every((x) => x === null)).toBe(true);
      expect(room.scores.host).toBe(1);
    }
    // Guest is now X and moves first.
    expect(viewRoom(guest.getState().room!, guest.getState().userId)!.mySymbol).toBe("X");
    expect(await guest.playMove(4)).toBe(true);
  });
});

describe("online client: connection handling", () => {
  it("shows when the opponent disconnects and when they come back", async () => {
    const { host, guest } = await startedMatch();
    const guestId = guest.getState().userId!;
    expect(host.getState().presence).toContain(guestId);
    guest.disconnect();
    await flush();
    expect(host.getState().presence).not.toContain(guestId);
    await guest.resume();
    await flush();
    expect(host.getState().presence).toContain(guestId);
  });

  it("a player leaving closes the room for the other player", async () => {
    const { host, guest } = await startedMatch();
    await guest.leave();
    await flush();
    expect(guest.getState().room).toBeNull();
    const room = host.getState().room!;
    expect(room.status).toBe("abandoned");
    expect(room.left_by).toBe("guest");
    expect(await host.playMove(4)).toBe(false);
  });

  it("refreshing the page rejoins the same room", async () => {
    const { backend } = setup();
    const storage = memoryStorage();
    const first = createOnlineClient(backend.transportFor("u-host"), storage);
    await first.createRoom("Ann", "classic");
    const code = first.getState().room!.code;
    first.disconnect();

    const reloaded = createOnlineClient(backend.transportFor("u-host"), storage);
    await reloaded.resume();
    expect(reloaded.getState().room?.code).toBe(code);
  });

  it("ignores stale realtime rows and applies newer ones", async () => {
    const { backend, mk, code } = await startedMatch();
    // A guest whose realtime handlers we can drive by hand.
    const real = backend.transportFor("u-guest");
    let handlers!: Parameters<typeof real.watch>[2];
    const spy = { ...real, watch: (c: string, u: string, h: typeof handlers) => ((handlers = h), real.watch(c, u, h)) };
    const guest = createOnlineClient(spy, memoryStorage());
    await guest.joinRoom(code, "Ben");
    await flush();
    const current = guest.getState().room!;

    const stale = { ...current, version: current.version - 1, status: "abandoned" as const };
    handlers.onRow(stale);
    expect(guest.getState().room?.status).toBe("playing");
    expect(guest.getState().room?.version).toBe(current.version);

    handlers.onRow({ ...current, version: current.version + 1, round: 7 });
    expect(guest.getState().room?.round).toBe(7);
    void mk;
  });
});
