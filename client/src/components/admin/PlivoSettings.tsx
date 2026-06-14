import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2, Phone, Key, Globe, Plus, Pencil, Trash2, CheckCircle2, RefreshCw, Users, UserPlus, Check, ChevronsUpDown } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PlivoCredential {
  id: string;
  name: string;
  authId: string;
  isPrimary: boolean;
  isActive: boolean;
  metadata: any;
  createdAt: string;
  updatedAt: string;
}

interface PhonePricing {
  id: string;
  countryCode: string;
  countryName: string;
  purchaseCredits: number;
  monthlyCredits: number;
  kycRequired: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function PlivoSettings() {
  const [activeTab, setActiveTab] = useState("credentials");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Plivo Settings
        </CardTitle>
        <CardDescription>
          Manage Plivo credentials and phone number pricing
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="credentials" data-testid="tab-plivo-credentials">
              <Key className="h-4 w-4 mr-2" />
              Plivo Credentials
            </TabsTrigger>
            <TabsTrigger value="pricing" data-testid="tab-phone-pricing">
              <Globe className="h-4 w-4 mr-2" />
              Phone Pricing
            </TabsTrigger>
            <TabsTrigger value="phone-numbers" data-testid="tab-plivo-phone-numbers">
              <Phone className="h-4 w-4 mr-2" />
              Phone Numbers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="credentials" className="mt-6">
            <PlivoCredentialsSection />
          </TabsContent>

          <TabsContent value="pricing" className="mt-6">
            <PhonePricingSection />
          </TabsContent>

          <TabsContent value="phone-numbers" className="mt-6">
            <PhoneNumbersSection />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

const addPlivoCredentialSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  authId: z.string().min(1, "Auth ID is required"),
  authToken: z.string().min(1, "Auth Token is required"),
  isPrimary: z.boolean(),
});

const editPlivoCredentialSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  isPrimary: z.boolean(),
});

type AddPlivoCredentialFormData = z.infer<typeof addPlivoCredentialSchema>;
type EditPlivoCredentialFormData = z.infer<typeof editPlivoCredentialSchema>;

