import { SidebarTrigger } from "@/components/ui/sidebar";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useNotifications } from "@/hooks/useNotifications";
import { useLocation, useNavigate } from "react-router-dom";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Building2, MapPin, Bell, ChevronsUpDown, Check, Search, BarChart3 } from "lucide-react";
import { useState, useMemo } from "react";
import logo from "@/assets/logo.png";
import { DemoRoleSwitcher } from "@/components/DemoRoleSwitcher";

const routeNames: Record<string, string> = {
  "/app/dashboard": "Dashboard",
  "/app/inventory/lists": "Inventory Lists",
  "/app/inventory/enter": "Inventory Management",
  "/app/inventory/review": "Review",
  "/app/inventory/approved": "Approved",
  "/app/smart-order": "Smart Order",
  "/app/purchase-history": "Purchase History",
  "/app/orders": "Orders",
  "/app/reports": "Reports",
  "/app/staff": "Staff",
  "/app/notifications": "Notifications",
};

export function AppHeader() {
  const {
    restaurants, currentRestaurant, setCurrentRestaurant,
    isPortfolioMode, locations, currentLocation, setCurrentLocation,
  } = useRestaurant();
  const { unreadCount } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const [restaurantSearch, setRestaurantSearch] = useState("");

  const pageName =
    location.pathname === "/app/par" || location.pathname.startsWith("/app/par/")
      ? "PAR"
      : routeNames[location.pathname] ||
        (location.pathname.startsWith("/app/inventory/import") ? "Import" :
         location.pathname.startsWith("/app/settings") ? "Settings" : "");

  // Filter restaurants for search
  const filteredRestaurants = useMemo(() => {
    if (!restaurantSearch.trim()) return restaurants;
    const q = restaurantSearch.toLowerCase();
    return restaurants.filter(r => r.name.toLowerCase().includes(q));
  }, [restaurants, restaurantSearch]);

  // Can user switch to "All Restaurants" — only OWNER or MANAGER
  const canPortfolio = restaurants.some(r => r.role === "OWNER" || r.role === "MANAGER");

  return (
    <header className="flex h-12 items-center gap-2 border-b border-border/60 px-4 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
      <SidebarTrigger className="-ml-1 h-7 w-7" />
      <Separator orientation="vertical" className="h-4" />
      <span className="text-sm font-medium text-foreground">{pageName}</span>
      <div className="flex-1" />

      {/* Restaurant Switcher — only shown if user has multiple restaurants */}
      {restaurants.length >= 1 && (
        <DropdownMenu onOpenChange={(open) => { if (!open) setRestaurantSearch(""); }}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8 px-2.5">
              <Building2 className="h-3.5 w-3.5 opacity-60" />
              <span className="truncate max-w-[120px]">
                {isPortfolioMode ? "All Restaurants" : currentRestaurant?.name || "Select"}
              </span>
              <ChevronsUpDown className="h-3 w-3 opacity-40" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* Search — show only for 6+ restaurants */}
            {restaurants.length >= 6 && (
              <div className="px-2 py-1.5">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={restaurantSearch}
                    onChange={e => setRestaurantSearch(e.target.value)}
                    placeholder="Search restaurants…"
                    className="h-8 pl-7 text-xs"
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                  />
                </div>
              </div>
            )}

            {/* Portfolio option — only for OWNER/MANAGER */}
            {canPortfolio && !restaurantSearch && (
              <>
                <DropdownMenuItem
                  onClick={() => setCurrentRestaurant(null)}
                  className={isPortfolioMode ? "bg-accent" : ""}
                >
                  <Building2 className="h-3.5 w-3.5 mr-2 opacity-60" />
                  <span className="font-medium">All Restaurants</span>
                  {isPortfolioMode && <Check className="h-3.5 w-3.5 ml-auto" />}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}

            {/* Restaurant list */}
            <div className="max-h-64 overflow-y-auto">
              {filteredRestaurants.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">No restaurants found</div>
              ) : filteredRestaurants.map((r) => (
                <DropdownMenuItem
                  key={r.id}
                  onClick={() => { setCurrentRestaurant(r); setRestaurantSearch(""); }}
                  className={r.id === currentRestaurant?.id && !isPortfolioMode ? "bg-accent" : ""}
                >
                  {r.name}
                  <span className="ml-auto text-[10px] text-muted-foreground font-medium">{r.role}</span>
                  {r.id === currentRestaurant?.id && !isPortfolioMode && <Check className="h-3.5 w-3.5 ml-1" />}
                </DropdownMenuItem>
              ))}
            </div>

            {/* Quick link for multi-restaurant managers */}
            {canPortfolio && !restaurantSearch && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => { setCurrentRestaurant(null); navigate("/app/reports"); }}
                  className="text-primary text-xs"
                >
                  <BarChart3 className="h-3.5 w-3.5 mr-2" />
                  Go to All-Restaurant Reports
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Location Switcher */}
      {!isPortfolioMode && locations.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8 px-2.5">
              <MapPin className="h-3.5 w-3.5 opacity-60" />
              <span className="truncate max-w-[100px]">
                {currentLocation?.name || "All Locations"}
              </span>
              <ChevronsUpDown className="h-3 w-3 opacity-40" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => setCurrentLocation(null)}
              className={!currentLocation ? "bg-accent" : ""}
            >
              All Locations
              {!currentLocation && <Check className="h-3.5 w-3.5 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {locations.map((l) => (
              <DropdownMenuItem
                key={l.id}
                onClick={() => setCurrentLocation(l)}
                className={l.id === currentLocation?.id ? "bg-accent" : ""}
              >
                {l.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Demo Role Switcher */}
      <DemoRoleSwitcher />

      <Separator orientation="vertical" className="h-4" />

      {/* Notifications Bell */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 relative"
        onClick={() => navigate("/app/notifications")}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[9px] font-bold bg-destructive text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </Button>

      {/* Profile avatar — static RestaurantIQ logo */}
      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
        <img src={logo} alt="RestaurantIQ" className="h-full w-full object-contain" />
      </div>
    </header>
  );
}
