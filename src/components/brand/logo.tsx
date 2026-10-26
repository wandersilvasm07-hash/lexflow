import { APP } from "@/config/app";
import { cn } from "@/components/ui";

/** Marca provisória: um selo circular com a inicial, em verde-tinta. */
export function Logo({ inverted = false, className }: { inverted?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <circle
          cx="16"
          cy="16"
          r="13.5"
          fill="none"
          stroke={inverted ? "#ffffff" : "var(--ink)"}
          strokeWidth="2"
        />
        <path
          d="M12.5 10v12h8"
          fill="none"
          stroke={inverted ? "#ffffff" : "var(--ink)"}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={cn(
          "text-[1.05rem] font-semibold tracking-tight",
          inverted ? "text-white" : "text-ink",
        )}
      >
        {APP.name}
      </span>
    </span>
  );
}
