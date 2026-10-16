import { Suspense } from "react";
import { SettingsApp } from "@/components/settings";

export default function Page() {
  return (
    <Suspense>
      <SettingsApp />
    </Suspense>
  );
}
