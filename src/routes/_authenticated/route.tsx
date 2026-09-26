import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Client-only route: render nothing on the server so the initial HTML matches
  // the browser's first render (avoids React hydration mismatch #418).
  pendingComponent: () => null,
  beforeLoad: async ({ location }) => {
    // Use the locally stored session (instant) instead of getUser(), which
    // makes a network round trip on every navigation — including Back — and
    // leaves the screen blank while it waits. RLS still enforces access
    // server-side on every query, so this gate is only about UX.
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    return { user: data.session.user };
  },
  component: () => <Outlet />,
});
