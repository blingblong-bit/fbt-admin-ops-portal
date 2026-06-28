import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { unlockSite } from "@/lib/gate.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type UnlockSearch = { redirect?: string };

export const Route = createFileRoute("/unlock")({
  validateSearch: (search: Record<string, unknown>): UnlockSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: UnlockPage,
});

function UnlockPage() {
  const router = useRouter();
  const search = useSearch({ from: "/unlock" });
  const unlock = useServerFn(unlockSite);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(false);
    try {
      const { ok } = await unlock({ data: { username, password } });
      if (!ok) {
        setError(true);
        setSubmitting(false);
        return;
      }
      const target =
        search.redirect && search.redirect.startsWith("/") && !search.redirect.startsWith("/unlock")
          ? search.redirect
          : "/";
      window.location.href = target;
    } catch {
      setError(true);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 rounded-xl border bg-white p-8 shadow"
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900 text-base font-bold text-white">
            FB
          </div>
          <h1 className="text-xl font-semibold tracking-tight">FIT Beyond Therapy</h1>
          <p className="text-sm text-slate-500">Staff sign in</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </div>
        {error && (
          <p className="text-sm font-medium text-red-600">
            Incorrect username or password.
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
