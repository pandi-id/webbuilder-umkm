// Role → routing helpers. Single source for "where does this role land?" and
// "does this role have a second portal?", shared by the login page, the home
// nav and every dashboard header.

import { Briefcase, ShieldCheck, UserCircle, type LucideIcon } from "lucide-react";

export function defaultRouteForRole(role: string | undefined): string {
  switch (role) {
    case "admin":
      return "/admin";
    default:
      // Everyone else — including reseller and agent — lands on the client
      // dashboard. Those two are ordinary users who were promoted later, so
      // they still own sites and domains from before and would lose sight of
      // them if login dropped them straight into their portal. They switch
      // over with the portal button in the header instead.
      return "/dashboard";
  }
}

// `short` fits the header button next to the avatar; `label` is the full name
// used in menus, where there is room for it.
export type Portal = { href: string; short: string; label: string; icon: LucideIcon };

// Portal a role can switch into from the client dashboard, or null when the
// role has none. Drives the header button and the account-menu shortcut.
export function portalForRole(role: string | undefined): Portal | null {
  switch (role) {
    case "admin":
      return { href: "/admin", short: "Admin", label: "Panel Admin", icon: ShieldCheck };
    case "reseller":
      return {
        href: "/reseller/dashboard",
        short: "Reseller",
        label: "Portal Reseller",
        icon: Briefcase,
      };
    case "agent":
      return {
        href: "/agent/dashboard",
        short: "Agen",
        label: "Portal Agen",
        icon: UserCircle,
      };
    default:
      return null;
  }
}
