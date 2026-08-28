import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FIT Beyond Therapy Admin" },
      { name: "description", content: "Internal staff portal for FIT Beyond Therapy" },
      { name: "author", content: "FIT Beyond Therapy" },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "FIT Beyond Therapy Admin" },
      { name: "twitter:title", content: "FIT Beyond Therapy Admin" },
      { property: "og:description", content: "Internal staff portal for FIT Beyond Therapy" },
      { name: "twitter:description", content: "Internal staff portal for FIT Beyond Therapy" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/fe7584b7-d0b8-4ca9-99cd-61d574cf22bd/id-preview-e7d2d773--10a029f2-197e-4508-8221-cf530b01b259.lovable.app-1782707536167.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/fe7584b7-d0b8-4ca9-99cd-61d574cf22bd/id-preview-e7d2d773--10a029f2-197e-4508-8221-cf530b01b259.lovable.app-1782707536167.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <div
          id={BOOT_FALLBACK_ID}
          style={{
            display: "none",
            position: "fixed",
            inset: 0,
            placeItems: "center",
            background: "#fafafa",
            color: "#111",
            font: "15px/1.5 system-ui, -apple-system, sans-serif",
            zIndex: 2147483647,
            padding: "1.5rem",
          }}
        >
          <div style={{ maxWidth: "24rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Couldn&apos;t load the app
            </div>
            <p style={{ color: "#4b5563", margin: "0 0 1.25rem" }}>
              Your browser may be holding an outdated copy. Reloading usually fixes it.
            </p>
            <a
              href="/"
              style={{
                display: "inline-block",
                background: "#111",
                color: "#fff",
                padding: "0.5rem 1rem",
                borderRadius: "0.375rem",
                textDecoration: "none",
              }}
            >
              Reload
            </a>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: bootGuardScript }} />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    (window as unknown as { __APP_BOOTED__?: boolean }).__APP_BOOTED__ = true;
    const el = document.getElementById(BOOT_FALLBACK_ID);
    if (el) el.style.display = "none";
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);


  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
