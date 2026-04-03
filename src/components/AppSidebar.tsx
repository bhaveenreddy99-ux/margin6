import { LayoutDashboard, Package, ClipboardList, ShoppingCart, BookOpen, FileText, BarChart3, Users, LogOut, Receipt, Settings, Bell, TrendingUp, Trash2 } from "lucide-react";
import logo from "@/assets/logo.png";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const mainNav = [
  { title: "Dashboard", url: "/app/dashboard", icon: LayoutDashboard },
];

const inventoryNav = [
  { title: "List Management", url: "/app/inventory/lists", icon: ClipboardList },
  { title: "Inventory Management", url: "/app/inventory/enter", icon: Package },
  { title: "PAR Management", url: "/app/par", icon: BookOpen },
  { title: "PAR Suggestions", url: "/app/par/suggestions", icon: TrendingUp },
  { title: "Smart Order", url: "/app/smart-order", icon: ShoppingCart },
  { title: "Purchase History", url: "/app/purchase-history", icon: Receipt },
];

const operationsNav = [
  { title: "Invoices (Receiving)", url: "/app/invoices", icon: FileText },
  { title: "Waste Log", url: "/app/waste-log", icon: Trash2 },
];

const insightsNav = [
  { title: "Reports", url: "/app/reports", icon: BarChart3 },
  { title: "Notifications", url: "/app/notifications", icon: Bell },
];

const ownerNav = [
  { title: "Users & Permissions", url: "/app/staff", icon: Users },
  { title: "Settings", url: "/app/settings", icon: Settings },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { currentRestaurant, restaurants } = useRestaurant();

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");

  const rawRole = currentRestaurant?.role ?? (restaurants.some(r => r.role === "OWNER") ? "OWNER" : restaurants.some(r => r.role === "MANAGER" || r.role === "STAFF") ? "MANAGER" : "MANAGER");
  const effectiveRole = rawRole === "STAFF" ? "MANAGER" : rawRole;
  const isOwner = effectiveRole === "OWNER";

  const renderGroup = (label: string, items: typeof mainNav) => (
    <SidebarGroup key={label}>
      <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] font-semibold uppercase tracking-[0.08em] px-3 mb-1">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton asChild isActive={isActive(item.url)}>
                <NavLink to={item.url} end={item.url === "/app/dashboard"}
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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary/10 overflow-hidden shrink-0">
            <img src={logo} alt="RestaurantIQ" className="h-full w-full object-contain" />
          </div>
          <span className="text-[15px] font-bold text-sidebar-accent-foreground tracking-tight">
            Restau<span className="text-sidebar-primary">rantIQ</span>
          </span>
        </Link>
      </div>
      <SidebarContent className="px-2 pt-2">
        {renderGroup("Overview", mainNav)}
        {renderGroup("Inventory", inventoryNav)}
        {renderGroup("Operations", operationsNav)}
        {renderGroup("Insights", insightsNav)}
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
