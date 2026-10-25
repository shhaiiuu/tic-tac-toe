import { describe, expect, it } from "vitest";
import { createOnlineClient } from "./client";
import { FakeBackend } from "./fake-backend";
import { TransportError } from "./messages";
import type { RoomAction, Transport } from "./transport";
import { viewRoom } from "./view";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const memoryStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

/** A transport whose `move` requests are held until released, so "in flight" can be observed. */
function gated(real: Transport, behaviour: { onMove?: "ok" | "reject" | "lose-response" } = {}) {
  const moves: RoomAction[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const transport: Transport = {
    ...real,
    call: async (a) => {
      if (a.action !== "move") return real.call(a);
      moves.push(a);
      await gate;
      if (behaviour.onMove === "reject") return { ok: false, error: "invalid_move" };
      if (behaviour.onMove === "lose-response") {
        await real.call(a); // the server DID apply it, but the reply never arrives
        throw new TransportError("network");
      }
      return real.call(a);
    },
  };
  return { transport, moves, release: () => release() };
}

async function match(mode: "classic" | "modern" = "classic", behaviour: Parameters<typeof gated>[1] = {}) {
  const backend = new FakeBackend();
  const g = gated(backend.transportFor("u-host"), behaviour);
  const host = createOnlineClient(g.transport, memoryStorage());
  const guest = createOnlineClient(backend.transportFor("u-guest"), memoryStorage());
  await host.createRoom("Ann", mode);
  await guest.joinRoom(host.getState().room!.code, "Ben");
  await flush();
  return { backend, host, guest, ...g };
}

describe("optimistic moves", () => {
  it("shows the mover's mark immediately, before the server has answered", async () => {
    const { host, guest, release, moves } = await match();
    const pending = host.playMove(4); // NOT awaited
    const room = host.getState().room!;
    expect(room.game.board[4]).toBe("X"); // visible right away
    expect(room.game.current).toBe("O"); // turn already passed
    expect(host.getState().busy).toBe(true);
    expect(moves).toHaveLength(1);
    expect(guest.getState().room?.game.board[4]).toBeNull(); // opponent only sees confirmed moves

    release();
    expect(await pending).toBe(true);
    await flush();
    expect(host.getState().busy).toBe(false);
    expect(host.getState().room?.game.board[4]).toBe("X");
    expect(host.getState().room?.version).toBe(guest.getState().room?.version); // now the server's version
    expect(guest.getState().room?.game.board[4]).toBe("X");
  });

  it("blocks duplicate clicks and conflicting moves while one is pending", async () => {
    const { host, release, moves } = await match();
    const first = host.playMove(4);
    expect(await host.playMove(4)).toBe(false); // same cell again
    expect(await host.playMove(0)).toBe(false); // a different cell
    expect(moves).toHaveLength(1); // only one request was ever sent
    release();
    await first;
    expect(host.getState().room?.game.history).toHaveLength(1);
  });

  it("rolls back and explains when the server rejects the move", async () => {
    const { host, backend, release } = await match("classic", { onMove: "reject" });
    const pending = host.playMove(4);
    expect(host.getState().room?.game.board[4]).toBe("X");
    release();
    expect(await pending).toBe(false);
    await flush();
    const room = host.getState().room!;
    expect(room.game.board[4]).toBeNull(); // restored
    expect(room.game.current).toBe("X"); // still my turn
    expect(host.getState().busy).toBe(false);
    expect(host.getState().error).toContain("isn't available");
    expect(backend.rooms.get(room.code)?.game.history).toHaveLength(0);
    expect(await host.playMove(4)).toBe(false); // gate already open; second try is allowed again
  });

  it("if the reply is lost, rolls back then re-syncs to what the server really did", async () => {
    const { host, release } = await match("classic", { onMove: "lose-response" });
    const pending = host.playMove(4);
    release();
    expect(await pending).toBe(false);
    await flush();
    expect(host.getState().busy).toBe(false);
    expect(host.getState().error).toContain("Couldn't reach");
    expect(host.getState().room?.game.board[4]).toBe("X"); // server applied it; refetch shows the truth
  });

  it("shows a winning move (and the result) immediately", async () => {
    const { host, guest, release } = await match();
    release();
    for (const [who, cell] of [[host, 0], [guest, 3], [host, 1], [guest, 4]] as const) {
      expect(await who.playMove(cell)).toBe(true);
      await flush();
    }
    const winning = host.playMove(2);
    const room = host.getState().room!;
    expect(room.status).toBe("finished");
    expect(room.game.winner).toBe("X");
    expect(room.scores.host).toBe(1);
    await winning;
    expect(viewRoom(host.getState().room!, host.getState().userId)!.myTurn).toBe(false);
  });

  it("never overwrites a newer server row with its own rollback", async () => {
    const backend = new FakeBackend();
    const real = backend.transportFor("u-host");
    let push!: Parameters<Transport["watch"]>[2]["onRow"];
    const g = gated({ ...real, watch: (c, u, h) => ((push = h.onRow), real.watch(c, u, h)) }, { onMove: "reject" });
    const host = createOnlineClient(g.transport, memoryStorage());
    const guest = createOnlineClient(backend.transportFor("u-guest"), memoryStorage());
    await host.createRoom("Ann", "classic");
    await guest.joinRoom(host.getState().room!.code, "Ben");
    await flush();

    const base = host.getState().room!;
    const pending = host.playMove(4);
    push({ ...base, version: base.version + 1, round: 9 }); // a newer confirmed room arrives meanwhile
    g.release();
    expect(await pending).toBe(false);
    await flush();
    expect(host.getState().room?.round).toBe(9); // the newer row survived the rollback
  });
});
