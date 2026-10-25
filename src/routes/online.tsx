import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy, Grid3x3, Home, Hourglass, Link2, LogIn, Plus, RotateCcw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { BoardGrid, PlayerCard, pillTone, ResultCard, StatusPill } from "@/components/game/board";
import { ExitConfirmationModal } from "@/components/game/exit-confirmation-modal";
import { ExpandCard, GameButton, ModeOption, Shell } from "@/components/game/ui";
import { cleanName, loadPrefs, MODE_INFO } from "@/lib/game/config";
import { oldestMarkToVanish } from "@/lib/game/engine";
import type { GameMode } from "@/lib/game/types";
import { copyText } from "@/lib/online/clipboard";
import { useOnline } from "@/lib/online/hooks";
import { isOnlineConfigured } from "@/lib/online/supabase";
import type { RoomRow } from "@/lib/online/transport";
import { describeOnlineResult, viewRoom, type RoomView } from "@/lib/online/view";

export const Route = createFileRoute("/online")({
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search["code"] === "string" ? { code: search["code"] } : {},
  head: () => ({
    meta: [
      { title: "Play Online — Tic Tac Toe" },
      { name: "description", content: "Create or join a room and play Tic Tac Toe with a friend on another device." },
      { property: "og:title", content: "Play Online — Tic Tac Toe" },
      { property: "og:description", content: "Create or join a room and play with a friend on another device." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Online,
});

const NAME_KEY = "tic-tac-toe:online:name";
const RESULT_DELAY_MS = 450;
const sectionLabel = "text-xs font-semibold uppercase tracking-widest text-muted-foreground";
const fieldClass =
  "h-12 w-full rounded-2xl border bg-card px-4 text-base shadow-soft placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Online() {
  const { state, client } = useOnline();
  const { code: inviteCode } = Route.useSearch();
  const navigate = useNavigate();
  const configured = isOnlineConfigured();
  const room = state.room;

  // Re-attach to the room we were in (or rejoin after a refresh); stop listening when we leave the screen.
  useEffect(() => {
    if (!configured) return;
    void client.resume();
    return () => client.disconnect();
  }, [client, configured]);

  const leaveToMenu = () => {
    void client.leave();
    navigate({ to: "/" });
  };

  if (!configured) return <SetupNeeded />;
  if (!room) return <Lobby inviteCode={inviteCode} />;
  if (room.status === "waiting") return <Waiting room={room} onCancel={() => void client.leave()} />;

  const v = viewRoom(room, state.userId);
  if (!v) return <Lobby inviteCode={inviteCode} />;
  if (room.status === "abandoned") return <Closed room={room} v={v} onMenu={leaveToMenu} onNew={() => void client.leave()} />;
  return <OnlineGame room={room} v={v} onMenu={leaveToMenu} />;
}

/* ------------------------------ Not configured ------------------------------ */

function SetupNeeded() {
  const steps = [
    "Create a Supabase project (or enable Lovable Cloud) and copy its URL and publishable (anon) key.",
    "Run supabase/migrations/20261025000000_online_rooms.sql in the SQL editor (creates the rooms table, security policies and Realtime).",
    "Enable Authentication → Providers → Anonymous sign-ins.",
    "Deploy the game server: supabase functions deploy rooms",
    "Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart the dev server.",
  ];
  return (
    <Shell>
      <Header title="Play Online" />
      <div className="mt-8 rounded-3xl bg-card border shadow-soft p-6" role="alert">
        <div className="size-12 grid place-items-center rounded-2xl bg-coral-soft text-coral"><WifiOff className="size-6" /></div>
        <h2 className="mt-4 font-display text-xl font-semibold">Online play isn't set up yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">It needs a Supabase backend. To switch it on:</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">Full details are in supabase/README.md.</p>
      </div>
      <div className="mt-6"><GameButton to="/" variant="soft" className="w-full"><ArrowLeft className="size-4" /> Back</GameButton></div>
    </Shell>
  );
}

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  const back = "size-11 grid place-items-center rounded-2xl bg-card border shadow-soft text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex items-center justify-between">
      {onBack ? (
        <button type="button" aria-label="Back" onClick={onBack} className={back}><ArrowLeft className="size-5" /></button>
      ) : (
        <Link to="/" aria-label="Back to menu" className={back}><ArrowLeft className="size-5" /></Link>
      )}
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      <div className="size-11" />
    </div>
  );
}

/* ------------------------------- Create / Join ------------------------------ */

function Lobby({ inviteCode }: { inviteCode: string | undefined }) {
  const { state, client } = useOnline();
  const [name, setName] = useState("");
  const [open, setOpen] = useState<"create" | "join" | null>(inviteCode ? "join" : null);
  const [mode, setMode] = useState<GameMode>("classic");
  const [code, setCode] = useState(() => cleanCode(inviteCode ?? ""));

  useEffect(() => {
    try {
      setName(window.localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      // ignore
    }
    setMode(loadPrefs().mode);
  }, []);

  const rememberName = () => {
    try {
      window.localStorage.setItem(NAME_KEY, name);
    } catch {
      // ignore
    }
    return cleanName(name, "Player");
  };
  const toggle = (which: "create" | "join") => {
    client.clearError();
    setOpen(open === which ? null : which);
  };
  const join = () => void client.joinRoom(code, rememberName());

  return (
    <Shell>
      <Header title="Play Online" />
      <p className="mt-6 text-center text-muted-foreground">Play a friend on another device. Create a room and share the code, or join theirs.</p>

      <label className="mt-8 block">
        <span className={`${sectionLabel} mb-2 block`}>Your name</span>
        <input className={fieldClass} value={name} maxLength={16} placeholder="Player" onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="mt-6 space-y-3">
        <ExpandCard
          id="create"
          open={open === "create"}
          onToggle={() => toggle("create")}
          icon={<Plus className="size-6" />}
          title="Create Room"
          desc="Get a code to share"
          tone="bg-primary-soft text-primary"
        >
          <div className="space-y-4">
            <div>
              <p className={`${sectionLabel} mb-2`}>Game mode</p>
              <div role="radiogroup" aria-label="Game mode" className="grid grid-cols-2 gap-3">
                {(["classic", "modern"] as const).map((m) => (
                  <ModeOption
                    key={m}
                    selected={mode === m}
                    onSelect={() => setMode(m)}
                    icon={m === "classic" ? <Grid3x3 className="size-5" /> : <Hourglass className="size-5" />}
                    title={MODE_INFO[m].title}
                    desc={MODE_INFO[m].short}
                  />
                ))}
              </div>
            </div>
            <GameButton onClick={() => void client.createRoom(rememberName(), mode)} disabled={state.busy} className="w-full">
              {state.busy ? "Creating…" : "Create room"}
            </GameButton>
          </div>
        </ExpandCard>

        <ExpandCard
          id="join"
          open={open === "join"}
          onToggle={() => toggle("join")}
          icon={<LogIn className="size-6" />}
          title="Join Room"
          desc="Enter a friend's code"
          tone="bg-coral-soft text-coral"
        >
          <div className="space-y-4">
            <label className="block">
              <span className={`${sectionLabel} mb-2 block`}>Room code</span>
              <input
                className={`${fieldClass} text-center font-display text-2xl font-semibold uppercase tracking-[0.3em]`}
                value={code}
                maxLength={5}
                placeholder="ABCDE"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  client.clearError();
                  setCode(cleanCode(e.target.value));
                }}
                onKeyDown={(e) => e.key === "Enter" && !state.busy && join()}
              />
            </label>
            <GameButton onClick={join} disabled={state.busy || code.length === 0} variant="coral" className="w-full">
              {state.busy ? "Joining…" : "Join room"}
            </GameButton>
          </div>
        </ExpandCard>
      </div>

      {state.error && (
        <p role="alert" className="mt-4 rounded-2xl bg-coral-soft px-4 py-3 text-sm font-medium text-coral">{state.error}</p>
      )}

      <div className="mt-6"><GameButton to="/" variant="soft" className="w-full"><ArrowLeft className="size-4" /> Back</GameButton></div>
    </Shell>
  );
}

