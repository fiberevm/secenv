import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type Ref, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { copyText } from "../format";
import { CheckIcon, CopyIcon } from "./icons";

const variantClasses = {
  primary:
    "border-transparent bg-brand text-white shadow-[0_1px_2px_rgba(15,23,42,0.14)] hover:bg-brand-hover active:bg-[#124d82] disabled:bg-[#abc9df] disabled:shadow-none",
  secondary:
    "border-neutral-300 bg-white text-neutral-800 shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:border-neutral-400 hover:bg-neutral-50 active:bg-neutral-100 disabled:border-neutral-200 disabled:bg-neutral-50 disabled:text-neutral-400 disabled:shadow-none",
  ghost:
    "border-transparent bg-transparent text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 active:bg-neutral-200/70 disabled:text-neutral-400",
  danger:
    "border-red-300 bg-white text-red-700 shadow-[0_1px_2px_rgba(127,29,29,0.08)] hover:border-red-400 hover:bg-red-50 active:bg-red-100 disabled:border-neutral-200 disabled:text-neutral-400",
  dangerSolid: "border-transparent bg-red-600 text-white shadow-[0_1px_2px_rgba(127,29,29,0.2)] hover:bg-red-700 disabled:bg-red-300",
} as const;

const sizeClasses = {
  md: "h-9 gap-2 px-3 text-sm",
  sm: "h-7 gap-1.5 px-2.5 text-xs",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
};

export function Button({ children, className = "", disabled, isLoading, type = "button", variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border font-medium outline-none transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed motion-reduce:transition-none ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    >
      {isLoading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      type="button"
      aria-label={label}
      title={label}
      className={`grid size-7 shrink-0 place-items-center rounded-md text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-fuchsia-600 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`shrink-0 animate-spin motion-reduce:animate-none ${className}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle className="opacity-30" cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 2.25a5.75 5.75 0 0 1 5.75 5.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Native dialog: the browser handles focus trapping, Escape, and the inert page behind it. */
export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby={titleId}
      className={`m-auto ${wide ? "w-[min(40rem,calc(100vw-2rem))]" : "w-[min(30rem,calc(100vw-2rem))]"} rounded-xl border border-neutral-200 bg-white p-0 text-neutral-950 shadow-xl backdrop:bg-neutral-950/30`}
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold" id={titleId}>
                {title}
              </h2>
              {description ? <p className="mt-1 text-[13px] leading-5 text-neutral-600">{description}</p> : null}
            </div>
            <button
              aria-label="Close"
              className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-md text-neutral-500 outline-none hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-fuchsia-600"
              type="button"
              onClick={onClose}
            >
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

const inputClasses =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-950 shadow-[0_1px_1px_rgba(15,23,42,0.04)] outline-none transition-[border-color,box-shadow] placeholder:text-neutral-400 hover:border-neutral-400 focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-neutral-50 disabled:text-neutral-500";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-9 ${inputClasses} ${className}`} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea {...props} className={`py-2 ${inputClasses} ${className}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-neutral-800">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-neutral-500">{hint}</span> : null}
    </label>
  );
}

export function ErrorBanner({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {onDismiss ? (
        <button className="shrink-0 text-xs font-semibold hover:text-red-950" type="button" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-medium text-neutral-500">{eyebrow}</div> : null}
        <h1 className="text-lg font-semibold text-neutral-950">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-sm text-neutral-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-lg border border-neutral-200 bg-white ${className}`}>{children}</div>;
}

export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-neutral-600">
      {children}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "blue" | "red" | "amber" | "violet" }) {
  const tones = {
    neutral: "bg-neutral-100 text-neutral-600",
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-sky-50 text-sky-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-800",
    violet: "bg-violet-50 text-violet-700",
  };
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 grid size-10 place-items-center rounded-lg bg-neutral-100 text-neutral-500">{icon}</div> : null}
      <p className="text-sm font-medium text-neutral-900">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] leading-5 text-neutral-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-neutral-100 motion-reduce:animate-none ${className}`} aria-hidden="true" />;
}

/** Copies `text`, or the result of `getText` (used for values that are fetched, and audited, on demand). */
export function CopyButton({ text, getText, label = "Copy" }: { text?: string; getText?: () => Promise<string>; label?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");
  return (
    <IconButton
      label={state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          await copyText(getText ? await getText() : (text ?? ""));
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1200);
      }}
    >
      {state === "busy" ? <Spinner className="size-3.5" /> : state === "copied" ? <CheckIcon className="size-3.5 text-emerald-600" /> : <CopyIcon className="size-3.5" />}
    </IconButton>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-[#fbfbfa]">
      {label ? (
        <div className="flex items-center justify-between border-b border-neutral-200 py-1 pl-3 pr-1">
          <span className="text-xs font-medium text-neutral-500">{label}</span>
          <CopyButton text={code} />
        </div>
      ) : null}
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-5 text-neutral-800">{code}</pre>
    </div>
  );
}

export function Avatar({ label, kind = "user" }: { label: string; kind?: string }) {
  const isMachine = kind !== "user";
  return (
    <div
      className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${isMachine ? "bg-violet-100 text-violet-800" : "bg-fuchsia-100 text-fuchsia-800"}`}
      aria-hidden="true"
    >
      {isMachine ? "⌁" : label.charAt(0).toUpperCase()}
    </div>
  );
}
