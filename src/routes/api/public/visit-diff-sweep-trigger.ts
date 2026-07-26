import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "crypto";

// One-shot admin trigger for the sweep. Reads the HMAC key server-side,
// signs the request, and forwards to /api/public/visit-diff-sweep.
// Guarded by an in-code token; delete this file after use.
const ONESHOT_TOKEN = "sweep-preview-2026-07-26-9f2a1c";

export const Route = createFileRoute("/api/public/visit-diff-sweep-trigger")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("x-oneshot") !== ONESHOT_TOKEN) {
          return new Response("forbidden", { status: 403 });
        }
        const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
        if (!key) return new Response("no key", { status: 500 });
        const body = JSON.stringify({ apply: false });
        const sig = createHmac("sha256", key).update(body).digest("hex");
        const url = new URL(request.url);
        const target = `${url.origin}/api/public/visit-diff-sweep`;
        const res = await fetch(target, {
          method: "POST",
          headers: { "content-type": "application/json", "x-diag-sig": sig },
          body,
        });
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
