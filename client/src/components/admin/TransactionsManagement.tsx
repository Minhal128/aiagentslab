'use strict';
/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AuthStorage } from "@/lib/auth-storage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, DollarSign, CreditCard, TrendingUp, Receipt, RefreshCw, Filter, Download, Eye, FileText, Plus, RotateCcw, AlertTriangle, CheckCircle, XCircle, Clock, ExternalLink, Copy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

interface TransactionInvoice {
  id: string;
  invoiceNumber: string;
  pdfUrl?: string | null;
}

interface Transaction {
  id: string;
  userId: string;
  type: string;
  gateway: string;
  gatewayTransactionId: string | null;
  amount: string;
  currency: string;
  status: string;
  description: string;
  planName?: string | null;
  packageName?: string | null;
  creditsAwarded?: number | null;
  billingPeriod?: string | null;
  createdAt: string;
  completedAt?: string | null;
  user?: { id: string; name: string; email: string } | null;
  hasRefunds?: boolean;
  invoice?: TransactionInvoice | null;
}

interface Analytics {
  totalRevenue: number;
  revenueByGateway: Record<string, number>;
  revenueByType: Record<string, number>;
  transactionCount: number;
  transactionsByStatus: Record<string, number>;
  refundCount: number;
  totalRefunded: number;
}

type TimeRange = 'week' | 'month' | 'year' | 'all';

const GATEWAY_COLORS: Record<string, string> = {
  stripe: "#635BFF",
  razorpay: "#3395FF",
  paypal: "#003087",
  paystack: "#00C3F7",
  mercadopago: "#009EE3",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/10 text-green-700 border-green-500/30",
  pending: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
  failed: "bg-red-500/10 text-red-700 border-red-500/30",
  refunded: "bg-purple-500/10 text-purple-700 border-purple-500/30",
  partially_refunded: "bg-orange-500/10 text-orange-700 border-orange-500/30",
};

const TYPE_COLORS: Record<string, string> = {
  subscription: "#10B981",
  credits: "#F59E0B",
};

