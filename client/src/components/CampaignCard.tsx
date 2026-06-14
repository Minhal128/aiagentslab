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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, Status } from "./StatusBadge";
import { Progress } from "@/components/ui/progress";
import { MoreVertical, Play, Pause, BarChart3, Edit, Trash2, RotateCcw, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PhoneConflictDialog, PhoneConflictState, initialPhoneConflictState } from "./PhoneConflictDialog";

interface CampaignCardProps {
  id: string;
  name: string;
  type: string;
  status: Status;
  totalContacts: number;
  completedCalls: number;
  successRate?: number;
  schedule?: string;
  errorMessage?: string | null;
  errorCode?: string | null;
  retryEnabled?: boolean;
  currentRetryPass?: number;
  retryMaxAttempts?: number;
  onView?: () => void;
  onEdit?: () => void;
}

export function CampaignCard({
  id,
  name,
  type,
  status,
  totalContacts,
  completedCalls,
  successRate,
  schedule,
  errorMessage,
  errorCode,
  retryEnabled,
  currentRetryPass,
  retryMaxAttempts,
  onView,
  onEdit,
}: CampaignCardProps) {
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conflictDialog, setConflictDialog] = useState<PhoneConflictState>(initialPhoneConflictState);
  const progress = totalContacts > 0 ? (completedCalls / totalContacts) * 100 : 0;
  
  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${id}/execute`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign started successfully" });
    },
    onError: (error: any) => {
      // Check for phone conflict (409)
      if (error.status === 409 || error.conflictType) {
        setConflictDialog({
          isOpen: true,
          title: error.error || "Phone Number Conflict",
          message: error.message || error.error || "This phone number has a conflict.",
          conflictType: error.conflictType,
          connectedAgentName: error.connectedAgentName,
          campaignName: error.campaignName,
        });
        return;
      }
      
      toast({
        title: "Failed to start campaign",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${id}/stop`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign stopped successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to stop campaign",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${id}/resume`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign retry started successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to retry campaign",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/campaigns/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      setDeleteDialogOpen(false);
      toast({ title: "Campaign deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete campaign",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="p-6 hover-elevate relative overflow-hidden group" data-testid="card-campaign">
      {/* Subtle orange accent line at top */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-400 via-amber-500 to-orange-400" />
      
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-foreground truncate mb-1" data-testid="text-campaign-name">
            {name}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-orange-600 dark:text-orange-400 font-medium">{type}</span>
            <span className="text-muted-foreground">•</span>
            <StatusBadge status={status} />
            {retryEnabled && currentRetryPass !== undefined && currentRetryPass !== null && (
              <Badge
                variant="outline"
                className="bg-orange-500/10 text-orange-600 border-orange-500/30 text-xs"
                data-testid="badge-retry-pass-card"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Pass {currentRetryPass + 1}/{retryMaxAttempts ?? 3}
              </Badge>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-campaign-menu">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onView} data-testid="button-view-details">
              <BarChart3 className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            {onEdit && status !== "running" && status !== "completed" && status !== "in_progress" && (
              <DropdownMenuItem onClick={onEdit} data-testid="button-edit-campaign">
                <Edit className="mr-2 h-4 w-4" />
                Edit Campaign
              </DropdownMenuItem>
            )}
            {status === "running" && (
              <DropdownMenuItem 
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                data-testid="button-pause-campaign"
              >
                <Pause className="mr-2 h-4 w-4" />
                {stopMutation.isPending ? "Stopping..." : "Stop Campaign"}
              </DropdownMenuItem>
            )}
            {(status === "pending" || status === "draft" || status === "scheduled") && (
              <DropdownMenuItem 
                onClick={() => executeMutation.mutate()}
                disabled={executeMutation.isPending}
                data-testid="button-start-campaign"
              >
                <Play className="mr-2 h-4 w-4" />
                {executeMutation.isPending ? "Starting..." : "Start Campaign"}
              </DropdownMenuItem>
            )}
            {(status === "failed" || status === "paused") && (
              <DropdownMenuItem 
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
                data-testid="button-retry-campaign"
              >
                <RotateCcw className={`mr-2 h-4 w-4 ${retryMutation.isPending ? 'animate-spin' : ''}`} />
                {retryMutation.isPending ? "Retrying..." : "Retry Campaign"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem 
              onClick={() => setDeleteDialogOpen(true)}
              data-testid="button-delete-campaign"
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Campaign
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {schedule && status === "scheduled" && (
        <div className="text-sm text-muted-foreground mb-3">
          Scheduled: {schedule}
        </div>
      )}

      {status === "failed" && errorMessage && (
        <div className="mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/20" data-testid="error-message-container">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive" data-testid="text-error-title">
                {errorCode ? `Error: ${errorCode.replace(/_/g, ' ')}` : 'Campaign Failed'}
              </p>
              <p className="text-sm text-destructive/80 mt-1" data-testid="text-error-message">
                {errorMessage}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-mono font-medium" data-testid="text-progress">
            {completedCalls}/{totalContacts}
          </span>
        </div>
        <Progress value={progress} className="h-2 [&>div]:bg-gradient-to-r [&>div]:from-orange-400 [&>div]:to-amber-500" />

        {successRate !== undefined && (
          <div className="flex items-center justify-between text-sm pt-2 border-t">
            <span className="text-muted-foreground">Success Rate</span>
            <span className="font-mono font-semibold" data-testid="text-success-rate">
              {successRate}%
            </span>
          </div>
        )}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{name}"? This action cannot be undone. All campaign data, calls, and contacts will be preserved for historical access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PhoneConflictDialog
        open={conflictDialog.isOpen}
        onClose={() => setConflictDialog(initialPhoneConflictState)}
        title={conflictDialog.title}
        message={conflictDialog.message}
        conflictType={conflictDialog.conflictType}
        connectedAgentName={conflictDialog.connectedAgentName}
        campaignName={conflictDialog.campaignName}
      />
    </Card>
  );
}