const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

/* --------------------------------- Waiting --------------------------------- */

function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  return {
    copied,
    copy: async (key: string, text: string) => setCopied((await copyText(text)) ? key : "failed"),
  };
}

function Waiting({ room, onCancel }: { room: RoomRow; onCancel: () => void }) {
  const { copied, copy } = useCopied();
  const invite = typeof window === "undefined" ? "" : `${window.location.origin}/online?code=${room.code}`;
  return (
    <Shell>
      <Header title="Your room" onBack={onCancel} />
      <div className="mt-8 rounded-[2rem] bg-card border shadow-lift p-8 text-center">
        <p className={sectionLabel}>Room code</p>
        <div
          className="mt-3 rounded-3xl bg-primary-soft py-5 font-display text-5xl font-bold tracking-[0.3em] text-primary"
          aria-label={`Room code ${room.code.split("").join(" ")}`}
        >
          {room.code}
        </div>
        <p className="mt-6 animate-pulse text-muted-foreground" role="status" aria-live="polite">Waiting for a friend to join…</p>
        <div className="mt-6 grid gap-3">
          <GameButton onClick={() => void copy("code", room.code)}>
            {copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />} {copied === "code" ? "Copied!" : "Copy code"}
          </GameButton>
          <GameButton variant="soft" onClick={() => void copy("link", invite)}>
            {copied === "link" ? <Check className="size-4" /> : <Link2 className="size-4" />} {copied === "link" ? "Link copied!" : "Copy invite link"}
          </GameButton>
        </div>
        {copied === "failed" && <p className="mt-3 text-sm text-coral">Couldn't copy automatically — select the code and copy it by hand.</p>}
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2 text-sm">
        <span className="rounded-full bg-primary-soft px-3 py-1 font-semibold text-primary">{MODE_INFO[room.mode].title}</span>
        <span className="rounded-full bg-coral-soft px-3 py-1 font-semibold text-coral">You play X</span>
      </div>
      <div className="mt-6"><GameButton variant="soft" className="w-full" onClick={onCancel}>Cancel room</GameButton></div>
    </Shell>
  );
}

/* ---------------------------------- Closed ---------------------------------- */

function Closed({ room, v, onMenu, onNew }: { room: RoomRow; v: RoomView; onMenu: () => void; onNew: () => void }) {
  const mine = room.left_by === v.side;
  return (
    <Shell>
      <div className="rounded-[2rem] bg-card border shadow-lift p-8 text-center animate-pop" role="status" aria-live="polite">
        <div className="mx-auto size-20 grid place-items-center rounded-full bg-muted text-muted-foreground"><WifiOff className="size-9" /></div>
        <h1 className="mt-6 text-3xl font-bold">Room closed</h1>
        <p className="mt-2 text-muted-foreground">{mine ? "You left the room." : `${v.oppName} left the room.`}</p>
        <div className="mt-8 grid gap-3">
          <GameButton onClick={onNew}><Plus className="size-4" /> New room</GameButton>
          <GameButton variant="soft" onClick={onMenu}><Home className="size-4" /> Back to Menu</GameButton>
        </div>
      </div>
    </Shell>
  );
}

/* ----------------------------------- Game ----------------------------------- */

function OnlineGame({ room, v, onMenu }: { room: RoomRow; v: RoomView; onMenu: () => void }) {
  const { state, client } = useOnline();
  const g = room.game;
  const finished = room.status === "finished";
  // Leaving a live match closes the room for the opponent too, so ask first. Not needed once it has ended.
  const active = room.status === "playing";
  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => {
    if (!active) setConfirmLeave(false); // match ended (or room closed) while the modal was open
  }, [active]);

  // Let both players see the winning line before the result card appears.
  const [showResult, setShowResult] = useState(false);
  useEffect(() => {
    if (!finished) {
      setShowResult(false);
      return;
    }
    const t = setTimeout(() => setShowResult(true), RESULT_DELAY_MS);
    return () => clearTimeout(t);
  }, [finished, room.round]);

  // Transient errors ("not your turn", …) clear themselves.
  useEffect(() => {
    if (!state.error) return;
    const t = setTimeout(() => client.clearError(), 3500);
    return () => clearTimeout(t);
  }, [state.error, client]);

  if (finished && showResult) {
    const r = describeOnlineResult(room, v);
    return (
      <Shell>
        <ResultCard tone={r.tone} title={r.title} message={r.message} humanOpponent>
          <GameButton onClick={() => void client.requestRematch()} disabled={v.iAmReady || state.busy}>
            <RotateCcw className="size-4" /> {v.iAmReady ? `Waiting for ${v.oppName}…` : "Play Again"}
          </GameButton>
          <GameButton variant="soft" onClick={onMenu}><Home className="size-4" /> Back to Menu</GameButton>
          {v.oppReady && !v.iAmReady && <p className="text-sm text-muted-foreground">{v.oppName} wants a rematch!</p>}
        </ResultCard>
        <div className="mt-6 flex flex-wrap justify-center gap-2 text-sm">
          <span className="rounded-full bg-primary-soft px-3 py-1 font-semibold text-primary">{MODE_INFO[room.mode].title}</span>
          <span className="rounded-full bg-coral-soft px-3 py-1 font-semibold text-coral">Online · {room.scores[v.side]}–{room.scores[v.side === "host" ? "guest" : "host"]}</span>
        </div>
      </Shell>
    );
  }

  const playing = room.status === "playing";
  const vanishing = oldestMarkToVanish(g);
  const oppOnline = !state.userId || !state.presence.includes(state.userId) || (v.oppId !== null && state.presence.includes(v.oppId));
  const oppSide = v.side === "host" ? "guest" : "host";

  const pill = playing
    ? { text: v.myTurn ? "Your turn" : `${v.oppName}'s turn`, symbol: g.current }
    : { text: describeOnlineResult(room, v).title, symbol: g.winner };

  const hint = !playing
    ? ""
    : !oppOnline
      ? `${v.oppName} disconnected. Waiting for them to come back…`
      : g.mode === "classic"
        ? "First to get three in a row wins."
        : vanishing === null
          ? "Each player keeps at most 3 marks — the oldest vanishes."
          : v.myTurn
            ? "Your oldest mark will disappear on your next move."
            : `${v.oppName}'s oldest mark will disappear on their next move.`;

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Leave room"
          onClick={() => (active ? setConfirmLeave(true) : onMenu())}
          className="size-11 grid place-items-center rounded-2xl bg-card border shadow-soft text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-5" />
        </button>
        <StatusPill symbol={pill.symbol} tone={pillTone(pill.symbol)} pulse={playing && !v.myTurn && oppOnline}>
          {pill.text}
        </StatusPill>
        <div className="size-11" />
      </div>

      <div className="mt-8 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <PlayerCard name={v.myName} symbol={v.mySymbol} score={room.scores[v.side]} active={playing && g.current === v.mySymbol} status="You" />
        <span className="font-display text-sm font-semibold text-muted-foreground">VS</span>
        <PlayerCard
          name={v.oppName}
          symbol={v.oppSymbol}
          score={room.scores[oppSide]}
          active={playing && g.current === v.oppSymbol}
          status={oppOnline ? undefined : <span className="text-coral">Disconnected</span>}
        />
      </div>

      <div className="mt-8">
        <BoardGrid
          board={g.board}
          winLine={g.winLine}
          winner={g.winner}
          vanishing={vanishing}
          interactive={playing && v.myTurn && !state.busy}
          onCell={(i) => void client.playMove(i)}
        />
      </div>

      <p className={`mt-4 min-h-10 text-center text-sm ${state.error || !oppOnline ? "font-medium text-coral" : "text-muted-foreground"}`} aria-live="polite">
        {state.error ?? hint}
      </p>

      <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
        <span className="rounded-full bg-primary-soft px-3 py-1 font-semibold text-primary">{MODE_INFO[room.mode].title}</span>
        <span className="rounded-full bg-muted px-3 py-1 font-semibold text-muted-foreground">Room {room.code} · Round {room.round}</span>
      </div>

      <div className="mt-6"><GameButton variant="soft" className="w-full" onClick={() => (active ? setConfirmLeave(true) : onMenu())}><ArrowLeft className="size-4" /> Leave room</GameButton></div>

      <ExitConfirmationModal open={confirmLeave && active} onStay={() => setConfirmLeave(false)} onLeave={onMenu} />
    </Shell>
  );
}
