import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AnimatedLoader } from "./components/animated-loader";

/**
 * Safety net for any route without its own pendingComponent. Most routes now
 * define one that matches their real layout; this keeps a new route from silently
 * rendering nothing while it loads.
 */
function DefaultPending() {
  return <AnimatedLoader text="Loading…" />;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retrying a Forbidden or Unauthorized is pointless — the answer won't
        // change — and it delayed the error UI by several seconds.
        retry: (count, error) =>
          /Forbidden|Unauthorized|not found/i.test(String((error as Error)?.message))
            ? false
            : count < 2,
      },
    },
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // `intent` + a 0 stale time re-ran every loader on every link hover. Preloading
    // is still worth it; refetching on each hover is not.
    defaultPreloadStaleTime: 30_000,
    defaultPreload: "intent",
    defaultPendingComponent: DefaultPending,
    // Cross-fade route changes instead of hard-cutting. Curves live in
    // styles.css under ::view-transition-*. Browsers without the View
    // Transitions API simply cut, as before.
    defaultViewTransition: true,
  });
};
