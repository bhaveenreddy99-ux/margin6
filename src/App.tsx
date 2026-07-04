import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RestaurantProvider, useRestaurant } from "@/contexts/RestaurantContext";
import { Skeleton } from "@/components/ui/skeleton";
import { DemoRoleProvider } from "@/components/DemoRoleSwitcher";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OwnerRoute } from "@/components/OwnerRoute";
import { StaffRestrictedRoute } from "@/components/StaffRestrictedRoute";
import AppLayout from "@/layouts/AppLayout";

const LandingPage = lazy(() => import("@/pages/Landing"));
const PricingPage = lazy(() => import("@/pages/Pricing"));
const LoginPage = lazy(() => import("@/pages/Login"));
const SignupPage = lazy(() => import("@/pages/Signup"));
const DemoPage = lazy(() => import("@/pages/Demo"));
const PublicDemoPage = lazy(() => import("@/pages/PublicDemo"));
const LeakAuditPage = lazy(() => import("@/pages/LeakAudit"));
const CreateRestaurantPage = lazy(() => import("@/pages/onboarding/CreateRestaurant"));
const DashboardPage = lazy(() => import("@/pages/app/DashboardRouter"));
const MyRestaurantsPage = lazy(() => import("@/pages/app/MyRestaurants"));
const ListManagementPage = lazy(() => import("@/pages/app/ListManagement"));
const EnterInventoryPage = lazy(() => import("@/pages/app/inventory/EnterInventory"));
const ReviewPage = lazy(() => import("@/pages/app/inventory/Review"));
const ApprovedPage = lazy(() => import("@/pages/app/inventory/Approved"));
const ImportPage = lazy(() => import("@/pages/app/inventory/Import"));
const SmartOrderPage = lazy(() => import("@/pages/app/SmartOrder"));
const ParHubPage = lazy(() => import("@/pages/app/ParHub"));
const PARManagementPage = lazy(() => import("@/pages/app/PARManagement"));
const PARSuggestionsPage = lazy(() => import("@/pages/app/PARSuggestions"));
const InvoicesPage = lazy(() => import("@/pages/app/Invoices"));
const InvoiceReviewPage = lazy(() => import("@/pages/app/InvoiceReview"));
const PurchaseHistoryPage = lazy(() => import("@/pages/app/PurchaseHistory"));
const WasteLogPage = lazy(() => import("@/pages/app/WasteLog"));
const SalesPage = lazy(() => import("@/pages/app/Sales"));
const SettingsPage = lazy(() => import("@/pages/app/Settings"));
const NotificationsPage = lazy(() => import("@/pages/app/Notifications"));
const BillingPage = lazy(() => import("@/pages/app/Billing"));
const AlertSettingsPage = lazy(() => import("@/pages/app/settings/AlertSettings"));
const ReminderSettingsPage = lazy(() => import("@/pages/app/settings/ReminderSettings"));
const AuditCenterPage = lazy(() => import("@/pages/app/settings/AuditCenter"));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPassword"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPassword"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  },
});

const routeFallback = (
  <div className="flex items-center justify-center h-screen bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-orange-500 border-t-transparent" />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  </div>
);

function SmartLanding() {
  const { restaurants, loading } = useRestaurant();
  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (restaurants.length >= 2) {
    return <Navigate to="/app/restaurants" replace />;
  }
  return <Navigate to="/app/dashboard" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <RestaurantProvider>
          <DemoRoleProvider>
            <Suspense fallback={routeFallback}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/demo" element={<DemoPage />} />
                <Route path="/demo-live" element={<PublicDemoPage />} />
                <Route path="/audit" element={<LeakAuditPage />} />
                <Route path="/onboarding/create-restaurant" element={<CreateRestaurantPage />} />
                <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route index element={<SmartLanding />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="restaurants" element={<MyRestaurantsPage />} />
                  <Route path="restaurants/new" element={<CreateRestaurantPage />} />
                  <Route path="inventory/lists" element={<StaffRestrictedRoute><ListManagementPage /></StaffRestrictedRoute>} />
                  <Route path="inventory/enter" element={<EnterInventoryPage />} />
                  <Route path="inventory/review" element={<StaffRestrictedRoute><ReviewPage /></StaffRestrictedRoute>} />
                  <Route path="inventory/approved" element={<StaffRestrictedRoute><ApprovedPage /></StaffRestrictedRoute>} />
                  <Route path="inventory/import/:listId" element={<StaffRestrictedRoute><ImportPage /></StaffRestrictedRoute>} />
                  <Route path="smart-order" element={<StaffRestrictedRoute><SmartOrderPage /></StaffRestrictedRoute>} />
                  <Route path="par" element={<StaffRestrictedRoute><ParHubPage /></StaffRestrictedRoute>}>
                    <Route index element={<PARManagementPage />} />
                    <Route path="suggestions" element={<PARSuggestionsPage />} />
                  </Route>

                  <Route path="invoices" element={<StaffRestrictedRoute><InvoicesPage /></StaffRestrictedRoute>} />
                  <Route path="invoices/:id/review" element={<StaffRestrictedRoute><InvoiceReviewPage /></StaffRestrictedRoute>} />
                  <Route path="orders" element={<Navigate to="/app/invoices" replace />} />
                  <Route path="reports" element={<Navigate to="/app/dashboard" replace />} />
                  <Route path="reports/compare" element={<Navigate to="/app/dashboard" replace />} />
                  <Route path="staff" element={<Navigate to="/app/settings" replace />} />
                  <Route path="locations" element={<Navigate to="/app/settings" replace />} />
                  <Route path="settings/locations" element={<Navigate to="/app/settings" replace />} />
                  <Route path="purchase-history" element={<StaffRestrictedRoute><PurchaseHistoryPage /></StaffRestrictedRoute>} />
                  <Route path="waste-log" element={<WasteLogPage />} />
                  <Route path="sales" element={<StaffRestrictedRoute><SalesPage /></StaffRestrictedRoute>} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="settings" element={<OwnerRoute><SettingsPage /></OwnerRoute>} />
                  <Route path="billing" element={<OwnerRoute><BillingPage /></OwnerRoute>} />
                  <Route path="settings/alerts" element={<OwnerRoute><AlertSettingsPage /></OwnerRoute>} />
                  <Route path="settings/reminders" element={<OwnerRoute><ReminderSettingsPage /></OwnerRoute>} />
                  <Route path="settings/audit" element={<OwnerRoute><AuditCenterPage /></OwnerRoute>} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </DemoRoleProvider>
          </RestaurantProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
