import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, authReady, hasUsers } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await authReady();
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect(hasUsers() ? "/login" : "/login?setup=1");
  return <>{children}</>;
}
