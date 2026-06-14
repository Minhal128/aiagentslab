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
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import Papa from "papaparse";
import { useToast } from "@/hooks/use-toast";
import { AuthStorage } from "@/lib/auth-storage";

interface AdminContact {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  customFields: any;
  status: string;
  createdAt: string;
  campaignId: string;
  campaignName: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}

interface PaginationData {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export default function AllContactsAdmin() {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ data: AdminContact[]; pagination: PaginationData }>({
    queryKey: [`/api/admin/contacts?page=${page}&pageSize=${pageSize}`],
  });

  const contacts = data?.data || [];
  const pagination = data?.pagination;

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const response = await apiRequest("GET", "/api/admin/contacts?page=1&pageSize=999999");
      if (!response.ok) {
        throw new Error("Failed to fetch contacts for export");
      }
      
      const result = await response.json();
      const allContacts = result.data;

      const csvData = (Array.isArray(allContacts) ? allContacts : []).map((contact: AdminContact) => ({
        "First Name": contact.firstName,
        "Last Name": contact.lastName || "",
        "Phone": contact.phone,
        "Email": contact.email || "",
        "Status": contact.status,
        "Campaign": contact.campaignName || "",
        "User Name": contact.userName || "",
        "User Email": contact.userEmail || "",
        "Created": contact.createdAt ? format(new Date(contact.createdAt), "yyyy-MM-dd HH:mm:ss") : "",
        "Custom Fields": contact.customFields ? JSON.stringify(contact.customFields) : ""
      }));

      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      
      link.setAttribute("href", url);
      link.setAttribute("download", `all-contacts-${format(new Date(), "yyyy-MM-dd-HHmmss")}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Successful",
        description: `Exported ${allContacts.length} contacts to CSV`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export contacts. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "pending":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "failed":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">All Contacts/Leads</h2>
        <p className="text-muted-foreground">
          Unique contacts by phone number (most recent record shown)
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Contacts Directory</CardTitle>
              <CardDescription>
                {pagination?.totalItems || 0} unique contacts across all users
              </CardDescription>
            </div>
            <Button
              onClick={handleExportCSV}
              disabled={isExporting || contacts.length === 0}
              data-testid="button-export-contacts"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="hidden lg:table-cell">Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Campaign</TableHead>
                  <TableHead className="hidden md:table-cell">User</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No contacts found
                    </TableCell>
                  </TableRow>
                ) : (
                  (Array.isArray(contacts) ? contacts : []).map((contact) => (
                    <TableRow key={contact.id} data-testid={`row-contact-${contact.id}`}>
                      <TableCell className="font-medium">
                        {contact.firstName} {contact.lastName || ""}
                      </TableCell>
                      <TableCell>{contact.phone}</TableCell>
                      <TableCell className="hidden lg:table-cell">{contact.email || "-"}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(contact.status)} variant="secondary">
                          {contact.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="max-w-[200px] truncate" title={contact.campaignName || "-"}>
                          {contact.campaignName || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="space-y-0.5">
                          <div className="text-sm font-medium">{contact.userName || "-"}</div>
                          <div className="text-xs text-muted-foreground">{contact.userEmail || "-"}</div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {contact.createdAt ? format(new Date(contact.createdAt), "MMM d, yyyy") : "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {pagination && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                {pagination.totalItems === 0 ? (
                  "No contacts"
                ) : (
                  <>
                    Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, pagination.totalItems)} of {pagination.totalItems} contacts
                  </>
                )}
              </div>
              {pagination.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <div className="text-sm">
                    Page {page} of {pagination.totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page === pagination.totalPages}
                    data-testid="button-next-page"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
