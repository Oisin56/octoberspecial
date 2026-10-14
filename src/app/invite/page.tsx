import type { Metadata } from "next";
import { BrandShell } from "@/components/front/BrandShell";
import { InviteForm } from "@/components/front/InviteForm";

export const metadata: Metadata = { title: "Request an invite" };

export default function Invite() {
  return (
    <BrandShell>
      <h1>Request an invite</h1>
      <p className="fr-lead">It&apos;s invitation-only while we get it just right. Tell us a little about your event and we&apos;ll email you a link to set it up.</p>
      <InviteForm />
    </BrandShell>
  );
}
