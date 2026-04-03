/**
 * Demo Role Switcher — visible only in demo mode.
 * Allows toggling OWNER / MANAGER UI permissions without needing separate auth users.
 */
import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type DemoRole = "OWNER" | "MANAGER";

interface DemoRoleContextType {
  demoRole: DemoRole;
  setDemoRole: (r: DemoRole) => void;
  isDemoMode: boolean;
}

const DemoRoleContext = createContext<DemoRoleContextType>({
  demoRole: "OWNER",
  setDemoRole: () => {},
  isDemoMode: false,
});

export const useDemoRole = () => useContext(DemoRoleContext);

export function DemoRoleProvider({ children }: { children: ReactNode }) {
  const { currentRestaurant } = useRestaurant();
  const [demoRole, setDemoRole] = useState<DemoRole>("OWNER");

  // Detect demo mode: restaurant name contains "demo" (case-insensitive) or check localStorage
  const isDemoMode =
    currentRestaurant?.name?.toLowerCase().includes("demo") ||
    currentRestaurant?.name?.toLowerCase().includes("test") ||
    localStorage.getItem("demo_mode") === "true";

  // Compute effective role
  const effectiveRole = isDemoMode ? demoRole : (currentRestaurant?.role as DemoRole) || "OWNER";

  return (
    <DemoRoleContext.Provider value={{ demoRole: effectiveRole, setDemoRole, isDemoMode }}>
      {children}
    </DemoRoleContext.Provider>
  );
}

export function DemoRoleSwitcher() {
  const { demoRole, setDemoRole, isDemoMode } = useDemoRole();

  if (!isDemoMode) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1.5 border-dashed border-warning/40 text-warning hover:text-warning">
          <Shield className="h-3 w-3" />
          Demo: {demoRole}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setDemoRole("OWNER")} className="text-xs">
          <Shield className="h-3 w-3 mr-2 text-primary" />
          Owner
          {demoRole === "OWNER" && <Badge variant="secondary" className="ml-auto text-[9px] h-4">Active</Badge>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDemoRole("MANAGER")} className="text-xs">
          <Shield className="h-3 w-3 mr-2 text-warning" />
          Manager
          {demoRole === "MANAGER" && <Badge variant="secondary" className="ml-auto text-[9px] h-4">Active</Badge>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
