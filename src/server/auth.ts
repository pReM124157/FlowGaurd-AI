export type Role = "OWNER" | "FINANCE_ADMIN" | "ANALYST" | "VIEWER";

export type AuthenticatedUser = Readonly<{
  userId: string;
  email: string;
  organizationId: string;
  role: Role;
  displayName?: string;
}>;

const DEMO_ORG = "org_flowguard_demo";
const DEMO_USERS: Record<string, AuthenticatedUser> = {
  "owner@flowguard.demo": { userId: "user_owner", email: "owner@flowguard.demo", organizationId: DEMO_ORG, role: "OWNER" },
  "admin@flowguard.demo": { userId: "user_admin", email: "admin@flowguard.demo", organizationId: DEMO_ORG, role: "FINANCE_ADMIN" },
  "analyst@flowguard.demo": { userId: "user_analyst", email: "analyst@flowguard.demo", organizationId: DEMO_ORG, role: "ANALYST" },
  "viewer@flowguard.demo": { userId: "user_viewer", email: "viewer@flowguard.demo", organizationId: DEMO_ORG, role: "VIEWER" },
  "owner@company-a.live": { userId: "user_company_a", email: "owner@company-a.live", organizationId: "org_company_a", role: "OWNER" },
  "owner@company-b.live": { userId: "user_company_b", email: "owner@company-b.live", organizationId: "org_company_b", role: "OWNER" },
  "owner@empty.live": { userId: "user_empty", email: "owner@empty.live", organizationId: "org_empty", role: "OWNER" },
};

const SESSION_TO_EMAIL: Record<string, string> = {
  fg_demo_owner: "owner@flowguard.demo",
  fg_demo_admin: "admin@flowguard.demo",
  fg_demo_analyst: "analyst@flowguard.demo",
  fg_demo_viewer: "viewer@flowguard.demo",
  fg_company_a_owner: "owner@company-a.live",
  fg_company_b_owner: "owner@company-b.live",
  fg_empty_owner: "owner@empty.live",
};

export type Permission =
  | "view_dashboard"
  | "view_payments"
  | "view_reconciliation"
  | "view_receivables"
  | "view_forecast"
  | "run_scenario"
  | "ask_controller"
  | "view_audit"
  | "view_settings";

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  OWNER: new Set(["view_dashboard", "view_payments", "view_reconciliation", "view_receivables", "view_forecast", "run_scenario", "ask_controller", "view_audit", "view_settings"]),
  FINANCE_ADMIN: new Set(["view_dashboard", "view_payments", "view_reconciliation", "view_receivables", "view_forecast", "run_scenario", "ask_controller", "view_audit", "view_settings"]),
  ANALYST: new Set(["view_dashboard", "view_payments", "view_reconciliation", "view_receivables", "view_forecast", "run_scenario", "ask_controller", "view_audit"]),
  VIEWER: new Set(["view_dashboard", "view_payments", "view_reconciliation", "view_receivables", "view_forecast", "view_audit"]),
};

export async function authenticate(request: Request): Promise<AuthenticatedUser | undefined> {
  const platformEmail = request.headers.get("oai-authenticated-user-email");
  if (platformEmail && DEMO_USERS[platformEmail]) return DEMO_USERS[platformEmail];

  const cookieSession = parseCookie(request.headers.get("cookie") ?? "").fg_session;
  const oauthUser = resolveOAuthSession(cookieSession);
  if (oauthUser) return { userId: oauthUser.userId, email: oauthUser.email, organizationId: oauthUser.organizationId, role: "OWNER", displayName: oauthUser.name };
  if (cookieSession && SESSION_TO_EMAIL[cookieSession]) return DEMO_USERS[SESSION_TO_EMAIL[cookieSession]];

  const supabaseUser = await resolveSupabaseSession(parseCookie(request.headers.get("cookie") ?? "").fg_supabase_session);
  if (supabaseUser) return supabaseUser;

  const testSession = request.headers.get("x-flowguard-session");
  if (testSession && SESSION_TO_EMAIL[testSession]) return DEMO_USERS[SESSION_TO_EMAIL[testSession]];

  return undefined;
}

export function requirePermission(user: AuthenticatedUser, permission: Permission): void {
  if (!ROLE_PERMISSIONS[user.role].has(permission)) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403, code: "FG_FORBIDDEN" });
  }
}

export function demoLoginCookie(role: Role = "OWNER"): string {
  const session = role === "VIEWER" ? "fg_demo_viewer" : role === "ANALYST" ? "fg_demo_analyst" : role === "FINANCE_ADMIN" ? "fg_demo_admin" : "fg_demo_owner";
  return `fg_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
}

export function liveFirstRunCookie(): string {
  return "fg_session=fg_empty_owner; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800";
}

function parseCookie(cookie: string): Record<string, string> {
  return Object.fromEntries(
    cookie
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0].length > 0),
  );
}
import { resolveOAuthSession } from "./google-oauth.ts";
import { resolveSupabaseSession } from "./supabase-auth.ts";
