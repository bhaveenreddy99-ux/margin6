import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Package, ClipboardList, ShoppingCart, BookOpen, FileText, LogOut, Receipt, Settings, Bell, Trash2, DollarSign, CreditCard, Building2 } from "lucide-react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
const overviewNav = [
  { title: "Overview", url: "/app/dashboard", icon: LayoutDashboard },
];

const myRestaurantsItem = { title: "My Restaurants", url: "/app/restaurants", icon: Building2 };

const inventoryNav = [
  { title: "List Management", url: "/app/inventory/lists", icon: ClipboardList },
  { title: "Inventory Management", url: "/app/inventory/enter", icon: Package },
  { title: "PAR", url: "/app/par", icon: BookOpen },
  { title: "Smart Order", url: "/app/smart-order", icon: ShoppingCart },
  { title: "Purchase History", url: "/app/purchase-history", icon: Receipt },
];

const operationsNav = [
  { title: "Invoices (Receiving)", url: "/app/invoices", icon: FileText },
  { title: "Waste Log", url: "/app/waste-log", icon: Trash2 },
  { title: "Sales Entry", url: "/app/sales", icon: DollarSign },
];

const insightsNav = [
  { title: "Notifications", url: "/app/notifications", icon: Bell },
] as const;

const ownerNav = [
  { title: "Settings", url: "/app/settings", icon: Settings },
  { title: "Billing", url: "/app/billing", icon: CreditCard },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { currentRestaurant, restaurants } = useRestaurant();

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");

  const rawRole =
    currentRestaurant?.role ??
    (restaurants.some((r) => r.role === "OWNER")
      ? "OWNER"
      : restaurants.some((r) => r.role === "MANAGER" || r.role === "STAFF")
        ? "MANAGER"
        : "MANAGER");
  const isOwner = rawRole === "OWNER";
  const isStaffAtCurrent = currentRestaurant?.role === "STAFF";

  useEffect(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("locationSetupWizard")) localStorage.removeItem(k);
    }
  }, []);

  const inventoryNavItems = isStaffAtCurrent
    ? inventoryNav.filter((i) => i.url === "/app/inventory/enter")
    : inventoryNav;

  const operationsNavItems = isStaffAtCurrent
    ? operationsNav.filter((i) => i.url === "/app/waste-log")
    : operationsNav;

  const insightsItems = isStaffAtCurrent
    ? insightsNav.filter((i) => i.url === "/app/notifications")
    : [...insightsNav];

  const renderGroup = (label: string, items: { title: string; url: string; icon: LucideIcon }[]) => (
    <SidebarGroup key={label}>
      <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] font-semibold uppercase tracking-[0.08em] px-3 mb-1">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton asChild isActive={isActive(item.url)}>
                <NavLink to={item.url} end={item.url === "/app/dashboard" || item.url === "/app/settings"}
                  className="gap-3 px-3 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-lg transition-all duration-150"
                  activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                  <item.icon className="h-4 w-4 shrink-0 opacity-70" />
                  <span>{item.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <div className="p-4 pb-2">
        <Link to="/app/dashboard" className="flex items-center gap-2.5 mb-3 cursor-pointer hover:opacity-80 transition-opacity">
          <span className="text-[15px] font-bold text-sidebar-accent-foreground tracking-tight">
            Margin<span className="text-sidebar-primary">6</span>
          </span>
        </Link>
      </div>
      <SidebarContent className="px-2 pt-2">
        {renderGroup(
          "Overview",
          restaurants.length >= 2 ? [myRestaurantsItem, ...overviewNav] : overviewNav,
        )}
        {renderGroup("Inventory", inventoryNavItems)}
        {renderGroup("Operations", operationsNavItems)}
        {insightsItems.length > 0 ? renderGroup("Insights", insightsItems as typeof overviewNav) : null}
        {isOwner && renderGroup("Admin", ownerNav)}
      </SidebarContent>
      <SidebarFooter className="p-3">
        <Button variant="ghost" className="w-full justify-start gap-2.5 text-[13px] text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg h-9"
          onClick={() => { signOut(); navigate("/"); }}>
          <LogOut className="h-4 w-4" /> Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
