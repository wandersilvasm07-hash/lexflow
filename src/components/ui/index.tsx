import { clsx, type ClassValue } from "clsx";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ---------------------------------------------------------------- Botões */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-ink text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)] hover:bg-ink-soft active:bg-ink disabled:bg-ink/45 disabled:shadow-none",
  secondary:
    "bg-surface text-text border border-line-strong shadow-card hover:border-ink/40 hover:bg-subtle hover:text-ink disabled:opacity-50",
  ghost: "text-ink hover:bg-ink-faint disabled:opacity-50",
  danger: "bg-seal text-white hover:bg-seal/90 disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-[0.9375rem] gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/* ---------------------------------------------------------- Formulários */

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-[0.8125rem] font-medium text-text", className)} {...props} />;
}

const inputBase =
  "block w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-text shadow-card transition-colors placeholder:text-muted/70 hover:border-muted/60 focus:border-ink focus:outline-none focus:ring-3 focus:ring-ink/10 disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-seal aria-[invalid=true]:focus:ring-seal/10";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputBase, "h-9", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(inputBase, "h-9 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputBase, "py-2", className)} {...props} />;
}

/** Campo com etiqueta, ajuda e erro ligados por aria. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1 text-xs font-medium text-seal" role="alert">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Propriedades aria para ligar um input ao seu erro/ajuda. */
export function describedBy(id: string, error?: string, hint?: boolean) {
  return {
    id,
    name: id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

/* ----------------------------------------------------------- Superfícies */

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-card border border-line bg-surface shadow-card", className)} {...props} />
  );
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold text-text">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------ Feedback */

type Tone = "neutral" | "ok" | "warn" | "seal" | "ink" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted border-line",
  ok: "bg-ok-faint text-ok border-ok/15",
  warn: "bg-warn-faint text-warn border-warn/15",
  seal: "bg-seal-faint text-seal border-seal/15",
  ink: "bg-ink-faint text-ink border-ink/10",
  info: "bg-info-faint text-info border-info/15",
};

const dots: Record<Tone, string> = {
  neutral: "bg-muted/60",
  ok: "bg-ok",
  warn: "bg-warn",
  seal: "bg-seal",
  ink: "bg-ink",
  info: "bg-info",
};

const alertIcons: Record<Tone, typeof Info> = {
  neutral: Info,
  ok: CircleCheck,
  warn: TriangleAlert,
  seal: CircleAlert,
  ink: Info,
  info: Info,
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", dots[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Alert({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "seal" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-control border px-4 py-3 text-sm", tones[tone], className)}
    >
      {(() => {
        const Icon = alertIcons[tone];
        return <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />;
      })()}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "[&_a]:font-medium")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <span className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full bg-ink-faint" aria-hidden="true">
        <span className="h-3 w-1.5 rounded-r-full bg-gold" />
      </span>
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Tabela */

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full min-w-[36rem] text-left text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("border-b border-line bg-subtle px-5 py-2.5 text-xs font-medium tracking-wide text-muted", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-line px-5 py-3 align-middle [tr:last-child>&]:border-b-0", className)} {...props} />;
}
