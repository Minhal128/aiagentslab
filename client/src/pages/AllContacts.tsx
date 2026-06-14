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
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from 'react-i18next';
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataPagination, usePagination } from "@/components/ui/data-pagination";
import { Search, Users, Trash2, Phone, PhoneIncoming, PhoneOutgoing, Upload, Download } from "lucide-react";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DeduplicatedContact {
  id: string;
  phone: string;
  email: string | null;
  names: Array<{ firstName: string; lastName: string | null }>;
  campaigns: Array<{ id: string; name: string }>;
  status: string;
  source: 'campaign' | 'call';
  callCount: number;
}

export default function AllContacts() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingContact, setDeletingContact] = useState<DeduplicatedContact | null>(null);
  const { toast } = useToast();

  const { data: contacts = [], isLoading } = useQuery<DeduplicatedContact[]>({
    queryKey: ["/api/contacts/deduplicated"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/contacts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/deduplicated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setDeletingContact(null);
      toast({ title: "Contact deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete contact",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const exportToCSV = () => {
    if (contacts.length === 0) {
      toast({
        title: "No contacts to export",
        description: "Add some contacts before exporting",
        variant: "destructive",
      });
      return;
    }

    const headers = ["Phone", "Names", "Email", "Source", "Status", "Campaigns", "Call Count"];
    const rows = contacts.map(contact => [
      contact.phone,
      contact.names.map(n => `${n.firstName} ${n.lastName || ""}`).join("; "),
      contact.email || "",
      contact.source,
      contact.status,
      contact.campaigns.map(c => c.name).join("; "),
      String(contact.callCount || 0)
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contacts_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({ title: `Exported ${contacts.length} contacts to CSV` });
  };

  const filteredContacts = contacts.filter((contact) => {
    const searchLower = searchQuery.toLowerCase();
    const allNames = contact.names.map(n => `${n.firstName} ${n.lastName || ""}`).join(" ").toLowerCase();
    return (
      allNames.includes(searchLower) ||
      contact.phone.toLowerCase().includes(searchLower) ||
      contact.email?.toLowerCase().includes(searchLower)
    );
  });

  const {
    currentPage,
    totalPages,
    totalItems,
    itemsPerPage,
    paginatedItems,
    handlePageChange,
    handleItemsPerPageChange,
  } = usePagination(filteredContacts, 10);

  const campaignContactsCount = contacts.filter(c => c.source === 'campaign').length;
  const callOnlyContactsCount = contacts.filter(c => c.source === 'call').length;
  const totalCallCount = contacts.reduce((sum, c) => sum + (c.callCount || 0), 0);
  const campaignCount = new Set(contacts.flatMap(c => c.campaigns.map(camp => camp.id))).size;

  return (
    <div className="space-y-6">
      {/* Page Header with Light Gradient */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand/5 via-brand/3 to-brand/5 dark:from-brand/10 dark:via-brand/5 dark:to-brand/10 border border-brand/20 dark:border-brand/20 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand to-brand/90 flex items-center justify-center shadow-lg shadow-brand/25">
              <Users className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t('contacts.title')}</h1>
              <p className="text-muted-foreground mt-0.5">{t('contacts.description')}</p>
            </div>
          </div>
          <Button 
            onClick={exportToCSV}
            disabled={contacts.length === 0}
            className="bg-brand text-brand-foreground"
            data-testid="button-export-contacts"
          >
            <Download className="h-4 w-4 mr-2" />
            {t('contacts.exportContacts')}
          </Button>
        </div>
        
        {/* Stats Row */}
        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-brand/10">
            <div className="text-2xl font-bold text-brand" data-testid="text-total-contacts">{contacts.length}</div>
            <div className="text-brand/70 text-sm">{t('contacts.stats.uniqueContacts')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-800/30">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{campaignContactsCount}</div>
            </div>
            <div className="text-emerald-600/70 dark:text-emerald-400/70 text-sm">{t('contacts.stats.fromCampaigns')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-violet-100/50 dark:border-violet-800/30">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">{callOnlyContactsCount}</div>
            </div>
            <div className="text-violet-600/70 dark:text-violet-400/70 text-sm">{t('contacts.stats.fromCalls')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-cyan-100/50 dark:border-cyan-800/30">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-cyan-700 dark:text-cyan-300">{campaignCount}</div>
            </div>
            <div className="text-cyan-600/70 dark:text-cyan-400/70 text-sm">{t('contacts.stats.campaigns')}</div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('contacts.searchPlaceholder')}
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-testid="input-search-contacts"
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('contacts.fields.source')}</TableHead>
                <TableHead>{t('contacts.fields.names')}</TableHead>
                <TableHead>{t('contacts.fields.phone')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('contacts.fields.email')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('contacts.fields.campaigns')}</TableHead>
                <TableHead>{t('contacts.fields.status')}</TableHead>
                <TableHead className="w-[80px]">{t('contacts.fields.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {t('contacts.loading')}
                  </TableCell>
                </TableRow>
              ) : paginatedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {searchQuery ? t('contacts.noMatchingSearch') : t('contacts.noContacts')}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedItems.map((contact) => (
                  <TableRow key={contact.id} data-testid={`row-contact-${contact.id}`}>
                    <TableCell>
                      {contact.source === 'campaign' ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-700">
                          <Upload className="h-3 w-3 mr-1" />
                          {t('contacts.source.campaign')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-700">
                          {contact.status === 'incoming_call' ? (
                            <PhoneIncoming className="h-3 w-3 mr-1" />
                          ) : (
                            <PhoneOutgoing className="h-3 w-3 mr-1" />
                          )}
                          {t('contacts.source.call')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium" data-testid={`cell-names-${contact.id}`}>
                      {contact.names.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {contact.names.map((name, idx) => (
                            <div key={idx} className="text-sm">
                              {name.firstName} {name.lastName || ""}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">{t('contacts.unknown')}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{contact.phone}</TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">
                      {contact.email || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden lg:table-cell">
                      {contact.campaigns.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {contact.campaigns.map((campaign) => (
                            <Badge key={campaign.id} variant="secondary" className="text-xs">
                              {campaign.name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                          contact.status === "completed"
                            ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                            : contact.status === "pending"
                            ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400"
                            : contact.status === "incoming_call"
                            ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400"
                            : contact.status === "outgoing_call"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                            : "bg-gray-50 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400"
                        }`}
                      >
                        {contact.status === 'incoming_call' ? t('calls.filters.incoming') : 
                         contact.status === 'outgoing_call' ? t('calls.filters.outgoing') : contact.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {contact.source === 'campaign' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingContact(contact)}
                          data-testid={`button-delete-contact-${contact.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <DataPagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        itemsPerPage={itemsPerPage}
        onPageChange={handlePageChange}
        onItemsPerPageChange={handleItemsPerPageChange}
        showItemsPerPage={true}
      />

      <AlertDialog open={!!deletingContact} onOpenChange={() => setDeletingContact(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('contacts.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('contacts.deleteDialog.description', { name: deletingContact?.names.map(n => `${n.firstName} ${n.lastName || ""}`).join(", "), phone: deletingContact?.phone })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingContact && deleteMutation.mutate(deletingContact.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
