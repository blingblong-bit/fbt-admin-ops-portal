import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Retry transient failures (e.g. refused while sign-in renews on resume)
        // so tiles recover on their own; prior data stays visible meanwhile.
        retry: 4,
        retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
