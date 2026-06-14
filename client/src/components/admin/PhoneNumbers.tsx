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
import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Loader2, Phone, Plus, Trash2, RefreshCw, UserPlus, Check, ChevronsUpDown, Users, KeyRound, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { AddSystemNumberDialog } from "./AddSystemNumberDialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PhoneNumber {
  id: string;
  phoneNumber: string;
  status: string;
  isSystemPool: boolean;
  userId?: string;
  userEmail?: string;
  userName?: string;
  purchasePrice?: number;
  monthlyPrice?: number;
  createdAt: string;
}

interface User {
  id: string;
  email: string;
  name?: string | null;
}

interface UserSearchResponse {
  users: User[];
  total: number;
  hasMore: boolean;
}

function PhoneStatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Active</Badge>;
  }
  if (status === 'inactive') {
    return <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Inactive</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

export default function PhoneNumbers() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [syncingToElevenLabs, setSyncingToElevenLabs] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [clearingSyncStatus, setClearingSyncStatus] = useState(false);
  const [resyncConfirmOpen, setResyncConfirmOpen] = useState(false);
  const [resyncingCredentials, setResyncingCredentials] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<PhoneNumber | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedUserLabel, setSelectedUserLabel] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(userSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearchQuery]);
  
  const { data: phoneNumbers, isLoading } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/admin/phone-numbers"],
  });

  const userSearchUrl = (() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    params.set('limit', '50');
    return `/api/admin/users/search?${params.toString()}`;
  })();

  const { data: userSearchResponse, isLoading: isSearchingUsers } = useQuery<UserSearchResponse>({
    queryKey: [userSearchUrl],
    enabled: userSearchOpen,
    staleTime: 30000,
  });
  
  const filteredUsers = userSearchResponse?.users || [];

  const getSelectedUserLabel = useCallback(() => {
    if (selectedUserId === "system_pool") {
      return "System Pool (Free Users)";
    }
    if (selectedUserLabel) {
      return selectedUserLabel;
    }
    return "Select user or system pool";
  }, [selectedUserId, selectedUserLabel]);

  const handleOpenAssignDialog = (phone: PhoneNumber) => {
    setSelectedPhone(phone);
    setSelectedUserId(phone.userId || "system_pool");
    if (phone.userId && phone.userEmail) {
      setSelectedUserLabel(phone.userEmail + (phone.userName ? ` (${phone.userName})` : ""));
    } else {
      setSelectedUserLabel("");
    }
    setAssignDialogOpen(true);
  };

  const handleAssign = async () => {
    if (!selectedPhone) return;
    
    setAssigning(true);
    try {
      const isSystemPool = selectedUserId === "system_pool";
      await apiRequest("PATCH", `/api/admin/phone-numbers/${selectedPhone.id}/assign`, {
        userId: isSystemPool ? null : selectedUserId,
        isSystemPool,
      });
      
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });
      
      toast({
        title: "Phone Number Assigned",
        description: isSystemPool 
          ? `${selectedPhone.phoneNumber} moved to system pool`
          : `${selectedPhone.phoneNumber} assigned to user`,
      });
      
      setAssignDialogOpen(false);
      setSelectedPhone(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to assign phone number",
        variant: "destructive",
      });
    } finally {
      setAssigning(false);
    }
  };

  const handleSyncToElevenLabs = async () => {
    setSyncingToElevenLabs(true);
    try {
      const response = await apiRequest("POST", "/api/admin/phone-numbers/sync-to-elevenlabs");
      const result: {
        total?: number;
        success?: number;
        failed?: number;
        successes?: string[];
        errors?: string[];
        message?: string;
      } = await response.json();

      const total = result.total || 0;
      const success = result.success || 0;
      const failed = result.failed || 0;

      // Invalidate phone numbers query to refresh the table
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });

      // Handle mixed outcomes
      if (success > 0 && failed > 0) {
        toast({
          title: "Partially Synced",
          description: `Synced ${success} of ${total} phone numbers to ElevenLabs. ${failed} failed. ${result.errors ? `Errors: ${result.errors.slice(0, 3).join(", ")}${result.errors.length > 3 ? "..." : ""}` : ""}`,
          variant: "default",
        });
      } else if (success > 0) {
        toast({
          title: "Sync Complete",
          description: `Successfully synced ${success} phone number${success > 1 ? "s" : ""} to ElevenLabs.`,
        });
      } else if (failed > 0) {
        toast({
          title: "Sync Failed",
          description: result.errors ? result.errors.join(", ") : `Failed to sync ${failed} phone numbers.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Already Synced",
          description: result.message || "All phone numbers are already synced to ElevenLabs.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to sync phone numbers to ElevenLabs",
        variant: "destructive",
      });
    } finally {
      setSyncingToElevenLabs(false);
    }
  };

  const handleCleanup = async () => {
    setCleaningUp(true);
    try {
      const response = await apiRequest("POST", "/api/admin/phone-numbers/cleanup");
      const result: {
        total?: number;
        removed?: number;
        kept?: number;
        removed_numbers?: string[];
        errors?: string[];
        message?: string;
      } = await response.json();

      const total = result.total || 0;
      const removed = result.removed || 0;
      const kept = result.kept || 0;

      // Invalidate phone numbers query to refresh the table
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });

      // Show results
      if (removed > 0) {
        toast({
          title: "Cleanup Complete",
          description: `Removed ${removed} orphaned phone number${removed > 1 ? "s" : ""} that no longer exist in Twilio. Kept ${kept} valid number${kept !== 1 ? "s" : ""}.`,
        });
      } else if (total > 0) {
        toast({
          title: "No Cleanup Needed",
          description: `All ${total} phone numbers are valid in Twilio.`,
        });
      } else {
        toast({
          title: "No Numbers Found",
          description: result.message || "No phone numbers in database.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to cleanup phone numbers",
        variant: "destructive",
      });
    } finally {
      setCleaningUp(false);
    }
  };

  const handleClearSyncStatus = async () => {
    setClearingSyncStatus(true);
    try {
      const response = await apiRequest("POST", "/api/admin/phone-numbers/clear-sync-status");
      const result: {
        total?: number;
        cleared?: number;
        message?: string;
      } = await response.json();

      const cleared = result.cleared || 0;

      // Invalidate phone numbers query to refresh the table
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });

      // Show success message
      if (cleared > 0) {
        toast({
          title: "Sync Status Cleared",
          description: result.message || `Cleared ElevenLabs sync status for ${cleared} phone number${cleared > 1 ? "s" : ""}. You can now sync them again.`,
        });
      } else {
        toast({
          title: "No Numbers Found",
          description: result.message || "No phone numbers in database.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to clear sync status",
        variant: "destructive",
      });
    } finally {
      setClearingSyncStatus(false);
    }
  };

  const handleReactivate = async (phone: PhoneNumber) => {
    setReactivatingId(phone.id);
    try {
      const response = await apiRequest("PATCH", `/api/admin/phone-numbers/${phone.id}/reactivate`);
      const result: { success?: boolean; message?: string; error?: string; resolution?: string } = await response.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });
      toast({
        title: "Phone Number Reactivated",
        description: result.message || `${phone.phoneNumber} has been reactivated successfully.`,
      });
    } catch (error: any) {
      // Try to extract the full descriptive message from the server JSON body
      let description = "Failed to reactivate phone number";
      const data = error?.data || error?.response?.data;
      if (data?.message) {
        description = data.message;
      } else if (data?.error) {
        description = data.error;
      } else if (error?.message) {
        description = error.message;
      }
      toast({
        title: "Cannot Reactivate",
        description,
        variant: "destructive",
      });
    } finally {
      setReactivatingId(null);
    }
  };

  const handleResyncCredentials = async () => {
    setResyncConfirmOpen(false);
    setResyncingCredentials(true);
    try {
      const response = await apiRequest("POST", "/api/admin/phone-numbers/resync-elevenlabs");
      const result: { synced?: number; failed?: number; errors?: string[]; message?: string } = await response.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });
      if ((result.failed ?? 0) > 0 && (result.synced ?? 0) > 0) {
        toast({
          title: "Partially Re-synced",
          description: result.message || `Re-synced ${result.synced} phone number(s). ${result.failed} failed.`,
          variant: "default",
        });
      } else if ((result.failed ?? 0) > 0) {
        toast({
          title: "Re-sync Failed",
          description: result.errors?.join(", ") || result.message || "Failed to re-sync credentials.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Credentials Re-synced",
          description: result.message || `Successfully re-synced ${result.synced} phone number(s) with fresh Twilio credentials.`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to re-sync Twilio credentials to ElevenLabs",
        variant: "destructive",
      });
    } finally {
      setResyncingCredentials(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const systemPoolNumbers = phoneNumbers?.filter(p => p.isSystemPool) || [];
  const userNumbers = phoneNumbers?.filter(p => !p.isSystemPool) || [];
  const totalPurchaseCost = systemPoolNumbers.reduce((sum, p) => sum + (parseFloat(p.purchasePrice as any) || 0), 0);
  const totalMonthlyCost = systemPoolNumbers.reduce((sum, p) => sum + (parseFloat(p.monthlyPrice as any) || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold">Phone Number Management</h2>
          <p className="text-muted-foreground text-sm md:text-base">
            Manage system pool and user phone numbers
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            onClick={handleCleanup} 
            variant="outline"
            disabled={cleaningUp}
            data-testid="button-cleanup-numbers"
          >
            {cleaningUp ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cleaning...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Cleanup Orphaned
              </>
            )}
          </Button>
          <Button 
            onClick={handleClearSyncStatus} 
            variant="outline"
            disabled={clearingSyncStatus}
            data-testid="button-clear-sync-status"
          >
            {clearingSyncStatus ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Clearing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Clear Sync Status
              </>
            )}
          </Button>
          <Button 
            onClick={handleSyncToElevenLabs} 
            variant="outline"
            disabled={syncingToElevenLabs}
            data-testid="button-sync-elevenlabs"
          >
            {syncingToElevenLabs ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <Phone className="h-4 w-4 mr-2" />
                Sync to ElevenLabs
              </>
            )}
          </Button>
          <Button
            onClick={() => setResyncConfirmOpen(true)}
            variant="outline"
            disabled={resyncingCredentials}
            data-testid="button-resync-twilio-credentials"
          >
            {resyncingCredentials ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Re-syncing...
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4 mr-2" />
                Re-sync Twilio Credentials
              </>
            )}
          </Button>
          <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-system-number">
            <Plus className="h-4 w-4 mr-2" />
            Add System Number
          </Button>
        </div>
      </div>

      <AddSystemNumberDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      <Dialog open={resyncConfirmOpen} onOpenChange={setResyncConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-sync Twilio Credentials to ElevenLabs</DialogTitle>
            <DialogDescription>
              This will re-register all ElevenLabs phone numbers with the current Twilio Account SID and Auth Token. Use this if campaigns are failing with "max auth retry attempts reached" after rotating Twilio credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            Each phone number will be briefly deleted from ElevenLabs and immediately re-registered with fresh credentials. Active calls may be disrupted.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResyncConfirmOpen(false)} data-testid="button-resync-cancel">
              Cancel
            </Button>
            <Button onClick={handleResyncCredentials} data-testid="button-resync-confirm">
              Re-sync Credentials
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignDialogOpen} onOpenChange={(open) => {
        setAssignDialogOpen(open);
        if (!open) {
          setUserSearchQuery("");
          setUserSearchOpen(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Phone Number</DialogTitle>
            <DialogDescription>
              Assign {selectedPhone?.phoneNumber} to a user or move to system pool
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Assign To</Label>
              <Popover open={userSearchOpen} onOpenChange={setUserSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={userSearchOpen}
                    className="w-full justify-between font-normal"
                    data-testid="select-assign-user"
                  >
                    <span className="truncate">{getSelectedUserLabel()}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput 
                      placeholder="Search by email or name..." 
                      value={userSearchQuery}
                      onValueChange={setUserSearchQuery}
                      data-testid="input-user-search"
                    />
                    <CommandList>
                      {!isSearchingUsers && <CommandEmpty>No users found.</CommandEmpty>}
                      <CommandGroup>
                        <CommandItem
                          value="system_pool"
                          onSelect={() => {
                            setSelectedUserId("system_pool");
                            setSelectedUserLabel("");
                            setUserSearchOpen(false);
                            setUserSearchQuery("");
                          }}
                          data-testid="option-system-pool"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedUserId === "system_pool" ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <Users className="mr-2 h-4 w-4" />
                          System Pool (Free Users)
                        </CommandItem>
                        {isSearchingUsers && (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            <span className="text-sm text-muted-foreground">Searching...</span>
                          </div>
                        )}
                        {!isSearchingUsers && filteredUsers.map((user) => (
                          <CommandItem
                            key={user.id}
                            value={user.id}
                            onSelect={() => {
                              setSelectedUserId(user.id);
                              setSelectedUserLabel(user.email + (user.name ? ` (${user.name})` : ""));
                              setUserSearchOpen(false);
                              setUserSearchQuery("");
                            }}
                            data-testid={`option-user-${user.id}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedUserId === user.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{user.email}</span>
                              {user.name && <span className="text-xs text-muted-foreground">{user.name}</span>}
                            </div>
                          </CommandItem>
                        ))}
                        {!isSearchingUsers && userSearchResponse?.hasMore && (
                          <div className="px-2 py-2 text-xs text-muted-foreground text-center border-t">
                            Type to search for more users ({userSearchResponse.total} total)
                          </div>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)} data-testid="button-cancel-assign">
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={assigning} data-testid="button-confirm-assign">
              {assigning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pool Size</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Array.isArray(systemPoolNumbers) ? systemPoolNumbers.length : 0}</div>
            <p className="text-xs text-muted-foreground">
              System phone numbers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalPurchaseCost.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              One-time purchase cost
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalMonthlyCost.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Recurring monthly cost
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="system" className="space-y-4">
        <TabsList>
          <TabsTrigger value="system">System Pool ({Array.isArray(systemPoolNumbers) ? systemPoolNumbers.length : 0})</TabsTrigger>
          <TabsTrigger value="user">User Numbers ({Array.isArray(userNumbers) ? userNumbers.length : 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="system">
          <div className="rounded-md border">
            <Table>
              <TableCaption>System phone numbers for free plan users</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Purchase Price</TableHead>
                  <TableHead>Monthly Price</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {systemPoolNumbers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">
                      No system phone numbers in pool
                    </TableCell>
                  </TableRow>
                ) : (
                  (Array.isArray(systemPoolNumbers) ? systemPoolNumbers : []).map((phone) => (
                    <TableRow key={phone.id}>
                      <TableCell className="font-mono">{phone.phoneNumber}</TableCell>
                      <TableCell>
                        <PhoneStatusBadge status={phone.status} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">System Pool</Badge>
                      </TableCell>
                      <TableCell>${phone.purchasePrice ? parseFloat(phone.purchasePrice as any).toFixed(2) : "0.00"}</TableCell>
                      <TableCell>${phone.monthlyPrice ? parseFloat(phone.monthlyPrice as any).toFixed(2) : "0.00"}</TableCell>
                      <TableCell>
                        {format(new Date(phone.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {phone.status === 'inactive' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReactivate(phone)}
                              disabled={reactivatingId === phone.id}
                              data-testid={`button-reactivate-${phone.id}`}
                            >
                              {reactivatingId === phone.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4 mr-1" />
                              )}
                              Reactivate
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenAssignDialog(phone)}
                            data-testid={`button-assign-${phone.id}`}
                          >
                            <UserPlus className="h-4 w-4 mr-1" />
                            Assign
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="user">
          <div className="rounded-md border">
            <Table>
              <TableCaption>Phone numbers purchased by Pro users</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Purchase Price</TableHead>
                  <TableHead>Monthly Price</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userNumbers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">
                      No user-purchased phone numbers
                    </TableCell>
                  </TableRow>
                ) : (
                  (Array.isArray(userNumbers) ? userNumbers : []).map((phone) => (
                    <TableRow key={phone.id} className={phone.status === 'inactive' ? 'bg-red-50/50 dark:bg-red-950/20' : undefined}>
                      <TableCell className="font-mono">{phone.phoneNumber}</TableCell>
                      <TableCell>
                        <PhoneStatusBadge status={phone.status} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{phone.userEmail || "Unknown"}</Badge>
                      </TableCell>
                      <TableCell>${phone.purchasePrice ? parseFloat(phone.purchasePrice as any).toFixed(2) : "0.00"}</TableCell>
                      <TableCell>${phone.monthlyPrice ? parseFloat(phone.monthlyPrice as any).toFixed(2) : "0.00"}</TableCell>
                      <TableCell>
                        {format(new Date(phone.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {phone.status === 'inactive' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReactivate(phone)}
                              disabled={reactivatingId === phone.id}
                              data-testid={`button-reactivate-${phone.id}`}
                            >
                              {reactivatingId === phone.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4 mr-1" />
                              )}
                              Reactivate
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenAssignDialog(phone)}
                            data-testid={`button-assign-${phone.id}`}
                          >
                            <UserPlus className="h-4 w-4 mr-1" />
                            Reassign
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}