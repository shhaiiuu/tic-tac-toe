import { Link } from "@tanstack/react-router";
import { X, Circle, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

export function XMark({ className }: { className?: string }) {
  return <X className={cn("text-primary", className)} strokeWidth={3} />;
}
export function OMark({ className }: { className?: string }) {
  return <Circle className={cn("text-coral", className)} strokeWidth={3} />;
}

type BtnVariant = "primary" | "coral" | "soft" | "ghost";
const btn: Record<BtnVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-soft hover:shadow-lift",
  coral: "bg-coral text-coral-foreground shadow-soft hover:shadow-lift",
  soft: "bg-card text-foreground border shadow-soft hover:shadow-lift",
  ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
};

type GameButtonProps = {
  variant?: BtnVariant;
  children: ReactNode;
  className?: string;
} & (
  | { to: "/" | "/game" | "/result"; onClick?: () => void }
  | { to?: undefined; onClick: () => void; disabled?: boolean }
);

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-5 h-12 font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Navigates when given `to`, otherwise runs `onClick`. */
export function GameButton(props: GameButtonProps) {
  const { variant = "primary", children, className } = props;
  const classes = cn(buttonBase, btn[variant], className);
  if (props.to) {
    return (
      <Link to={props.to} onClick={props.onClick} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} className={classes}>
      {children}
    </button>
  );
}

/** Compact segmented radio control (symbol / difficulty pickers). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 rounded-2xl bg-muted p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Selectable card used for choosing a game mode. */
export function ModeOption({
  selected,
  onSelect,
  icon,
  title,
  desc,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-3xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-primary-soft border-primary/40 ring-2 ring-primary/30 shadow-lift" : "bg-card shadow-soft",
      )}
    >
      <span className={cn("size-10 grid place-items-center rounded-xl", selected ? "bg-card text-primary" : "bg-muted text-muted-foreground")}>
        {icon}
      </span>
      <span className="mt-3 block font-display text-lg font-semibold">{title}</span>
      <span className="mt-1 block text-sm leading-snug text-muted-foreground">{desc}</span>
    </button>
  );
}

/** Option card that expands to reveal its setup panel (home + online screens). */
export function ExpandCard({
  id,
  open,
  onToggle,
  icon,
  title,
  desc,
  tone,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  title: string;
  desc: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-3xl bg-card border transition-all duration-200", open ? "shadow-lift" : "shadow-soft hover:shadow-lift")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`setup-${id}`}
        onClick={onToggle}
        className="group flex w-full items-center gap-4 rounded-3xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={`size-14 grid place-items-center rounded-2xl ${tone}`}>{icon}</span>
        <span className="flex-1">
          <span className="block font-display text-xl font-semibold">{title}</span>
          <span className="block text-sm text-muted-foreground">{desc}</span>
        </span>
        <ChevronRight className={cn("size-5 text-muted-foreground transition-transform", open ? "rotate-90" : "group-hover:translate-x-1")} />
      </button>
      {open && (
        <div id={`setup-${id}`} className="border-t px-4 pb-4 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}
