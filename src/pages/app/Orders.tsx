import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Truck, Search, Trash2 } from "lucide-react";

export default function OrdersPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderItems, setOrderItems] = useState<{ item_name: string; quantity: number; unit: string }[]>([]);
  const [newItem, setNewItem] = useState({ item_name: "", quantity: 0, unit: "" });
  const [viewOrder, setViewOrder] = useState<any>(null);
  const [viewItems, setViewItems] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState("all");
  const [itemFilter, setItemFilter] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [lists, setLists] = useState<any[]>([]);
  const [selectedList, setSelectedList] = useState("");
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [allOrderItems, setAllOrderItems] = useState<any[]>([]);

  const fetchOrders = async () => {
    if (!currentRestaurant) return;
    let query = supabase.from("orders").select("*").eq("restaurant_id", currentRestaurant.id).order("created_at", { ascending: false });
    if (dateRange !== "all") {
      const now = new Date();
      let start: Date;
      if (dateRange === "7") start = new Date(now.getTime() - 7 * 86400000);
      else if (dateRange === "30") start = new Date(now.getTime() - 30 * 86400000);
      else start = new Date(now.getTime() - 90 * 86400000);
      query = query.gte("created_at", start.toISOString());
    }
    const { data } = await query;
    if (data) {
      setOrders(data);
      if (data.length > 0) {
        const orderIds = data.map(o => o.id);
        const { data: items } = await supabase.from("order_items").select("*").in("order_id", orderIds);
        if (items) setAllOrderItems(items);
      } else { setAllOrderItems([]); }
    }
  };

  useEffect(() => { fetchOrders(); }, [currentRestaurant, dateRange]);
  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_lists").select("*").eq("restaurant_id", currentRestaurant.id).then(({ data }) => { if (data) setLists(data); });
  }, [currentRestaurant]);
  useEffect(() => {
    if (!selectedList) { setCatalogItems([]); return; }
    supabase.from("inventory_catalog_items").select("id, item_name").eq("inventory_list_id", selectedList).order("item_name").then(({ data }) => { if (data) setCatalogItems(data); });
  }, [selectedList]);

  const filteredOrders = useMemo(() => {
    if (!itemFilter) return orders;
    const matchingOrderIds = new Set(allOrderItems.filter(oi => oi.item_name.toLowerCase().includes(itemFilter.toLowerCase())).map(oi => oi.order_id));
    return orders.filter(o => matchingOrderIds.has(o.id));
  }, [orders, allOrderItems, itemFilter]);

  const orderSummary = useMemo(() => {
    const filteredOrderIds = new Set(filteredOrders.map(o => o.id));
    const itemMap = new Map<string, number>();
    allOrderItems.filter(oi => filteredOrderIds.has(oi.order_id)).forEach(oi => { itemMap.set(oi.item_name, (itemMap.get(oi.item_name) || 0) + Number(oi.quantity)); });
    return [...itemMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filteredOrders, allOrderItems]);

  const handleAddItem = () => { if (!newItem.item_name) return; setOrderItems([...orderItems, { ...newItem }]); setNewItem({ item_name: "", quantity: 0, unit: "" }); };
  const handleCreateOrder = async () => {
    if (!currentRestaurant || !user || orderItems.length === 0) return;
    const { data: order, error } = await supabase.from("orders").insert({ restaurant_id: currentRestaurant.id, created_by: user.id }).select().single();
    if (error) { toast.error(error.message); return; }
    await supabase.from("order_items").insert(orderItems.map(i => ({ order_id: order.id, ...i })));
    toast.success("Order created"); setOrderItems([]); setOrderOpen(false); fetchOrders();
  };
  const handleUpdateStatus = async (orderId: string, status: "PENDING" | "PREP" | "READY" | "COMPLETED" | "CANCELED") => { await supabase.from("orders").update({ status, updated_at: new Date().toISOString() }).eq("id", orderId); fetchOrders(); };
  const handleDeleteOrder = async (orderId: string) => {
    // Clean up legacy fake usage rows that may still exist for older orders.
    await supabase.from("usage_events").delete().eq("order_id", orderId);
    await supabase.from("order_items").delete().eq("order_id", orderId);
    const { error } = await supabase.from("orders").delete().eq("id", orderId);
    if (error) { toast.error(error.message); return; }
    toast.success("Order deleted"); fetchOrders();
  };
  const handleViewOrder = async (order: any) => { const { data } = await supabase.from("order_items").select("*").eq("order_id", order.id); setViewItems(data || []); setViewOrder(order); };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div><h1 className="page-title">Orders</h1><p className="page-description">Manage and track restaurant orders</p></div>
        <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
          <DialogTrigger asChild><Button className="bg-gradient-amber shadow-amber gap-2" size="sm"><Plus className="h-4 w-4" /> New Order</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Order</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <Input value={newItem.item_name} onChange={e => setNewItem({ ...newItem, item_name: e.target.value })} placeholder="Item" className="h-10" />
                <Input type="number" value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: +e.target.value })} placeholder="Qty" className="h-10" />
                <div className="flex gap-1"><Input value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })} placeholder="Unit" className="h-10" /><Button size="sm" variant="outline" onClick={handleAddItem} className="h-10 px-3"><Plus className="h-3.5 w-3.5" /></Button></div>
              </div>
              {orderItems.length > 0 && (<div className="space-y-1 text-sm">{orderItems.map((i, idx) => (<div key={idx} className="flex justify-between py-1.5 border-b border-border/50"><span>{i.item_name}</span><span className="font-mono">{i.quantity} {i.unit}</span></div>))}</div>)}
              <Button onClick={handleCreateOrder} className="w-full bg-gradient-amber" disabled={orderItems.length === 0}>Create Order</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card><CardContent className="p-4"><div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1"><Label className="text-xs">Date Range</Label><Select value={dateRange} onValueChange={setDateRange}><SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Time</SelectItem><SelectItem value="7">Last 7 Days</SelectItem><SelectItem value="30">Last 30 Days</SelectItem><SelectItem value="90">Last 90 Days</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">Inventory List</Label><Select value={selectedList} onValueChange={setSelectedList}><SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All lists" /></SelectTrigger><SelectContent><SelectItem value="all">All Lists</SelectItem>{lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1 flex-1 min-w-[180px]"><Label className="text-xs">Filter by Item</Label><div className="relative"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input value={itemFilter} onChange={e => setItemFilter(e.target.value)} placeholder="Type item name..." className="h-9 text-xs pl-8" /></div></div>
      </div></CardContent></Card>

      {orderSummary.length > 0 && (<Card><CardContent className="p-4"><p className="text-[11px] font-semibold text-muted-foreground mb-2">Top Ordered Items ({filteredOrders.length} orders)</p><div className="flex flex-wrap gap-2">{orderSummary.map(([name, qty]) => (<Badge key={name} variant="outline" className="text-xs gap-1">{name} <span className="font-mono text-primary">{qty}</span></Badge>))}</div></CardContent></Card>)}

      {filteredOrders.length === 0 ? (
        <Card><CardContent className="empty-state"><Truck className="empty-state-icon" /><p className="empty-state-title">No orders found</p></CardContent></Card>
      ) : (
        <div className="space-y-2">{filteredOrders.map(o => (
          <Card key={o.id} className="hover:shadow-card transition-all duration-200">
            <CardContent className="flex items-center justify-between p-4">
              <div className="cursor-pointer" onClick={() => handleViewOrder(o)}><p className="font-mono text-sm">{o.id.slice(0, 8)}</p><p className="text-[11px] text-muted-foreground">{new Date(o.created_at).toLocaleString()}</p></div>
              <div className="flex items-center gap-2">
                <Badge variant={o.status === "COMPLETED" ? "default" : "secondary"} className="text-[10px] font-medium">{o.status}</Badge>
                {o.status === "PENDING" && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleUpdateStatus(o.id, "COMPLETED")}>Complete</Button>}
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteOrder(o.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}</div>
      )}

      <Dialog open={!!viewOrder} onOpenChange={() => { setViewOrder(null); setViewItems([]); }}>
        <DialogContent><DialogHeader><DialogTitle>Order {viewOrder?.id.slice(0, 8)}</DialogTitle></DialogHeader>
          <div className="rounded-lg border overflow-hidden"><Table><TableHeader><TableRow className="bg-muted/30"><TableHead className="text-xs font-semibold">Item</TableHead><TableHead className="text-xs font-semibold">Qty</TableHead><TableHead className="text-xs font-semibold">Unit</TableHead></TableRow></TableHeader><TableBody>{viewItems.map(i => (<TableRow key={i.id}><TableCell className="text-sm">{i.item_name}</TableCell><TableCell className="font-mono text-sm">{i.quantity}</TableCell><TableCell className="text-sm">{i.unit}</TableCell></TableRow>))}</TableBody></Table></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