export default function TransactionsManagement() {
  const [gatewayFilter, setGatewayFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [generatingInvoice, setGeneratingInvoice] = useState<string | null>(null);
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const { toast } = useToast();

  const { data: transactionsData, isLoading: transactionsLoading, refetch } = useQuery<{ transactions: Transaction[]; isReadOnlyAdmin: boolean }>({
    queryKey: ["/api/admin/transactions", gatewayFilter, typeFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gatewayFilter !== "all") params.append("gateway", gatewayFilter);
      if (typeFilter !== "all") params.append("type", typeFilter);
      if (statusFilter !== "all") params.append("status", statusFilter);
      
      const authHeader = AuthStorage.getAuthHeader();
      if (!authHeader) throw new Error("Authentication required");
      const response = await fetch(`/api/admin/transactions?${params}`, {
        headers: { Authorization: authHeader },
      });
      if (!response.ok) throw new Error("Failed to fetch transactions");
      return response.json();
    },
  });

  const transactions = transactionsData?.transactions;
  const isReadOnlyAdmin = transactionsData?.isReadOnlyAdmin ?? false;

  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = useQuery<Analytics>({
    queryKey: ["/api/admin/transactions/analytics", timeRange],
    queryFn: async () => {
      const authHeader = AuthStorage.getAuthHeader();
      if (!authHeader) throw new Error("Authentication required");
      const response = await fetch(`/api/admin/transactions/analytics?timeRange=${timeRange}`, {
        headers: { Authorization: authHeader },
      });
      if (!response.ok) throw new Error("Failed to fetch analytics");
      return response.json();
    },
    retry: 2,
    staleTime: 30000,
  });

  const filteredTransactions = transactions?.filter((tx) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      tx.user?.name?.toLowerCase().includes(term) ||
      tx.user?.email?.toLowerCase().includes(term) ||
      tx.gatewayTransactionId?.toLowerCase().includes(term) ||
      tx.description.toLowerCase().includes(term)
    );
  });

  const formatCurrency = (amount: number | string, currency: string = "USD") => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(num);
  };

  const handleDownloadInvoice = async (invoiceId: string, invoiceNumber: string) => {
    setDownloadingInvoice(invoiceId);
    try {
      const authHeader = AuthStorage.getAuthHeader();
      if (!authHeader) throw new Error("Authentication required");
      const response = await fetch(`/api/invoices/admin/${invoiceId}/download`, {
        headers: { Authorization: authHeader },
      });
      
      if (!response.ok) {
        throw new Error("Failed to download invoice");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice-${invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Invoice Downloaded",
        description: `Invoice ${invoiceNumber} has been downloaded`,
      });
    } catch (error: any) {
      toast({
        title: "Download Failed",
        description: error.message || "Failed to download invoice",
        variant: "destructive",
      });
    } finally {
      setDownloadingInvoice(null);
    }
  };

  const handleGenerateInvoice = async (transactionId: string) => {
    setGeneratingInvoice(transactionId);
    try {
      const authHeader = AuthStorage.getAuthHeader();
      if (!authHeader) throw new Error("Authentication required");
      const response = await fetch(`/api/invoices/admin/${transactionId}/generate`, {
        method: "POST",
        headers: { 
          Authorization: authHeader,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ regenerate: false }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to generate invoice");
      }
      
      const result = await response.json();
      
      toast({
        title: result.alreadyExists ? "Invoice Exists" : "Invoice Generated",
        description: `Invoice ${result.invoice?.invoiceNumber || ""} ${result.alreadyExists ? "already exists" : "has been generated"}`,
      });
      
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/transactions/invoices/all"] });
    } catch (error: any) {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate invoice",
        variant: "destructive",
      });
    } finally {
      setGeneratingInvoice(null);
    }
  };

  const gatewayChartData = analytics?.revenueByGateway
    ? Object.entries(analytics.revenueByGateway).map(([gateway, revenue]) => ({
        name: gateway.charAt(0).toUpperCase() + gateway.slice(1),
        value: revenue,
        fill: GATEWAY_COLORS[gateway] || "#6B7280",
      }))
    : [];

  const typeChartData = analytics?.revenueByType
    ? Object.entries(analytics.revenueByType).map(([type, revenue]) => ({
        name: type === "subscription" ? "Subscriptions" : "Credit Packages",
        value: revenue,
        fill: TYPE_COLORS[type] || "#6B7280",
      }))
    : [];

  const statusChartData = analytics?.transactionsByStatus
    ? Object.entries(analytics.transactionsByStatus).map(([status, count]) => ({
        name: status.charAt(0).toUpperCase() + status.slice(1).replace("_", " "),
        count,
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-transactions-title">Payment Transactions</h2>
          <p className="text-muted-foreground">
            View and manage all payment transactions across gateways
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-transactions">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-transactions-overview">
            <TrendingUp className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="transactions" data-testid="tab-transactions-list">
            <Receipt className="h-4 w-4 mr-2" />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-transactions-invoices">
            <FileText className="h-4 w-4 mr-2" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="refunds" data-testid="tab-transactions-refunds">
            <RotateCcw className="h-4 w-4 mr-2" />
            Refund Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Time Period:</span>
            </div>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
              {(['week', 'month', 'year', 'all'] as TimeRange[]).map((range) => (
                <Button
                  key={range}
                  variant={timeRange === range ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setTimeRange(range)}
                  data-testid={`button-time-range-${range}`}
                >
                  {range === 'week' ? 'Weekly' : range === 'month' ? 'Monthly' : range === 'year' ? 'Yearly' : 'All Time'}
                </Button>
              ))}
            </div>
          </div>

          {analyticsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : analyticsError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Failed to load analytics data. Please try refreshing the page.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-total-revenue">
                      {formatCurrency(analytics?.totalRevenue || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">From completed transactions</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-transaction-count">
                      {analytics?.transactionCount || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">{timeRange === 'all' ? 'All time' : `Last ${timeRange}`}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Refunds</CardTitle>
                    <RotateCcw className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-refund-count">
                      {analytics?.refundCount || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(analytics?.totalRefunded || 0)} refunded
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Gateways</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-active-gateways">
                      {Object.keys(analytics?.revenueByGateway || {}).length}
                    </div>
                    <p className="text-xs text-muted-foreground">Payment gateways used</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-success-rate">
                      {analytics?.transactionCount
                        ? Math.round(
                            (((analytics.transactionsByStatus?.completed || 0) + 
                              (analytics.transactionsByStatus?.refunded || 0) + 
                              (analytics.transactionsByStatus?.partially_refunded || 0)) / analytics.transactionCount) * 100
                          )
                        : 0}%
                    </div>
                    <p className="text-xs text-muted-foreground">Payments collected</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Revenue by Gateway</CardTitle>
                    <CardDescription>Distribution across payment providers</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {gatewayChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={gatewayChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {gatewayChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => formatCurrency(value)} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                        No transaction data available
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Revenue by Type</CardTitle>
                    <CardDescription>Subscriptions vs Credit Packages</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {typeChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={typeChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis tickFormatter={(value) => `$${value}`} />
                          <Tooltip formatter={(value: number) => formatCurrency(value)} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {typeChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                        No transaction data available
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Transaction Status Distribution</CardTitle>
                  <CardDescription>Overview of transaction outcomes</CardDescription>
                </CardHeader>
                <CardContent>
                  {statusChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={statusChartData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="name" type="category" width={120} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#6366F1" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                      No transaction data available
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4" data-testid="transactions-tab-content">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <CardTitle>All Transactions</CardTitle>
                  <CardDescription>Filter and search payment records</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Search by user, email, or ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64"
                    data-testid="input-search-transactions"
                  />
                  <Select value={gatewayFilter} onValueChange={setGatewayFilter}>
                    <SelectTrigger className="w-36" data-testid="select-gateway-filter">
                      <SelectValue placeholder="Gateway" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Gateways</SelectItem>
                      <SelectItem value="stripe">Stripe</SelectItem>
                      <SelectItem value="razorpay">Razorpay</SelectItem>
                      <SelectItem value="paypal">PayPal</SelectItem>
                      <SelectItem value="paystack">Paystack</SelectItem>
                      <SelectItem value="mercadopago">MercadoPago</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-36" data-testid="select-type-filter">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="subscription">Subscription</SelectItem>
                      <SelectItem value="credits">Credits</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-36" data-testid="select-status-filter">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="refunded">Refunded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {transactionsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredTransactions && filteredTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Gateway</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTransactions.map((tx) => (
                        <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(tx.createdAt), "MMM d, yyyy")}
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(tx.createdAt), "HH:mm")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{tx.user?.name || "Unknown"}</div>
                            <div className="text-xs text-muted-foreground">{tx.user?.email}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={tx.type === "subscription" ? "border-green-500/30 text-green-700" : "border-amber-500/30 text-amber-700"}>
                              {tx.type === "subscription" ? "Plan" : "Credits"}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {tx.planName || tx.packageName || tx.description}
                            {tx.creditsAwarded && (
                              <div className="text-xs text-muted-foreground">
                                +{tx.creditsAwarded.toLocaleString()} credits
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              style={{
                                borderColor: GATEWAY_COLORS[tx.gateway] || "#6B7280",
                                color: GATEWAY_COLORS[tx.gateway] || "#6B7280",
                              }}
                            >
                              {tx.gateway.charAt(0).toUpperCase() + tx.gateway.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(tx.amount, tx.currency)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={STATUS_COLORS[tx.status] || ""}>
                              {tx.status.charAt(0).toUpperCase() + tx.status.slice(1).replace("_", " ")}
                            </Badge>
                            {tx.hasRefunds && (
                              <Badge variant="outline" className="ml-1 bg-purple-500/10 text-purple-700 border-purple-500/30">
                                Refund
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {tx.invoice ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono">{tx.invoice.invoiceNumber}</span>
                                {!isReadOnlyAdmin && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Download Invoice"
                                    disabled={downloadingInvoice === tx.invoice.id}
                                    onClick={() => handleDownloadInvoice(tx.invoice!.id, tx.invoice!.invoiceNumber)}
                                    data-testid={`button-download-invoice-${tx.id}`}
                                  >
                                    {downloadingInvoice === tx.invoice.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Download className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            ) : tx.status === "completed" && !isReadOnlyAdmin ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={generatingInvoice === tx.id}
                                onClick={() => handleGenerateInvoice(tx.id)}
                                data-testid={`button-generate-invoice-${tx.id}`}
                              >
                                {generatingInvoice === tx.id ? (
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                ) : (
                                  <Plus className="h-3 w-3 mr-1" />
                                )}
                                Generate
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              title="View Details" 
                              onClick={() => setSelectedTransaction(tx)}
                              data-testid={`button-view-transaction-${tx.id}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No transactions found</p>
                  <p className="text-sm">Transactions will appear here once payments are made</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          <InvoicesTab />
        </TabsContent>

        <TabsContent value="refunds" className="space-y-4">
          <RefundsTab />
        </TabsContent>
      </Tabs>

      {/* Transaction Details Dialog */}
      <TransactionDetailsDialog
        transaction={selectedTransaction}
        open={!!selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        onRefundComplete={() => {
          setSelectedTransaction(null);
          refetch();
        }}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}

interface TransactionDetailsDialogProps {
  transaction: Transaction | null;
  open: boolean;
  onClose: () => void;
  onRefundComplete: () => void;
  formatCurrency: (amount: number | string, currency: string) => string;
}

function TransactionDetailsDialog({ transaction, open, onClose, onRefundComplete, formatCurrency }: TransactionDetailsDialogProps) {
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const { toast } = useToast();

  const refundMutation = useMutation({
    mutationFn: async (data: { transactionId: string; amount: number; reason: string }) => {
      return apiRequest("POST", `/api/admin/refunds/${data.transactionId}`, {
        amount: data.amount,
        reason: data.reason,
      });
    },
    onSuccess: () => {
      toast({
        title: "Refund Initiated",
        description: "The refund has been submitted to the payment gateway.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/transactions"] });
      setShowRefundForm(false);
      setRefundAmount("");
      setRefundReason("");
      onRefundComplete();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Refund Failed",
        description: error.message || "Failed to process refund",
      });
    },
  });

  const handleRefund = () => {
    if (!transaction) return;
    const amount = parseFloat(refundAmount);
    const maxAmount = parseFloat(transaction.amount);
    
    if (isNaN(amount) || amount <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid Amount",
        description: "Please enter a valid refund amount greater than zero",
      });
      return;
    }
    
    if (amount > maxAmount) {
      toast({
        variant: "destructive",
        title: "Amount Too High",
        description: `Refund amount cannot exceed ${formatCurrency(maxAmount, transaction.currency)}`,
      });
      return;
    }
    
    refundMutation.mutate({
      transactionId: transaction.id,
      amount,
      reason: refundReason || "Refund requested by admin",
    });
  };

  const canRefund = transaction?.status === "completed" && !transaction?.hasRefunds;
  const maxRefundAmount = transaction ? parseFloat(transaction.amount) : 0;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "pending":
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "refunded":
      case "partially_refunded":
        return <RotateCcw className="h-5 w-5 text-purple-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getStatusIcon(transaction.status)}
            Transaction Details
          </DialogTitle>
          <DialogDescription>
            Transaction ID: {transaction.id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Transaction Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Amount</Label>
              <p className="text-lg font-semibold">{formatCurrency(transaction.amount, transaction.currency)}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Status</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={STATUS_COLORS[transaction.status] || ""}>
                  {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1).replace("_", " ")}
                </Badge>
                {transaction.hasRefunds && (
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-500/30">
                    Has Refunds
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Type</Label>
              <Badge variant="outline" className={transaction.type === "subscription" ? "border-green-500/30 text-green-700" : "border-amber-500/30 text-amber-700"}>
                {transaction.type === "subscription" ? "Subscription" : "Credits Purchase"}
              </Badge>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Gateway</Label>
              <Badge
                variant="outline"
                style={{
                  borderColor: GATEWAY_COLORS[transaction.gateway] || "#6B7280",
                  color: GATEWAY_COLORS[transaction.gateway] || "#6B7280",
                }}
              >
                {transaction.gateway.charAt(0).toUpperCase() + transaction.gateway.slice(1)}
              </Badge>
            </div>
          </div>

          <Separator />

          {/* Customer Info */}
          <div className="space-y-3">
            <h4 className="font-medium">Customer Information</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Name</Label>
                <p>{transaction.user?.name || "N/A"}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Email</Label>
                <p>{transaction.user?.email || "N/A"}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Transaction Details */}
          <div className="space-y-3">
            <h4 className="font-medium">Payment Details</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Gateway Transaction ID</Label>
                {transaction.gatewayTransactionId ? (
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs break-all bg-muted px-2 py-1 rounded flex-1">{transaction.gatewayTransactionId}</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(transaction.gatewayTransactionId!);
                        toast({ title: "Copied", description: "Transaction ID copied to clipboard" });
                      }}
                      data-testid="button-copy-gateway-tx-id"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <p className="font-mono text-xs text-muted-foreground">N/A</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Description</Label>
                <p>{transaction.planName || transaction.packageName || transaction.description}</p>
              </div>
              {transaction.creditsAwarded && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Credits Awarded</Label>
                  <p>{transaction.creditsAwarded.toLocaleString()} credits</p>
                </div>
              )}
              {transaction.billingPeriod && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Billing Period</Label>
                  <p>{transaction.billingPeriod}</p>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Created</Label>
                <p>{format(new Date(transaction.createdAt), "PPpp")}</p>
              </div>
              {transaction.completedAt && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Completed</Label>
                  <p>{format(new Date(transaction.completedAt), "PPpp")}</p>
                </div>
              )}
            </div>
          </div>

          {/* Refund Section */}
          {canRefund && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Refund</h4>
                  {!showRefundForm && (
                    <Button variant="outline" size="sm" onClick={() => setShowRefundForm(true)} data-testid="button-show-refund-form">
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Issue Refund
                    </Button>
                  )}
                </div>

                {showRefundForm && (
                  <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Refunds are processed through the payment gateway and may take 5-10 business days to reflect in the customer's account.
                      </AlertDescription>
                    </Alert>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="refund-amount">Refund Amount ({transaction.currency})</Label>
                        <Input
                          id="refund-amount"
                          type="number"
                          step="0.01"
                          min="0.01"
                          max={maxRefundAmount}
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                          placeholder={`Max: ${maxRefundAmount.toFixed(2)}`}
                          data-testid="input-refund-amount"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="refund-reason">Reason (Optional)</Label>
                        <Input
                          id="refund-reason"
                          value={refundReason}
                          onChange={(e) => setRefundReason(e.target.value)}
                          placeholder="Customer request, etc."
                          data-testid="input-refund-reason"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => setShowRefundForm(false)} data-testid="button-cancel-refund">
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleRefund} 
                        disabled={refundMutation.isPending || !refundAmount}
                        data-testid="button-confirm-refund"
                      >
                        {refundMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4 mr-2" />
                        )}
                        Process Refund
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Already Refunded Notice */}
          {transaction.hasRefunds && (
            <>
              <Separator />
              <Alert className="bg-purple-500/10 border-purple-500/20">
                <RotateCcw className="h-4 w-4 text-purple-500" />
                <AlertDescription className="text-purple-700 dark:text-purple-300">
                  This transaction has been refunded. Check the gateway dashboard for refund details.
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-close-transaction-dialog">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoicesTab() {
  const { data: invoicesData, isLoading } = useQuery<{ invoices: any[]; isReadOnlyAdmin: boolean }>({
    queryKey: ["/api/admin/transactions/invoices/all"],
  });
  const invoices = invoicesData?.invoices;
  const isReadOnlyAdmin = invoicesData?.isReadOnlyAdmin ?? false;
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [exportType, setExportType] = useState<"all" | "invoices" | "refunds">("all");
  const { toast } = useToast();

  const formatCurrency = (amount: number | string, currency: string = "USD") => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(num);
  };

  const handleDownload = async (invoiceId: string, invoiceNumber: string) => {
    setDownloadingId(invoiceId);
    try {
      const authHeader = AuthStorage.getAuthHeader();
      if (!authHeader) throw new Error("Authentication required");
      const response = await fetch(`/api/invoices/admin/${invoiceId}/download`, {
        headers: { Authorization: authHeader },
      });
      
      if (!response.ok) {
        throw new Error("Failed to download invoice");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice-${invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Invoice Downloaded",
        description: `Invoice ${invoiceNumber} has been downloaded`,
      });
    } catch (error: any) {
      toast({
        title: "Download Failed",
        description: error.message || "Failed to download invoice",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleBulkDownload = async () => {
    setBulkDownloading(true);
    try {
      const authHeader = AuthStorage.getAuthHeader();
      if (!authHeader) throw new Error("Authentication required");
      
      const params = new URLSearchParams();
      if (exportStartDate) params.append("startDate", exportStartDate);
      if (exportEndDate) params.append("endDate", exportEndDate);
      params.append("type", exportType);
      
      const response = await fetch(`/api/admin/transactions/export/zip?${params}`, {
        headers: { Authorization: authHeader },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to download documents");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      const contentDisposition = response.headers.get("Content-Disposition");
      const fileName = contentDisposition
        ? contentDisposition.split("filename=")[1]?.replace(/"/g, "")
        : `documents-export.zip`;
      
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Export Downloaded",
        description: "Documents have been downloaded as ZIP file",
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export documents",
        variant: "destructive",
      });
    } finally {
      setBulkDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bulk Export</CardTitle>
          <CardDescription>Download all invoices and refund notes as a ZIP file</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="export-type">Document Type</Label>
              <Select value={exportType} onValueChange={(v) => setExportType(v as "all" | "invoices" | "refunds")}>
                <SelectTrigger className="w-[180px]" data-testid="select-export-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Documents</SelectItem>
                  <SelectItem value="invoices">Invoices Only</SelectItem>
                  <SelectItem value="refunds">Refund Notes Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-start-date">From Date</Label>
              <Input
                id="export-start-date"
                type="date"
                value={exportStartDate}
                onChange={(e) => setExportStartDate(e.target.value)}
                className="w-[180px]"
                data-testid="input-export-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-end-date">To Date</Label>
              <Input
                id="export-end-date"
                type="date"
                value={exportEndDate}
                onChange={(e) => setExportEndDate(e.target.value)}
                className="w-[180px]"
                data-testid="input-export-end-date"
              />
            </div>
            <Button
              onClick={handleBulkDownload}
              disabled={bulkDownloading || isReadOnlyAdmin}
              data-testid="button-bulk-export"
            >
              {bulkDownloading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Export as ZIP
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Leave dates empty to export all documents. Only documents with generated PDFs will be included.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Invoices</CardTitle>
          <CardDescription>Generated invoices for completed transactions</CardDescription>
        </CardHeader>
        <CardContent>
        {invoices && invoices.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id} data-testid={`row-invoice-${invoice.id}`}>
                  <TableCell className="font-mono">{invoice.invoiceNumber}</TableCell>
                  <TableCell>{format(new Date(invoice.issuedAt), "MMM d, yyyy")}</TableCell>
                  <TableCell>
                    <div className="font-medium">{invoice.user?.name || invoice.customerName}</div>
                    <div className="text-xs text-muted-foreground">{invoice.user?.email || invoice.customerEmail}</div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{invoice.description}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(invoice.total, invoice.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        invoice.status === "paid"
                          ? "bg-green-500/10 text-green-700 border-green-500/30"
                          : invoice.status === "sent"
                          ? "bg-blue-500/10 text-blue-700 border-blue-500/30"
                          : "bg-gray-500/10 text-gray-700 border-gray-500/30"
                      }
                    >
                      {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {!isReadOnlyAdmin ? (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        title="Download PDF"
                        disabled={downloadingId === invoice.id}
                        onClick={() => handleDownload(invoice.id, invoice.invoiceNumber)}
                        data-testid={`button-download-invoice-${invoice.id}`}
                      >
                        {downloadingId === invoice.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No invoices generated yet</p>
            <p className="text-sm">Invoices will appear here after successful transactions</p>
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

interface Refund {
  id: string;
  transactionId: string;
  userId: string;
  amount: string;
  currency: string;
  reason: string | null;
  status: string;
  refundNoteNumber: string | null;
  pdfUrl: string | null;
  createdAt: string;
  user?: { id: string; name: string; email: string } | null;
  transaction?: { id: string; type: string; gateway: string; description: string } | null;
}

function RefundsTab() {
  const { data: refundsData, isLoading } = useQuery<Refund[]>({
    queryKey: ["/api/admin/refunds"],
  });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { toast } = useToast();

  const formatCurrency = (amount: number | string, currency: string = "USD") => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(num);
  };

  const handleDownloadRefundNote = async (refundId: string, refundNoteNumber: string | null) => {
    setDownloadingId(refundId);
    try {
      const authHeader = AuthStorage.getAuthHeader();
      if (!authHeader) throw new Error("Authentication required");
      const response = await fetch(`/api/admin/refunds/${refundId}/download`, {
        headers: { Authorization: authHeader },
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to download refund note" }));
        throw new Error(error.message || "Failed to download refund note");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RefundNote-${refundNoteNumber || refundId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Refund Note Downloaded",
        description: `Refund note ${refundNoteNumber || ""} has been downloaded`,
      });
    } catch (error: any) {
      toast({
        title: "Download Failed",
        description: error.message || "Failed to download refund note",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const completedRefunds = refundsData?.filter(r => r.status === 'completed') || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Refund Notes</CardTitle>
        <CardDescription>Download refund note PDFs for completed refunds</CardDescription>
      </CardHeader>
      <CardContent>
        {completedRefunds.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Refund Note #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {completedRefunds.map((refund) => (
                <TableRow key={refund.id} data-testid={`row-refund-${refund.id}`}>
                  <TableCell className="font-mono">
                    {refund.refundNoteNumber || "-"}
                  </TableCell>
                  <TableCell>{format(new Date(refund.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell>
                    <div className="font-medium">{refund.user?.name || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">{refund.user?.email || ""}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{refund.transaction?.gateway || ""}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                      {refund.reason || refund.transaction?.description || ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(refund.amount, refund.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="bg-green-500/10 text-green-700 border-green-500/30"
                    >
                      Completed
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      title="Download Refund Note PDF"
                      disabled={downloadingId === refund.id}
                      onClick={() => handleDownloadRefundNote(refund.id, refund.refundNoteNumber)}
                      data-testid={`button-download-refund-note-${refund.id}`}
                    >
                      {downloadingId === refund.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <RotateCcw className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No refund notes available</p>
            <p className="text-sm">Refund notes will appear here after completed refunds</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
