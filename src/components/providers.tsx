"use client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useEffect, useState } from "react";
import { Toaster } from "./toaster";
import { setQueryClientRef } from "./qc-ref";

const PERSIST = process.env.NEXT_PUBLIC_PERSIST_CACHE !== "false";

/**
 * The app is entirely client-driven and warm-starts from a persisted query cache. Rendering that cache during
 * hydration would differ from the server HTML (React never patches attribute mismatches), so we render a neutral
 * splash on the server + first client pass and mount the real tree right after.
 */
function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div aria-hidden className="h-dvh w-full bg-bg" />;
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { gcTime: 1000 * 60 * 60 * 24, staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } }),
  );
  setQueryClientRef(client);
  const [persister] = useState(() =>
    typeof window === "undefined" || !PERSIST
      ? undefined
      : createSyncStoragePersister({ storage: window.localStorage, key: "mm-cache", throttleTime: 1500 }),
  );
  if (!persister) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <PersistQueryClientProvider client={client} persistOptions={{ persister: noopPersister() as any }}><ClientOnly>{children}</ClientOnly><Toaster /></PersistQueryClientProvider>;
  }
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24,
        buster: "v1",
        dehydrateOptions: {
          // only list-level metadata is persisted for instant paint; message bodies never touch localStorage
          shouldDehydrateQuery: (q) => q.state.status === "success" && ["threads", "folders", "counts", "accounts", "labels", "settings"].includes(String(q.queryKey[0])),
        },
      }}
    >
      <ClientOnly>{children}</ClientOnly>
      <Toaster />
    </PersistQueryClientProvider>
  );
}

function noopPersister() {
  return { persistClient: async () => {}, restoreClient: async () => undefined, removeClient: async () => {} };
}

export function clearPersistedCache() {
  try { localStorage.removeItem("mm-cache"); } catch {}
}
