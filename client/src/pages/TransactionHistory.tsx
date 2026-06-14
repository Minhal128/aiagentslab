import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, FileText, Download, Receipt, Loader2, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Link } from "wouter";
import { AuthStorage } from "@/lib/auth-storage";
import { useToast } from "@/hooks/use-toast";

interface Transaction {
  id: string;
  type: string;
  gateway: string;
  amount: string;
  currency: string;
  description: string;
  status: string;
  planName: string | null;
  packageName: string | null;
  hasInvoice: boolean;
  invoiceId: string | null;
  invoiceNumber: string | null;
  hasRefund: boolean;
  refundId: string | null;
  refundNoteNumber: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface TransactionHistoryResponse {
  transactions: Transaction[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface TransactionHistoryProps {
  embedded?: boolean;
}

export default function TransactionHistory({ embedded = false }: TransactionHistoryProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [page, setPage] = useState(0);
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null);
  const [downloadingRefundNote, setDownloadingRefundNote] = useState<string | null>(null);
  const limit = 10;
  
  const { data, isLoading, isError } = useQuery<TransactionHistoryResponse>({
    queryKey: ['/api/transactions/history', { limit, offset: page * limit }],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      
      const response = await fetch(`/api/transactions/history?limit=${limit}&offset=${page * limit}`, {
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }
      return response.json();
    },
  });

  const handleDownloadInvoice = async (invoiceId: string, invoiceNumber?: string) => {
    setDownloadingInvoice(invoiceId);
    try {
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      
      const response = await fetch(`/api/invoices/${invoiceId}/download`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to download invoice' }));
        throw new Error(error.message || 'Failed to download invoice');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice-${invoiceNumber || invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: t('transactionHistory.invoiceDownloaded'),
        description: t('transactionHistory.invoiceDownloadedDesc'),
      });
    } catch (error: any) {
      toast({
        title: t('transactionHistory.downloadFailed'),
        description: error.message || 'Failed to download invoice',
        variant: 'destructive',
      });
    } finally {
      setDownloadingInvoice(null);
    }
  };

  const handleDownloadRefundNote = async (refundId: string, refundNoteNumber?: string) => {
    setDownloadingRefundNote(refundId);
    try {
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      
      const response = await fetch(`/api/refunds/${refundId}/download`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to download refund note' }));
        throw new Error(error.message || 'Failed to download refund note');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RefundNote-${refundNoteNumber || refundId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: t('transactionHistory.refundNoteDownloaded'),
        description: t('transactionHistory.refundNoteDownloadedDesc'),
      });
    } catch (error: any) {
      toast({
        title: t('transactionHistory.downloadFailed'),
        description: error.message || 'Failed to download refund note',
        variant: 'destructive',
      });
    } finally {
      setDownloadingRefundNote(null);
    }
  };

  const formatCurrency = (amount: string, currency: string) => {
    const currencySymbols: Record<string, string> = {
      'USD': '$', 'EUR': '€', 'GBP': '£', 'INR': '₹', 'BRL': 'R$',
      'NGN': '₦', 'GHS': '₵', 'ZAR': 'R', 'MXN': '$', 'ARS': '$',
    };
    const symbol = currencySymbols[currency] || currency + ' ';
    return `${symbol}${parseFloat(amount).toFixed(2)}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('transactionHistory.statusCompleted')}</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('transactionHistory.statusPending')}</Badge>;
      case 'failed':
        return <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{t('transactionHistory.statusFailed')}</Badge>;
      case 'refunded':
        return <Badge variant="secondary" className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400">{t('transactionHistory.statusRefunded')}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string, planName: string | null, packageName: string | null) => {
    if (type === 'subscription') {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
            {t('transactionHistory.typeSubscription')}
          </Badge>
          {planName && <span className="text-sm text-muted-foreground">{planName}</span>}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          {t('transactionHistory.typeCredits')}
        </Badge>
        {packageName && <span className="text-sm text-muted-foreground">{packageName}</span>}
      </div>
    );
  };

  const getGatewayLabel = (gateway: string) => {
    const labels: Record<string, string> = {
      'stripe': 'Stripe',
      'razorpay': 'Razorpay',
      'paypal': 'PayPal',
      'paystack': 'Paystack',
      'mercadopago': 'MercadoPago',
    };
    return labels[gateway] || gateway;
  };

  const totalPages = data ? Math.ceil(data.pagination.total / limit) : 0;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-slate-100/50 to-indigo-50 dark:from-slate-900/80 dark:via-slate-800/50 dark:to-indigo-950/40 border border-slate-200 dark:border-slate-700/50 p-6 md:p-8">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
            <CreditCard className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">{t('transactionHistory.errorTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('transactionHistory.errorDescription')}</p>
        </CardContent>
      </Card>
    );
  }

  const transactions = data?.transactions || [];

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-slate-100/50 to-indigo-50 dark:from-slate-900/80 dark:via-slate-800/50 dark:to-indigo-950/40 border border-slate-200 dark:border-slate-700/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-700 to-indigo-800 dark:from-slate-600 dark:to-indigo-700 flex items-center justify-center shadow-lg shadow-slate-500/25 dark:shadow-indigo-500/20">
              <Receipt className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t('transactionHistory.title')}</h1>
              <p className="text-muted-foreground mt-0.5">{t('transactionHistory.subtitle')}</p>
            </div>
          </div>
          {!embedded && (
            <Link href="/app/billing">
              <Button variant="outline" data-testid="button-back-to-billing">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('transactionHistory.backToBilling')}
              </Button>
            </Link>
          )}
        </div>

        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-4 border border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-slate-600 dark:text-slate-400" />
              <div className="text-2xl font-bold text-slate-700 dark:text-slate-200" data-testid="text-total-transactions">
                {data?.pagination.total || 0}
              </div>
            </div>
            <div className="text-slate-600/70 dark:text-slate-400/70 text-sm">{t('transactionHistory.totalTransactions')}</div>
          </div>
          <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-4 border border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-300" data-testid="text-invoices-available">
                {transactions.filter(tx => tx.hasInvoice).length}
              </div>
            </div>
            <div className="text-indigo-600/70 dark:text-indigo-400/70 text-sm">{t('transactionHistory.invoicesAvailable')}</div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            {t('transactionHistory.recentTransactions')}
          </CardTitle>
          <CardDescription>{t('transactionHistory.recentTransactionsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                <Receipt className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">{t('transactionHistory.emptyTitle')}</h3>
              <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
                {t('transactionHistory.emptyDescription')}
              </p>
              <Link href="/app/billing">
                <Button data-testid="button-view-plans">
                  {t('transactionHistory.viewPlans')}
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('transactionHistory.columnDate')}</TableHead>
                      <TableHead>{t('transactionHistory.columnType')}</TableHead>
                      <TableHead>{t('transactionHistory.columnDescription')}</TableHead>
                      <TableHead>{t('transactionHistory.columnAmount')}</TableHead>
                      <TableHead>{t('transactionHistory.columnGateway')}</TableHead>
                      <TableHead>{t('transactionHistory.columnStatus')}</TableHead>
                      <TableHead className="text-right">{t('transactionHistory.columnDocuments')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                        <TableCell className="font-mono text-sm">
                          {format(new Date(tx.createdAt), 'MMM d, yyyy')}
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(tx.createdAt), 'h:mm a')}
                          </div>
                        </TableCell>
                        <TableCell>{getTypeBadge(tx.type, tx.planName, tx.packageName)}</TableCell>
                        <TableCell className="max-w-xs truncate">{tx.description}</TableCell>
                        <TableCell className="font-mono font-medium">
                          {formatCurrency(tx.amount, tx.currency)}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{getGatewayLabel(tx.gateway)}</span>
                        </TableCell>
                        <TableCell>{getStatusBadge(tx.status)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            {tx.hasInvoice && tx.invoiceId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDownloadInvoice(tx.invoiceId!, tx.invoiceNumber || undefined)}
                                disabled={downloadingInvoice === tx.invoiceId}
                                data-testid={`button-download-invoice-${tx.id}`}
                              >
                                {downloadingInvoice === tx.invoiceId ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <FileText className="h-4 w-4 mr-1" />
                                )}
                                {t('transactionHistory.downloadInvoice')}
                              </Button>
                            )}
                            {tx.hasRefund && tx.refundId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDownloadRefundNote(tx.refundId!, tx.refundNoteNumber || undefined)}
                                disabled={downloadingRefundNote === tx.refundId}
                                data-testid={`button-download-refund-note-${tx.id}`}
                              >
                                {downloadingRefundNote === tx.refundId ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <Download className="h-4 w-4 mr-1" />
                                )}
                                {t('transactionHistory.downloadRefundNote')}
                              </Button>
                            )}
                            {!tx.hasInvoice && !tx.hasRefund && (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    {t('transactionHistory.pagination', { 
                      start: page * limit + 1, 
                      end: Math.min((page + 1) * limit, data?.pagination.total || 0),
                      total: data?.pagination.total || 0 
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      data-testid="button-previous-page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      {t('transactionHistory.previous')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => p + 1)}
                      disabled={!data?.pagination.hasMore}
                      data-testid="button-next-page"
                    >
                      {t('transactionHistory.next')}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
