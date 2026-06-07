import type { BrowserAuditSession } from "./auditSession";
import { createAuditSupabaseClient, getSupabaseEnv } from "./auditSupabase";

export type LiveMetricsDiagnostic = {
  env: {
    dotEnvLoaded: boolean;
    dotEnvLocalLoaded: boolean;
    viteSupabaseUrl: boolean;
    viteAnonKey: boolean;
    e2eSupabaseUrl: boolean;
    e2eAnonKey: boolean;
    serviceRoleKey: boolean;
    getSupabaseEnvOk: boolean;
    resolvedUrlHost: string | null;
  };
  auth: {
    playwrightAuthFile: boolean;
    resolvedRestaurantId: string | null;
    resolvedLocationId: string | null;
    localStorageRestaurantId: string | null;
    localStorageLocationId: string | null;
    browserAccessToken: boolean;
    browserUserId: string | null;
  };
  client: {
    supabaseClientCreated: boolean;
    mode: "service_role" | "user_jwt" | "none";
  };
  blockers: string[];
};

function envFlag(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

type DiagnosticSession = BrowserAuditSession & {
  localStorageRestaurantId?: string | null;
  localStorageLocationId?: string | null;
};

export function diagnoseLiveExpectedMetrics(
  session: DiagnosticSession,
): LiveMetricsDiagnostic {
  const supabaseEnv = getSupabaseEnv();
  const serviceRole = envFlag("E2E_SUPABASE_SERVICE_ROLE_KEY");
  const client = createAuditSupabaseClient(session.accessToken);

  const blockers: string[] = [];

  if (!supabaseEnv) {
    blockers.push(
      "getSupabaseEnv() returned null — Playwright Node process has no Supabase URL + anon key. " +
        "Copy VITE_SUPABASE_* from .env.local into .env, or set E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY, " +
        "or ensure auditSupabase loads .env.local.",
    );
  }

  if (!session.restaurantId) {
    blockers.push(
      "Resolved restaurantId is null — check restaurant_members for the logged-in user and user_ui_state.",
    );
  }

  if (!client) {
    if (!serviceRole && !session.accessToken) {
      blockers.push(
        "createAuditSupabaseClient() returned null — set E2E_SUPABASE_SERVICE_ROLE_KEY or ensure browser JWT is readable from localStorage.",
      );
    } else if (!supabaseEnv) {
      blockers.push("createAuditSupabaseClient() returned null because getSupabaseEnv() failed first.");
    }
  }

  if (!session.locationId) {
    blockers.push(
      "Resolved locationId is null — check user_ui_state.selected_location_id or locations for the restaurant.",
    );
  }

  if (
    session.localStorageRestaurantId &&
    session.restaurantId &&
    session.localStorageRestaurantId !== session.restaurantId
  ) {
    blockers.push(
      `localStorage.currentRestaurantId (${session.localStorageRestaurantId}) differs from resolved restaurant (${session.restaurantId}) — audit uses resolved id.`,
    );
  }

  let mode: LiveMetricsDiagnostic["client"]["mode"] = "none";
  if (client) {
    mode = serviceRole ? "service_role" : "user_jwt";
  }

  return {
    env: {
      dotEnvLoaded: envFlag("_AUDIT_DOTENV_LOADED"),
      dotEnvLocalLoaded: envFlag("_AUDIT_DOTENV_LOCAL_LOADED"),
      viteSupabaseUrl: envFlag("VITE_SUPABASE_URL"),
      viteAnonKey: envFlag("VITE_SUPABASE_PUBLISHABLE_KEY"),
      e2eSupabaseUrl: envFlag("E2E_SUPABASE_URL"),
      e2eAnonKey: envFlag("E2E_SUPABASE_ANON_KEY"),
      serviceRoleKey: serviceRole,
      getSupabaseEnvOk: Boolean(supabaseEnv),
      resolvedUrlHost: supabaseEnv?.url ? new URL(supabaseEnv.url).host : null,
    },
    auth: {
      playwrightAuthFile: envFlag("_AUDIT_PLAYWRIGHT_AUTH_EXISTS"),
      resolvedRestaurantId: session.restaurantId,
      resolvedLocationId: session.locationId,
      localStorageRestaurantId: session.localStorageRestaurantId ?? null,
      localStorageLocationId: session.localStorageLocationId ?? null,
      browserAccessToken: Boolean(session.accessToken),
      browserUserId: session.userId,
    },
    client: {
      supabaseClientCreated: Boolean(client),
      mode,
    },
    blockers,
  };
}

export function logLiveMetricsDiagnostic(diag: LiveMetricsDiagnostic): void {
  // eslint-disable-next-line no-console
  console.log("\n=== Human audit — live expected metrics diagnostic ===");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(diag, null, 2));
  if (diag.blockers.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\nBlockers:");
    for (const b of diag.blockers) {
      // eslint-disable-next-line no-console
      console.log(`  - ${b}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log("====================================================\n");
}
