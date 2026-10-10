import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Sellers from "@/views/Sellers";
import FinanceCompanies from "@/views/FinanceCompanies";

export default function SavedContacts() {
  const [activeTab, setActiveTab] = useState("sellers");

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Saved Contacts</h1>
        <p className="text-slate-500">
          Manage your saved sellers and finance companies.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="sellers">Sellers</TabsTrigger>
          <TabsTrigger value="finance-companies">Finance Companies</TabsTrigger>
        </TabsList>
        <TabsContent value="sellers" className="mt-4">
          <Sellers embedded />
        </TabsContent>
        <TabsContent value="finance-companies" className="mt-4">
          <FinanceCompanies embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
