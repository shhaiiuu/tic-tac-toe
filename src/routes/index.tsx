import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bot, Users, Settings, ChevronRight, Grid3x3, Globe, Hourglass } from "lucide-react";
import { useEffect, useState } from "react";
import { Shell, XMark, OMark, GameButton, ModeOption, ExpandCard, Segmented } from "@/components/game/ui";
import { cn } from "@/lib/utils";
import {
  buildConfig,
  DEFAULT_PREFS,
  DIFFICULTY_LABEL,
  loadPrefs,
  MAX_NAME_LENGTH,
  MODE_INFO,
  savePrefs,
  type Prefs,
} from "@/lib/game/config";
import { discardSession, startGame } from "@/lib/game/session";
import { useStats } from "@/lib/game/hooks";
import { lineFor, resetStats } from "@/lib/game/stats";
import type { Difficulty, GameMode, OpponentType, PlayerSymbol } from "@/lib/game/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tic Tac Toe — A calm, modern classic" },
      { name: "description", content: "Play Tic Tac Toe against the computer or a friend in a clean, modern design." },
      { property: "og:title", content: "Tic Tac Toe — A calm, modern classic" },
      { property: "og:description", content: "Play against the computer or a friend." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const sectionLabel = "text-xs font-semibold uppercase tracking-widest text-muted-foreground";
const fieldClass =
  "h-12 w-full rounded-2xl border bg-card px-4 text-base shadow-soft placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Home() {
  const navigate = useNavigate();
  const stats = useStats();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [open, setOpen] = useState<OpponentType | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Back on the menu: no game may keep running (or move) in the background.
  useEffect(() => {
    discardSession();
    setPrefs(loadPrefs());
  }, []);

  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  const start = (opponent: OpponentType) => {
    const next = { ...prefs, opponent };
    savePrefs(next);
    startGame(buildConfig(next));
    navigate({ to: "/game" });
  };

  const shown: OpponentType = open ?? "computer";
  const line = lineFor(stats, prefs.mode, shown);
  const statItems =
    shown === "computer"
      ? [
          { label: "Wins", value: line.a, tone: "text-primary" },
          { label: "Losses", value: line.b, tone: "text-coral" },
          { label: "Draws", value: line.draws, tone: "text-foreground" },
        ]
      : [
          { label: "Player 1", value: line.a, tone: "text-primary" },
          { label: "Player 2", value: line.b, tone: "text-coral" },
          { label: "Draws", value: line.draws, tone: "text-foreground" },
        ];

  return (
    <Shell>
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          onClick={() => {
            setSettingsOpen((v) => !v);
            setConfirmReset(false);
          }}
          className="size-11 grid place-items-center rounded-2xl bg-card border shadow-soft text-muted-foreground hover:text-foreground hover:rotate-45 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings className="size-5" />
        </button>
      </div>

      {settingsOpen && (
        <div className="mt-3 rounded-3xl bg-card border shadow-soft p-4 animate-pop">
          <p className={sectionLabel}>Settings</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Clear all saved wins, losses and draws.</span>
            <button
              type="button"
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                resetStats();
                setConfirmReset(false);
              }}
              className={cn(
                "h-10 shrink-0 rounded-xl px-4 text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                confirmReset ? "bg-coral text-coral-foreground border-transparent" : "bg-card hover:bg-muted",
              )}
            >
              {confirmReset ? "Tap to confirm" : "Reset stats"}
            </button>
          </div>
        </div>
      )}

      <div className="text-center mt-6">
        <div className="flex justify-center gap-2 mb-5">
          <span className="size-14 grid place-items-center rounded-2xl bg-primary-soft"><XMark className="size-8" /></span>
          <span className="size-14 grid place-items-center rounded-2xl bg-coral-soft"><OMark className="size-7" /></span>
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">Tic Tac Toe</h1>
        <p className="mt-3 text-muted-foreground">Three in a row. Simple, timeless, fun.</p>
      </div>

      <section className="mt-10" aria-labelledby="mode-heading">
        <p id="mode-heading" className={sectionLabel}>Game mode</p>
        <div role="radiogroup" aria-labelledby="mode-heading" className="mt-3 grid grid-cols-2 gap-3">
          {(["classic", "modern"] as const satisfies readonly GameMode[]).map((m) => (
            <ModeOption
              key={m}
              selected={prefs.mode === m}
              onSelect={() => update({ mode: m })}
              icon={m === "classic" ? <Grid3x3 className="size-5" /> : <Hourglass className="size-5" />}
              title={MODE_INFO[m].title}
              desc={MODE_INFO[m].short}
            />
          ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="opponent-heading">
        <p id="opponent-heading" className={sectionLabel}>Opponent</p>
        <div className="mt-3 space-y-3">
          <ExpandCard
            id="computer"
            open={open === "computer"}
            onToggle={() => setOpen(open === "computer" ? null : "computer")}
            icon={<Bot className="size-6" />}
            title="You vs Computer"
            desc="Sharpen your skills solo"
            tone="bg-primary-soft text-primary"
          >
            <div className="space-y-4">
              <div>
                <p className={cn(sectionLabel, "mb-2")}>Play as</p>
                <Segmented<PlayerSymbol>
                  label="Your symbol"
                  value={prefs.humanSymbol}
                  onChange={(humanSymbol) => update({ humanSymbol })}
                  options={[
                    { value: "X", label: <><XMark className="size-4" /> </> },
                    { value: "O", label: <><OMark className="size-4" /> </> },
                  ]}
                />
              </div>
              <div>
                <p className={cn(sectionLabel, "mb-2")}>Difficulty</p>
                <Segmented<Difficulty>
                  label="Difficulty"
                  value={prefs.difficulty}
                  onChange={(difficulty) => update({ difficulty })}
                  options={(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => ({
                    value: d,
                    label: DIFFICULTY_LABEL[d],
                  }))}
                />
              </div>
              <GameButton onClick={() => start("computer")} className="w-full">Start game</GameButton>
            </div>
          </ExpandCard>

          <ExpandCard
            id="friend"
            open={open === "friend"}
            onToggle={() => setOpen(open === "friend" ? null : "friend")}
            icon={<Users className="size-6" />}
            title="Local Two Players"
            desc="Pass and play on one device"
            tone="bg-coral-soft text-coral"
          >
            <div className="space-y-4">
              <label className="block">
                <span className={cn(sectionLabel, "mb-2 flex items-center gap-1.5")}><XMark className="size-3.5" /> Player 1</span>
                <input
                  className={fieldClass}
                  value={prefs.player1}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Player 1"
                  onChange={(e) => update({ player1: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={cn(sectionLabel, "mb-2 flex items-center gap-1.5")}><OMark className="size-3.5" /> Player 2</span>
                <input
                  className={fieldClass}
                  value={prefs.player2}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Player 2"
                  onChange={(e) => update({ player2: e.target.value })}
                />
              </label>
              <GameButton onClick={() => start("friend")} variant="coral" className="w-full">Start game</GameButton>
            </div>
          </ExpandCard>

          <Link
            to="/online"
            className="group flex items-center gap-4 rounded-3xl bg-card border shadow-soft p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="size-14 grid place-items-center rounded-2xl bg-muted text-foreground"><Globe className="size-6" /></span>
            <span className="flex-1">
              <span className="block font-display text-xl font-semibold">Play Online</span>
              <span className="block text-sm text-muted-foreground">Race a friend on another device</span>
            </span>
            <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      <div className="mt-8 rounded-3xl bg-card border shadow-soft p-5">
        <p className={cn(sectionLabel, "text-center")}>
          Your stats · {MODE_INFO[prefs.mode].title} · {shown === "computer" ? "vs Computer" : "Local"}
        </p>
        <div className="mt-4 grid grid-cols-3 divide-x">
          {statItems.map((s) => (
            <div key={s.label} className="text-center">
              <div className={`font-display text-3xl font-bold ${s.tone}`}>{s.value}</div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
