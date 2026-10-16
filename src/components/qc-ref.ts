import type { QueryClient } from "@tanstack/react-query";
let ref: QueryClient | null = null;
export const setQueryClientRef = (q: QueryClient) => { ref = q; };
export const getQueryClientRef = () => ref;
