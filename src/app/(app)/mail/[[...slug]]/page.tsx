import { Suspense } from "react";
import { MailApp } from "@/components/mail-app";

export default function Page() {
  return (
    <Suspense>
      <MailApp />
    </Suspense>
  );
}
