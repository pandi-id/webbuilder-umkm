"use client";

// /settings/collaborators — both directions of collaboration in one place:
// people helping on sites I own, and sites I help run for someone else.
// Role-agnostic on purpose: the agent/reseller portals have their own entry,
// but a plain client granted editor access had nowhere to see it before.

import { Separator } from "@/components/ui/separator";
import { CollaboratorsList } from "@/components/collaborators/CollaboratorsList";
import { MyCollaborationsList } from "@/components/collaborators/MyCollaborationsList";

export default function SettingsCollaboratorsPage() {
  return (
    <div className="space-y-10">
      <CollaboratorsList />
      <Separator />
      <MyCollaborationsList heading="h2" />
    </div>
  );
}
