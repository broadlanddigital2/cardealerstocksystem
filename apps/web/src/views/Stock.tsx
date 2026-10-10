import { useState } from "react";
import { useListVehicles } from "@workspace/api-client-react";
import type { Vehicle } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { PlusCircle, Search } from "lucide-react";

export default function Stock() {
  const [search, setSearch] = useState("");

  const { data: vehicles, isLoading } = useListVehicles();

  const query = search.trim().toLowerCase();
  const matchesSearch = (v: Vehicle) =>
    query === "" ||
    v.stockNumber.toLowerCase().includes(query) ||
    v.registrationNumber.toLowerCase().includes(query);

  const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;
  const isArchived = (v: Vehicle) => {
    if (v.status !== "sold" || !v.saleDate) return false;
    const saleTime = new Date(v.saleDate).getTime();
    if (Number.isNaN(saleTime)) return false;
    return Date.now() - saleTime > FOUR_WEEKS_MS;
  };

  const filtered = (vehicles ?? []).filter(matchesSearch);
  const inStock = filtered.filter((v) => v.status !== "sold");
  const sold = filtered.filter((v) => v.status === "sold" && !isArchived(v));
  const archived = filtered.filter((v) => isArchived(v));

  const renderTable = (rows: Vehicle[], emptyMessage: string) => (
    <div className="overflow-x-auto">
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[18%]">Stock No.</TableHead>
            <TableHead className="w-[18%]">Reg</TableHead>
            <TableHead className="w-[22%]">Make</TableHead>
            <TableHead className="w-[22%]">Model</TableHead>
            <TableHead className="w-[20%]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center">Loading vehicles...</TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-slate-500">{emptyMessage}</TableCell>
            </TableRow>
          ) : (
            rows.map((v) => (
              <TableRow key={v.id} className="cursor-pointer hover:bg-slate-50 transition-colors">
                <TableCell>
                  <Link href={`/vehicles/${v.id}`} className="font-medium hover:underline stock-link block">
                    {v.stockNumber}
                  </Link>
                </TableCell>
                <TableCell className="font-semibold">{v.registrationNumber}</TableCell>
                <TableCell>{v.make}</TableCell>
                <TableCell>{v.model}</TableCell>
                <TableCell>
                  <Badge variant={v.status === 'in_stock' ? 'default' : v.status === 'reserved' ? 'outline' : v.status === 'sold' ? 'secondary' : 'outline'} className={v.status === 'reserved' ? 'border-amber-500 text-amber-700' : undefined}>
                    {v.status.replace('_', ' ').toUpperCase()}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Stock Book</h1>
          <p className="text-slate-500">Manage all your vehicles.</p>
        </div>
        <Link href="/vehicles/new">
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Vehicle
          </Button>
        </Link>
      </div>

      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search stock no. or registration..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Tabs defaultValue="in_stock">
        <TabsList>
          <TabsTrigger value="in_stock">In Stock ({inStock.length})</TabsTrigger>
          <TabsTrigger value="sold">Sold ({sold.length})</TabsTrigger>
          <TabsTrigger value="archive">Archive ({archived.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="in_stock" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {renderTable(inStock, "No vehicles in stock.")}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sold" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {renderTable(sold, "No sold vehicles.")}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="archive" className="mt-4">
          <Card>
            <div className="px-4 py-3 border-b">
              <p className="text-xs text-slate-400">Sold more than 4 weeks ago.</p>
            </div>
            <CardContent className="p-0">
              {renderTable(archived, "No archived vehicles.")}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
