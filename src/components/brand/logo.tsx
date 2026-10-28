import { APP } from "@/config/app";
import { cn } from "@/components/ui";

/**
 * Símbolo Patrono: um P geométrico — haste vertical e bojo em meia-lua, este
 * a dourado — dentro de um quadrado de cantos suaves em azul-petróleo.
 * Funciona de 16 px (favicon) a tamanhos grandes; sem elementos jurídicos literais.
 */
export function LogoMark({ inverted = false, className }: { inverted?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={inverted ? "#203F50" : "var(--ink)"} />
      <rect x="10" y="8" width="4" height="16" rx="1" fill="#FFFFFF" />
      <path d="M14 8h3.5a6 6 0 0 1 0 12H14z" fill="#D8BD83" />
    </svg>
  );
}

export function Logo({
  inverted = false,
  compact = false,
  className,
}: {
  inverted?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark inverted={inverted} />
      {compact ? (
        <span className="sr-only">{APP.name}</span>
      ) : (
        <span
          className={cn(
            "font-display text-[1.0625rem] font-semibold tracking-[0.16em] uppercase",
            inverted ? "text-white" : "text-ink",
          )}
        >
          {APP.name}
        </span>
      )}
    </span>
  );
}
