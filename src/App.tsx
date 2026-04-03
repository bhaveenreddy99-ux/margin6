import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RestaurantProvider } from "@/contexts/RestaurantContext";
import { DemoRoleProvider } from "@/components/DemoRoleSwitcher";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OwnerRoute } from "@/components/OwnerRoute";
import LandingPage from "@/pages/Landing";
import LoginPage from "@/pages/Login";
import SignupPage from "@/pages/Signup";
import DemoPage from "@/pages/Demo";
import CreateRestaurantPage from "@/pages/onboarding/CreateRestaurant";
import AppLayout from "@/layouts/AppLayout";
import DashboardPage from "@/pages/app/Dashboard";
import ListManagementPage from "@/pages/app/ListManagement";
import EnterInventoryPage from "@/pages/app/inventory/EnterInventory";
import ReviewPage from "@/pages/app/inventory/Review";
import ApprovedPage from "@/pages/app/inventory/Approved";
import ImportPage from "@/pages/app/inventory/Import";
import SmartOrderPage from "@/pages/app/SmartOrder";
import PARManagementPage from "@/pages/app/PARManagement";
import PARSuggestionsPage from "@/pages/app/PARSuggestions";

import InvoicesPage from "@/pages/app/Invoices";
import InvoiceReviewPage from "@/pages/app/InvoiceReview";
import ReportsPage from "@/pages/app/Reports";
import StaffPage from "@/pages/app/Staff";
import PurchaseHistoryPage from "@/pages/app/PurchaseHistory";
import WasteLogPage from "@/pages/app/WasteLog";
import SettingsPage from "@/pages/app/Settings";
import NotificationsPage from "@/pages/app/Notifications";
import AlertSettingsPage from "@/pages/app/settings/AlertSettings";
import ReminderSettingsPage from "@/pages/app/settings/ReminderSettings";
import ForgotPasswordPage from "@/pages/ForgotPassword";
import ResetPasswordPage from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <RestaurantProvider>
          <DemoRoleProvider>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/demo" element={<DemoPage />} />
              <Route path="/onboarding/create-restaurant" element={<CreateRestaurantPage />} />
              <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="inventory/lists" element={<ListManagementPage />} />
                <Route path="inventory/enter" element={<EnterInventoryPage />} />
                <Route path="inventory/review" element={<ReviewPage />} />
                <Route path="inventory/approved" element={<ApprovedPage />} />
                <Route path="inventory/import/:listId" element={<ImportPage />} />
                <Route path="smart-order" element={<SmartOrderPage />} />
                <Route path="par" element={<PARManagementPage />} />
                <Route path="par/suggestions" element={<PARSuggestionsPage />} />
                
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="invoices/:id/review" element={<InvoiceReviewPage />} />
                <Route path="orders" element={<Navigate to="/app/invoices" replace />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="staff" element={<OwnerRoute><StaffPage /></OwnerRoute>} />
                <Route path="purchase-history" element={<PurchaseHistoryPage />} />
                <Route path="waste-log" element={<WasteLogPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="settings" element={<OwnerRoute><SettingsPage /></OwnerRoute>} />
                <Route path="settings/alerts" element={<OwnerRoute><AlertSettingsPage /></OwnerRoute>} />
                <Route path="settings/reminders" element={<OwnerRoute><ReminderSettingsPage /></OwnerRoute>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </DemoRoleProvider>
          </RestaurantProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
