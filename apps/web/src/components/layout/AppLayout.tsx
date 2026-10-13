import { ReactNode } from "react";
import { Link, useLocation } from "@/lib/router";
import { useUser, useAuth, useSignOut } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import {
  Car,
  FileText,
  Settings as SettingsIcon,
  LogOut,
  PlusCircle,
  Users,
  Banknote,
  Inbox,
  Globe,
  Download,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAccess } from "@/components/app/access";
import { useGetSettings } from "@workspace/api-client-react";
const logoUrl = "/assets/motormetric-logo.png";

interface AppLayoutProps {
  children: ReactNode;
}

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  external?: boolean;
  badge?: number;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const signOut = useSignOut();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { isAdmin, has } = useAccess();
  const { data: settings } = useGetSettings();
  const basePath = "";

  // Shares the ["enquiries"] cache with the Leads page so the badge stays in
  // sync as leads are marked read/archived there.
  const { data: leads = [] } = useQuery<Array<{ status: string }>>({
    queryKey: ["enquiries"],
    enabled: has("leads"),
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${basePath}/api/enquiries`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Failed to load leads (${res.status})`);
      return res.json();
    },
  });
  const newLeadCount = leads.filter((l) => l.status === "new").length;

  const navigation: NavItem[] = [
    { name: "Stock Book", href: "/stock", icon: Car },
    { name: "Add Vehicle", href: "/vehicles/new", icon: PlusCircle },
    // Each item below shows only when the user's modules include it
    // (site modules, limited by role; see src/lib/modules.ts).
    ...(has("leads") ? [{ name: "Leads", href: "/leads", icon: Inbox, badge: newLeadCount }] : []),
    // Website link also needs the public website switched on in Settings.
    ...(has("showroom") && settings?.showroomEnabled ? [{ name: "Website", href: `${basePath}/showroom`, icon: Globe, external: true }] : []),
    ...(has("reports") ? [{ name: "Reports", href: "/reports", icon: FileText }] : []),
    ...(has("cash_sheet") ? [{ name: "Cash Sheet", href: "/cash-sheet", icon: Banknote }] : []),
    ...(has("contacts") ? [{ name: "Saved Contacts", href: "/saved-contacts", icon: Users }] : []),
    ...(has("csv_import") || has("cazoo_import") ? [{ name: "Import", href: "/import", icon: Download }] : []),
    // Settings (including Users and Roles) is admin-only.
    ...(isAdmin ? [{ name: "Settings", href: "/settings", icon: SettingsIcon }] : []),
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col hidden md:flex">
        <div className="flex flex-col items-center justify-center px-2 pt-0 pb-0 border-b border-slate-200 overflow-hidden">
          <img
            src={logoUrl}
            alt="MotorMetric by The Motor Trade Accountants"
            className="max-h-[28rem] w-full object-contain -mt-4"
          />
        </div>

        <nav className="flex-1 overflow-y-auto pt-1 pb-4 px-3 space-y-1">
          {navigation.map((item) => {
            if (item.external) {
              return (
                <a
                  key={item.name}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                >
                  <item.icon size={18} />
                  {item.name}
                  {item.badge ? (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[#8DC63F] px-1.5 py-0.5 text-xs font-semibold leading-none text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </a>
              );
            }
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-[#8DC63F]/10 text-[#5f9128]"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  )}
                >
                  <item.icon size={18} />
                  {item.name}
                  {item.badge ? (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[#8DC63F] px-1.5 py-0.5 text-xs font-semibold leading-none text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </nav>

        {settings?.logoPath && (
          <div className="flex flex-col items-center px-4 pt-4 border-t border-slate-200">
            <img
              src={`/api/storage${settings.logoPath}`}
              alt={settings.businessName || "Company logo"}
              className="h-32 w-auto max-w-full object-contain"
            />
          </div>
        )}

        <div className="p-4">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-xs font-medium">
              {(user?.firstName || user?.email || "U").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">
                {user?.fullName || user?.email || "User"}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {user?.fullName ? user?.email : null}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            onClick={() => signOut(basePath || "/")}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}