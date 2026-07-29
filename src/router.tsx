import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPreload: "intent",
    // Cross-fade route changes instead of hard-cutting. Curves live in
    // styles.css under ::view-transition-*. Browsers without the View
    // Transitions API simply cut, as before.
    defaultViewTransition: true,
  });
};
