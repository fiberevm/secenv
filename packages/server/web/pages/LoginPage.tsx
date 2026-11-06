import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, queryClient, type AuthConfig, type User } from "../api";
import { Logo } from "../components/Logo";
import { Button, ErrorBanner, Field, Input, Spinner } from "../components/ui";

export function LoginPage() {
  const config = useQuery({ queryKey: ["auth-config"], queryFn: () => api<AuthConfig>("/api/auth/config") });
  const urlError = new URLSearchParams(window.location.search).get("error");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState<unknown>(urlError ? new Error(urlError) : null);
  const [submitting, setSubmitting] = useState(false);

  if (config.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center text-neutral-400">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (config.error || !config.data) {
    return <div className="grid min-h-dvh place-items-center text-sm text-red-700">Could not reach the server.</div>;
  }

  const { password: passwordAuth, oidc, needsSetup, setupTokenRequired } = config.data;
  const effectiveMode = needsSetup ? "signup" : mode;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user } = await api<{ user: User }>(effectiveMode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        body: { email, password, name: name || undefined, setupToken: setupToken || undefined },
      });
      window.history.replaceState(null, "", "/");
      queryClient.setQueryData(["me"], user);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-sidebar">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[22rem]">
          <div className="mb-6 flex flex-col items-center text-center">
            <Logo className="mb-4 size-11 drop-shadow-sm" />
            <h1 className="text-xl font-semibold tracking-tight text-neutral-950">
              {needsSetup ? "Set up secenv" : effectiveMode === "signup" ? "Create your account" : "Sign in to secenv"}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {needsSetup ? "Create the first account for this workspace." : "Environment variables for your team."}
            </p>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <div className="space-y-4">
              {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

              {oidc && !needsSetup ? (
                <a
                  href="/api/auth/oidc/start"
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white text-sm font-medium text-neutral-800 shadow-[0_1px_2px_rgba(15,23,42,0.08)] outline-none transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2"
                >
                  Continue with {oidc.name}
                </a>
              ) : null}

              {oidc && passwordAuth && !needsSetup ? (
                <div className="flex items-center gap-3 text-xs text-neutral-400">
                  <div className="h-px flex-1 bg-neutral-200" />
                  or
                  <div className="h-px flex-1 bg-neutral-200" />
                </div>
              ) : null}

              {passwordAuth ? (
                <form className="space-y-3" onSubmit={submit}>
                  {setupTokenRequired ? (
                    <Field label="Setup token" hint="Set by SECENV_SETUP_TOKEN on the server. On Render: the service's Environment tab.">
                      <Input required autoComplete="off" spellCheck={false} className="font-mono" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} />
                    </Field>
                  ) : null}
                  {effectiveMode === "signup" ? (
                    <Field label="Name">
                      <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
                    </Field>
                  ) : null}
                  <Field label="Email">
                    <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
                  </Field>
                  <Field label="Password" hint={effectiveMode === "signup" ? "At least 10 characters." : undefined}>
                    <Input
                      type="password"
                      autoComplete={effectiveMode === "signup" ? "new-password" : "current-password"}
                      required
                      minLength={effectiveMode === "signup" ? 10 : undefined}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" className="w-full" isLoading={submitting}>
                    {effectiveMode === "signup" ? "Create account" : "Sign in"}
                  </Button>
                </form>
              ) : null}

              {oidc && needsSetup && !passwordAuth ? (
                <a href="/api/auth/oidc/start" className="flex h-9 w-full items-center justify-center rounded-md bg-brand text-sm font-medium text-white hover:bg-brand-hover">
                  Continue with {oidc.name}
                </a>
              ) : null}
            </div>
          </div>

          {passwordAuth?.signupOpen && !needsSetup ? (
            <p className="mt-4 text-center text-[13px] text-neutral-500">
              {effectiveMode === "login" ? "New here? " : "Already have an account? "}
              <button type="button" className="font-medium text-brand hover:underline" onClick={() => setMode(effectiveMode === "login" ? "signup" : "login")}>
                {effectiveMode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
