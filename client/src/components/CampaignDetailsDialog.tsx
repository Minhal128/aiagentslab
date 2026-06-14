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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, Phone, Loader2, User, Mail, PhoneCall } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AuthStorage } from "@/lib/auth-storage";

interface Contact {
  id: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone: string;
}

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  totalContacts: number;
  completedCalls: number;
}

interface CampaignDetailsDialogProps {
  campaign: Campaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CampaignDetailsDialog({ campaign, open, onOpenChange }: CampaignDetailsDialogProps) {
  const { toast } = useToast();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [testPhoneNumber, setTestPhoneNumber] = useState("");

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ["/api/campaigns", campaign?.id, "contacts"],
    enabled: open && !!campaign?.id,
  });

  const uploadContactsMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      
      const res = await fetch(`/api/campaigns/${campaign?.id}/contacts/upload`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to upload contacts");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaign?.id, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Contacts uploaded successfully!" });
      setCsvFile(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to upload contacts",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const testCallMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaign?.id}/test-call`, { 
        phoneNumber 
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ 
        title: "Test call initiated!", 
        description: `Calling ${testPhoneNumber}...` 
      });
      setTestPhoneNumber("");
    },
    onError: (error: any) => {
      toast({
        title: "Failed to initiate test call",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleUploadContacts = () => {
    if (!csvFile) {
      toast({
        title: "No file selected",
        description: "Please select a CSV file to upload",
        variant: "destructive",
      });
      return;
    }

    uploadContactsMutation.mutate(csvFile);
  };

  const handleTestCall = () => {
    if (!testPhoneNumber) {
      toast({
        title: "Phone number required",
        description: "Please enter a phone number for the test call",
        variant: "destructive",
      });
      return;
    }

    // Basic phone validation
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(testPhoneNumber.replace(/[\s-()]/g, ""))) {
      toast({
        title: "Invalid phone number",
        description: "Please enter a valid phone number (e.g., +1234567890)",
        variant: "destructive",
      });
      return;
    }

    testCallMutation.mutate(testPhoneNumber);
  };

  if (!campaign) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{campaign.name}</DialogTitle>
          <DialogDescription>
            View campaign details, manage contacts, and run test calls
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Campaign Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Type</div>
              <div className="text-lg font-semibold" data-testid="text-campaign-type">{campaign.type}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Total Contacts</div>
              <div className="text-lg font-semibold" data-testid="text-total-contacts">{campaign.totalContacts}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Completed</div>
              <div className="text-lg font-semibold" data-testid="text-completed-calls">{campaign.completedCalls}</div>
            </Card>
          </div>

          {/* Test Call Section */}
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Test Call
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Make a test call to verify your campaign configuration
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="+1234567890"
                  value={testPhoneNumber}
                  onChange={(e) => setTestPhoneNumber(e.target.value)}
                  data-testid="input-test-phone"
                />
              </div>
              <Button 
                onClick={handleTestCall} 
                disabled={testCallMutation.isPending}
                data-testid="button-test-call"
              >
                {testCallMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Calling...
                  </>
                ) : (
                  <>
                    <PhoneCall className="h-4 w-4 mr-2" />
                    Test Call
                  </>
                )}
              </Button>
            </div>
          </Card>

          {/* Add Contacts Section */}
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Add Contacts
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a CSV file with columns: firstName, lastName (optional), phone, email (optional). Legacy "name" column will be split automatically.
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  data-testid="input-csv-upload"
                />
              </div>
              <Button 
                onClick={handleUploadContacts} 
                disabled={!csvFile || uploadContactsMutation.isPending}
                data-testid="button-upload-contacts"
              >
                {uploadContactsMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload
                  </>
                )}
              </Button>
            </div>
          </Card>

          {/* Contacts List */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Contacts ({contacts.length})</h3>
            {contactsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : contacts.length === 0 ? (
              <Card className="p-8 text-center">
                <User className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No contacts yet. Upload a CSV to get started.</p>
              </Card>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {contacts.map((contact) => (
                  <Card key={contact.id} className="p-3 flex items-center gap-3" data-testid={`contact-${contact.id}`}>
                    <User className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="font-medium">{contact.firstName} {contact.lastName || ""}</div>
                      <div className="text-sm text-muted-foreground flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <PhoneCall className="h-3 w-3" />
                          {contact.phone}
                        </span>
                        {contact.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {contact.email}
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-details">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