function PlivoCredentialsSection() {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<PlivoCredential | null>(null);

  const addForm = useForm<AddPlivoCredentialFormData>({
    resolver: zodResolver(addPlivoCredentialSchema),
    defaultValues: {
      name: "",
      authId: "",
      authToken: "",
      isPrimary: false,
    },
  });

  const editForm = useForm<EditPlivoCredentialFormData>({
    resolver: zodResolver(editPlivoCredentialSchema),
    defaultValues: {
      name: "",
      isPrimary: false,
    },
  });

  const { data: credentials, isLoading } = useQuery<PlivoCredential[]>({
    queryKey: ["/api/plivo/admin/credentials"],
  });

  const addCredential = useMutation({
    mutationFn: async (data: AddPlivoCredentialFormData) => {
      return apiRequest("POST", "/api/plivo/admin/credentials", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/credentials"] });
      toast({ title: "Plivo credential added successfully" });
      setAddDialogOpen(false);
      addForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add credential",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updateCredential = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<PlivoCredential> }) => {
      return apiRequest("PATCH", `/api/plivo/admin/credentials/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/credentials"] });
      toast({ title: "Credential updated successfully" });
      setEditDialogOpen(false);
      setSelectedCredential(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update credential",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const deleteCredential = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/plivo/admin/credentials/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/credentials"] });
      toast({ title: "Credential deleted successfully" });
      setDeleteDialogOpen(false);
      setSelectedCredential(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete credential",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/plivo/admin/credentials/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/credentials"] });
      toast({ title: "Credential status updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update status",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const maskAuthId = (authId: string) => {
    if (!authId || authId.length < 8) return authId;
    return authId.slice(0, 4) + "..." + authId.slice(-4);
  };

  const openAddDialog = () => {
    addForm.reset({
      name: "",
      authId: "",
      authToken: "",
      isPrimary: false,
    });
    setAddDialogOpen(true);
  };

  const openEditDialog = (cred: PlivoCredential) => {
    setSelectedCredential(cred);
    editForm.reset({
      name: cred.name,
      isPrimary: cred.isPrimary,
    });
    setEditDialogOpen(true);
  };

  const anyMutationPending = addCredential.isPending || updateCredential.isPending || 
    deleteCredential.isPending || toggleActive.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Plivo Credentials</h3>
          <p className="text-sm text-muted-foreground">
            Manage Plivo account credentials for phone number provisioning
          </p>
        </div>
        <Button
          size="sm"
          onClick={openAddDialog}
          disabled={anyMutationPending}
          data-testid="button-add-plivo-credential"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Credential
        </Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Auth ID</TableHead>
              <TableHead>Primary</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!credentials || credentials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No Plivo credentials configured
                </TableCell>
              </TableRow>
            ) : (
              (Array.isArray(credentials) ? credentials : []).map((cred) => (
                <TableRow key={cred.id} data-testid={`row-plivo-${cred.id}`}>
                  <TableCell className="font-medium" data-testid={`text-plivo-name-${cred.id}`}>
                    {cred.name}
                  </TableCell>
                  <TableCell className="font-mono text-sm" data-testid={`text-auth-id-${cred.id}`}>
                    {maskAuthId(cred.authId)}
                  </TableCell>
                  <TableCell>
                    {cred.isPrimary && (
                      <Badge variant="secondary" className="text-blue-600 border-blue-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Primary
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {cred.isActive ? (
                      <Badge variant="secondary" className="text-green-600 border-green-600">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={cred.isActive}
                      onCheckedChange={(checked) => 
                        toggleActive.mutate({ id: cred.id, isActive: checked })
                      }
                      disabled={toggleActive.isPending || anyMutationPending}
                      data-testid={`switch-plivo-active-${cred.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(cred)}
                        disabled={anyMutationPending}
                        data-testid={`button-edit-plivo-${cred.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedCredential(cred);
                          setDeleteDialogOpen(true);
                        }}
                        disabled={anyMutationPending}
                        data-testid={`button-delete-plivo-${cred.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Plivo Credential</DialogTitle>
            <DialogDescription>
              Add a new Plivo account credential for phone number management.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit((data) => addCredential.mutate(data))} className="space-y-4 py-4">
              <FormField
                control={addForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., Main Account"
                        data-testid="input-plivo-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="authId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Auth ID</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Your Plivo Auth ID"
                        data-testid="input-plivo-auth-id"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="authToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Auth Token</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="Your Plivo Auth Token"
                        data-testid="input-plivo-auth-token"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="isPrimary"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-plivo-primary"
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-normal">
                      Set as primary credential
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={addCredential.isPending}
                  data-testid="button-save-plivo-credential"
                >
                  {addCredential.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Credential
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Plivo Credential</DialogTitle>
            <DialogDescription>
              Update the Plivo credential settings for "{selectedCredential?.name}".
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((data) => {
              if (selectedCredential) {
                updateCredential.mutate({ id: selectedCredential.id, updates: data });
              }
            })} className="space-y-4 py-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-edit-plivo-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2">
                <Label>Auth ID</Label>
                <Input
                  value={selectedCredential ? maskAuthId(selectedCredential.authId) : ""}
                  disabled
                  className="bg-muted font-mono"
                  data-testid="input-edit-plivo-auth-id"
                />
                <p className="text-xs text-muted-foreground">Auth ID cannot be changed</p>
              </div>
              <FormField
                control={editForm.control}
                name="isPrimary"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-edit-plivo-primary"
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-normal">
                      Set as primary credential
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateCredential.isPending}
                  data-testid="button-update-plivo-credential"
                >
                  {updateCredential.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Update
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedCredential?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCredential.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedCredential) {
                  deleteCredential.mutate(selectedCredential.id);
                }
              }}
              disabled={deleteCredential.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-plivo"
            >
              {deleteCredential.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const addPhonePricingSchema = z.object({
  countryCode: z.string().min(1, "Country code is required").max(3, "Country code too long"),
  countryName: z.string().min(1, "Country name is required").max(100, "Country name too long"),
  purchaseCredits: z.coerce.number().int().min(0),
  monthlyCredits: z.coerce.number().int().min(0),
  kycRequired: z.boolean(),
});

const editPhonePricingSchema = z.object({
  purchaseCredits: z.coerce.number().int().min(0),
  monthlyCredits: z.coerce.number().int().min(0),
  kycRequired: z.boolean(),
  isActive: z.boolean(),
});

type AddPhonePricingFormData = z.infer<typeof addPhonePricingSchema>;
type EditPhonePricingFormData = z.infer<typeof editPhonePricingSchema>;

function PhonePricingSection() {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPricing, setSelectedPricing] = useState<PhonePricing | null>(null);

  const addForm = useForm<AddPhonePricingFormData>({
    resolver: zodResolver(addPhonePricingSchema),
    defaultValues: {
      countryCode: "",
      countryName: "",
      purchaseCredits: 0,
      monthlyCredits: 0,
      kycRequired: false,
    },
  });

  const editForm = useForm<EditPhonePricingFormData>({
    resolver: zodResolver(editPhonePricingSchema),
    defaultValues: {
      purchaseCredits: 0,
      monthlyCredits: 0,
      kycRequired: false,
      isActive: true,
    },
  });

  const { data: pricing, isLoading } = useQuery<PhonePricing[]>({
    queryKey: ["/api/plivo/admin/phone-pricing"],
  });

  const addPricing = useMutation({
    mutationFn: async (data: AddPhonePricingFormData) => {
      return apiRequest("POST", "/api/plivo/admin/phone-pricing", {
        countryCode: data.countryCode.toUpperCase(),
        countryName: data.countryName,
        purchaseCredits: parseInt(String(data.purchaseCredits), 10),
        monthlyCredits: parseInt(String(data.monthlyCredits), 10),
        kycRequired: data.kycRequired,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/phone-pricing"] });
      toast({ title: "Phone pricing added successfully" });
      setAddDialogOpen(false);
      addForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add pricing",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updatePricing = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: EditPhonePricingFormData }) => {
      return apiRequest("PATCH", `/api/plivo/admin/phone-pricing/${id}`, {
        purchaseCredits: parseInt(String(updates.purchaseCredits), 10),
        monthlyCredits: parseInt(String(updates.monthlyCredits), 10),
        kycRequired: updates.kycRequired,
        isActive: updates.isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/phone-pricing"] });
      toast({ title: "Pricing updated successfully" });
      setEditDialogOpen(false);
      setSelectedPricing(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update pricing",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const deletePricing = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/plivo/admin/phone-pricing/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/phone-pricing"] });
      toast({ title: "Pricing deleted successfully" });
      setDeleteDialogOpen(false);
      setSelectedPricing(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete pricing",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/plivo/admin/phone-pricing/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/phone-pricing"] });
      toast({ title: "Pricing status updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update status",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const openAddDialog = () => {
    addForm.reset({
      countryCode: "",
      countryName: "",
      purchaseCredits: 0,
      monthlyCredits: 0,
      kycRequired: false,
    });
    setAddDialogOpen(true);
  };

  const openEditDialog = (p: PhonePricing) => {
    setSelectedPricing(p);
    editForm.reset({
      purchaseCredits: p.purchaseCredits,
      monthlyCredits: p.monthlyCredits,
      kycRequired: p.kycRequired,
      isActive: p.isActive,
    });
    setEditDialogOpen(true);
  };

  const anyMutationPending = addPricing.isPending || updatePricing.isPending || 
    deletePricing.isPending || toggleActive.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Phone Pricing</h3>
          <p className="text-sm text-muted-foreground">
            Configure per-country pricing for Plivo phone numbers
          </p>
        </div>
        <Button
          size="sm"
          onClick={openAddDialog}
          disabled={anyMutationPending}
          data-testid="button-add-pricing"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Pricing
        </Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country Code</TableHead>
              <TableHead>Country Name</TableHead>
              <TableHead>Purchase Credits</TableHead>
              <TableHead>Monthly Credits</TableHead>
              <TableHead>KYC Required</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!pricing || pricing.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No phone pricing configured
                </TableCell>
              </TableRow>
            ) : (
              (Array.isArray(pricing) ? pricing : []).map((p) => (
                <TableRow key={p.id} data-testid={`row-pricing-${p.id}`}>
                  <TableCell className="font-mono" data-testid={`text-country-code-${p.id}`}>
                    {p.countryCode}
                  </TableCell>
                  <TableCell data-testid={`text-country-name-${p.id}`}>
                    {p.countryName}
                  </TableCell>
                  <TableCell data-testid={`text-purchase-credits-${p.id}`}>
                    {p.purchaseCredits}
                  </TableCell>
                  <TableCell data-testid={`text-monthly-credits-${p.id}`}>
                    {p.monthlyCredits}
                  </TableCell>
                  <TableCell>
                    {p.kycRequired ? (
                      <Badge variant="secondary" className="text-yellow-600 border-yellow-600">
                        Required
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        No
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.isActive}
                      onCheckedChange={(checked) => 
                        toggleActive.mutate({ id: p.id, isActive: checked })
                      }
                      disabled={toggleActive.isPending || anyMutationPending}
                      data-testid={`switch-pricing-active-${p.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(p)}
                        disabled={anyMutationPending}
                        data-testid={`button-edit-pricing-${p.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedPricing(p);
                          setDeleteDialogOpen(true);
                        }}
                        disabled={anyMutationPending}
                        data-testid={`button-delete-pricing-${p.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Phone Pricing</DialogTitle>
            <DialogDescription>
              Configure pricing for a country's phone numbers.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit((data) => addPricing.mutate(data))} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addForm.control}
                  name="countryCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country Code</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="US"
                          maxLength={3}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                          data-testid="input-country-code"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addForm.control}
                  name="countryName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="United States"
                          data-testid="input-country-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addForm.control}
                  name="purchaseCredits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Credits</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          data-testid="input-purchase-credits"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addForm.control}
                  name="monthlyCredits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly Credits</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          data-testid="input-monthly-credits"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={addForm.control}
                name="kycRequired"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-kyc-required"
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-normal">
                      KYC Required
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={addPricing.isPending}
                  data-testid="button-save-pricing"
                >
                  {addPricing.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Pricing
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Phone Pricing</DialogTitle>
            <DialogDescription>
              Update pricing for {selectedPricing?.countryName} ({selectedPricing?.countryCode}).
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((data) => {
              if (selectedPricing) {
                updatePricing.mutate({ id: selectedPricing.id, updates: data });
              }
            })} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Country Code</Label>
                  <Input
                    value={selectedPricing?.countryCode || ""}
                    disabled
                    className="bg-muted font-mono"
                    data-testid="input-edit-country-code"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Country Name</Label>
                  <Input
                    value={selectedPricing?.countryName || ""}
                    disabled
                    className="bg-muted"
                    data-testid="input-edit-country-name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="purchaseCredits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Credits</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          data-testid="input-edit-purchase-credits"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="monthlyCredits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly Credits</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          data-testid="input-edit-monthly-credits"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={editForm.control}
                name="kycRequired"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-edit-kyc-required"
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-normal">
                      KYC Required
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-edit-is-active"
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-normal">
                      Active
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updatePricing.isPending}
                  data-testid="button-update-pricing"
                >
                  {updatePricing.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Update
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Pricing</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete pricing for "{selectedPricing?.countryName}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePricing.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedPricing) {
                  deletePricing.mutate(selectedPricing.id);
                }
              }}
              disabled={deletePricing.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-pricing"
            >
              {deletePricing.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface PlivoPhoneNumber {
  id: string;
  phoneNumber: string;
  country: string;
  region: string | null;
  numberType: string;
  status: string;
  userId: string | null;
  userEmail?: string;
  userName?: string;
  isSystemPool: boolean;
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

function PhoneNumbersSection() {
  const { toast } = useToast();
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<PlivoPhoneNumber | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedUserLabel, setSelectedUserLabel] = useState<string>("");
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(userSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearchQuery]);

  const { data: phoneNumbers, isLoading } = useQuery<PlivoPhoneNumber[]>({
    queryKey: ["/api/plivo/admin/phone-numbers"],
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

  const syncNumbers = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/plivo/admin/sync-numbers");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/phone-numbers"] });
      toast({ 
        title: "Sync Complete",
        description: `Imported ${data.imported} numbers, skipped ${data.skipped}`
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const assignNumber = useMutation({
    mutationFn: async ({ id, userId, isSystemPool }: { id: string; userId: string | null; isSystemPool: boolean }) => {
      return apiRequest("PATCH", `/api/plivo/admin/phone-numbers/${id}/assign`, {
        userId,
        isSystemPool,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/admin/phone-numbers"] });
      toast({ title: "Phone number assigned successfully" });
      setAssignDialogOpen(false);
      setSelectedPhone(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to assign phone number",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleOpenAssignDialog = (phone: PlivoPhoneNumber) => {
    setSelectedPhone(phone);
    setSelectedUserId(phone.userId || "system_pool");
    if (phone.userId && phone.userEmail) {
      setSelectedUserLabel(phone.userEmail + (phone.userName ? ` (${phone.userName})` : ""));
    } else {
      setSelectedUserLabel("");
    }
    setAssignDialogOpen(true);
  };

  const handleAssign = () => {
    if (!selectedPhone) return;
    const isSystemPool = selectedUserId === "system_pool";
    assignNumber.mutate({
      id: selectedPhone.id,
      userId: isSystemPool ? null : selectedUserId,
      isSystemPool,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold">Plivo Phone Numbers</h3>
          <p className="text-sm text-muted-foreground">
            Sync and manage phone numbers from your Plivo account
          </p>
        </div>
        <Button
          onClick={() => syncNumbers.mutate()}
          disabled={syncNumbers.isPending}
          data-testid="button-sync-plivo-numbers"
        >
          {syncNumbers.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync from Plivo
        </Button>
      </div>

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
                    data-testid="select-plivo-assign-user"
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
                      data-testid="input-plivo-user-search"
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
                          data-testid="option-plivo-system-pool"
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
                            data-testid={`option-plivo-user-${user.id}`}
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
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)} data-testid="button-plivo-cancel-assign">
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={assignNumber.isPending} data-testid="button-plivo-confirm-assign">
              {assignNumber.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phone Number</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assignment</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!phoneNumbers || phoneNumbers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No phone numbers found. Click "Sync from Plivo" to import numbers.
                </TableCell>
              </TableRow>
            ) : (
              (Array.isArray(phoneNumbers) ? phoneNumbers : []).map((num) => (
                <TableRow key={num.id} data-testid={`row-plivo-number-${num.id}`}>
                  <TableCell className="font-mono" data-testid={`text-phone-${num.id}`}>
                    {num.phoneNumber}
                  </TableCell>
                  <TableCell>{num.country}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{num.numberType}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={num.status === 'active' ? 'default' : 'secondary'}>
                      {num.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {num.isSystemPool ? (
                      <Badge variant="outline">
                        <Users className="h-3 w-3 mr-1" />
                        System Pool
                      </Badge>
                    ) : num.userId ? (
                      <Badge variant="secondary">{num.userEmail || "Assigned"}</Badge>
                    ) : (
                      <Badge variant="outline">Unassigned</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenAssignDialog(num)}
                      data-testid={`button-plivo-assign-${num.id}`}
                    >
                      <UserPlus className="h-4 w-4 mr-1" />
                      {num.userId || num.isSystemPool ? "Reassign" : "Assign"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
