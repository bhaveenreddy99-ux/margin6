import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * Unified PAR shell: Manage + Suggestions are tabs over the same area.
 * Child routes render existing PARManagement / PARSuggestions pages unchanged.
 */
export default function ParHubPage() {
  return (
    <div className="space-y-5 animate-fade-in pb-2">
      <div className="border-b border-border/70 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">PAR</h1>
        <nav
          className="mt-2 flex w-fit max-w-full p-1 rounded-lg bg-muted/60 border border-border/60"
          aria-label="PAR sections"
        >
          <NavLink
            to="/app/par"
            end
            className={({ isActive }) =>
              cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            Manage
          </NavLink>
          <NavLink
            to="/app/par/suggestions"
            className={({ isActive }) =>
              cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            Suggestions
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
