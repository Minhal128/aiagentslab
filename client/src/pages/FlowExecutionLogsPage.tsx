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
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Clock, Play, AlertCircle, ChevronRight, Activity, Phone, User, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

interface FlowExecution {
  id: string;
  callId: string;
  flowId: string;
  flowName?: string;
  currentNodeId: string | null;
  status: string;
  variables: Record<string, any>;
  pathTaken: string[];
  metadata: Record<string, any>;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  contactPhone?: string | null;
  contactName?: string | null;
  callStatus?: string | null;
  duration?: number | null;
  transcriptPreview?: string | null;
  aiSummary?: string | null;
}

export default function FlowExecutionLogsPage() {
  const [selectedExecution, setSelectedExecution] = useState<FlowExecution | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data: executions = [], isLoading, error } = useQuery<FlowExecution[]>({
    queryKey: ["/api/flow-automation/executions"],
  });

  const handleViewDetails = (execution: FlowExecution) => {
    setSelectedExecution(execution);
    setDetailsOpen(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Play className="h-4 w-4 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      completed: "default",
      failed: "destructive",
      running: "secondary",
    };
    return (
      <Badge variant={variants[status] || "secondary"} data-testid={`badge-status-${status}`}>
        {status}
      </Badge>
    );
  };

  const getDuration = (execution: FlowExecution) => {
    // Use API-provided duration if available (more accurate)
    if (execution.duration) {
      const durationSec = Math.floor(execution.duration);
      if (durationSec < 60) return `${durationSec}s`;
      const minutes = Math.floor(durationSec / 60);
      const seconds = durationSec % 60;
      return `${minutes}m ${seconds}s`;
    }
    // Fallback to calculated duration
    if (!execution.completedAt) return "In progress...";
    const start = new Date(execution.startedAt).getTime();
    const end = new Date(execution.completedAt).getTime();
    const durationSec = Math.floor((end - start) / 1000);
    if (durationSec < 60) return `${durationSec}s`;
    const minutes = Math.floor(durationSec / 60);
    const seconds = durationSec % 60;
    return `${minutes}m ${seconds}s`;
  };

  const formatPhoneNumber = (phone: string | null | undefined) => {
    if (!phone) return "Unknown";
    return phone;
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading execution logs...</div>
        </div>
      </div>
    );
  }

  const totalExecutions = executions.length;
  const completedCount = executions.filter(e => e.status === 'completed').length;
  const failedCount = executions.filter(e => e.status === 'failed').length;
  const runningCount = executions.filter(e => e.status === 'running').length;

  return (
    <div className="space-y-6">
      {/* Page Header with Slate/Gray Gradient */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-gray-100/50 to-zinc-50 dark:from-slate-950/40 dark:via-gray-900/30 dark:to-zinc-950/40 border border-slate-200 dark:border-slate-800/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-500 to-gray-600 flex items-center justify-center shadow-lg shadow-slate-500/25">
              <Activity className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground" data-testid="text-page-title">
                Flow Execution Logs
              </h1>
              <p className="text-muted-foreground mt-0.5">
                View detailed execution traces for all flow-based calls
              </p>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-slate-100/50 dark:border-slate-700/30">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-600 dark:text-slate-400" />
              <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{totalExecutions}</div>
            </div>
            <div className="text-slate-600/70 dark:text-slate-400/70 text-sm">Total Executions</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-800/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{completedCount}</div>
            </div>
            <div className="text-emerald-600/70 dark:text-emerald-400/70 text-sm">Completed</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-rose-100/50 dark:border-rose-800/30">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              <div className="text-2xl font-bold text-rose-700 dark:text-rose-300">{failedCount}</div>
            </div>
            <div className="text-rose-600/70 dark:text-rose-400/70 text-sm">Failed</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-blue-100/50 dark:border-blue-800/30">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{runningCount}</div>
            </div>
            <div className="text-blue-600/70 dark:text-blue-400/70 text-sm">Running</div>
          </div>
        </div>
      </div>

      {executions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Flow Executions Yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Flow execution logs will appear here when campaigns with visual flows make calls.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {executions.map((execution) => (
            <Card key={execution.id} className="hover-elevate">
              <CardHeader>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusIcon(execution.status)}
                      <CardTitle className="text-lg" data-testid={`text-flow-name-${execution.id}`}>
                        {execution.flowName || "Unknown Flow"}
                      </CardTitle>
                      {getStatusBadge(execution.status)}
                    </div>
                    <CardDescription className="flex items-center gap-3 flex-wrap">
                      {execution.contactPhone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5" />
                          {formatPhoneNumber(execution.contactPhone)}
                        </span>
                      )}
                      {execution.contactName && (
                        <span className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5" />
                          {execution.contactName}
                        </span>
                      )}
                      <span className="text-muted-foreground/70">
                        Started {format(new Date(execution.startedAt), "MMM d, yyyy h:mm a")}
                      </span>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/app/calls/${execution.callId}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-view-call-${execution.id}`}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View Call
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDetails(execution)}
                      data-testid={`button-view-details-${execution.id}`}
                    >
                      View Details
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Duration</div>
                    <div className="font-medium" data-testid={`text-duration-${execution.id}`}>
                      {getDuration(execution)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Data Collected</div>
                    <div className="font-medium" data-testid={`text-variables-count-${execution.id}`}>
                      {Object.keys(execution.variables || {}).length} fields
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Call Status</div>
                    <div className="font-medium capitalize" data-testid={`text-call-status-${execution.id}`}>
                      {execution.callStatus || execution.status}
                    </div>
                  </div>
                </div>

                {/* Collected Data Preview - Most Important */}
                {Object.keys(execution.variables || {}).length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="text-xs text-muted-foreground mb-2">Collected Data:</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(execution.variables || {}).slice(0, 4).map(([key, value]) => (
                        <Badge key={key} variant="outline" className="text-xs">
                          <span className="font-medium">{key}:</span>
                          <span className="ml-1 text-muted-foreground">{String(value).substring(0, 20)}{String(value).length > 20 ? '...' : ''}</span>
                        </Badge>
                      ))}
                      {Object.keys(execution.variables || {}).length > 4 && (
                        <Badge variant="secondary" className="text-xs">
                          +{Object.keys(execution.variables || {}).length - 4} more
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* AI Summary Preview */}
                {execution.aiSummary && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="text-xs text-muted-foreground mb-2">AI Summary:</div>
                    <div className="text-sm text-muted-foreground italic" data-testid={`text-summary-${execution.id}`}>
                      "{execution.aiSummary.length > 150 ? execution.aiSummary.substring(0, 150) + '...' : execution.aiSummary}"
                    </div>
                  </div>
                )}

                {execution.error && (
                  <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                      <div className="text-sm text-destructive" data-testid={`text-error-${execution.id}`}>
                        {execution.error}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">Execution Details</DialogTitle>
            <DialogDescription>
              Call outcomes, collected data, and AI-generated insights from this flow execution
            </DialogDescription>
          </DialogHeader>

          {selectedExecution && (
            <div className="space-y-6">
              {/* Summary with Contact Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Flow Name</div>
                  <div className="font-medium" data-testid="text-detail-flow-name">
                    {selectedExecution.flowName || "Unknown"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Status</div>
                  <div className="font-medium capitalize" data-testid="text-detail-status">
                    {selectedExecution.status}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Contact Phone</div>
                  <div className="font-medium flex items-center gap-1.5" data-testid="text-detail-phone">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatPhoneNumber(selectedExecution.contactPhone)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Contact Name</div>
                  <div className="font-medium flex items-center gap-1.5" data-testid="text-detail-name">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    {selectedExecution.contactName || "Unknown"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Started</div>
                  <div className="font-medium" data-testid="text-detail-started">
                    {format(new Date(selectedExecution.startedAt), "MMM d, yyyy h:mm:ss a")}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Duration</div>
                  <div className="font-medium" data-testid="text-detail-duration">
                    {getDuration(selectedExecution)}
                  </div>
                </div>
              </div>

              {/* AI Summary */}
              {selectedExecution.aiSummary && (
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="text-sm font-medium mb-2">AI Summary</div>
                  <div className="text-sm text-muted-foreground" data-testid="text-detail-summary">
                    {selectedExecution.aiSummary}
                  </div>
                </div>
              )}

              {/* Link to Call */}
              <div className="flex gap-2">
                <Link href={`/app/calls/${selectedExecution.callId}`}>
                  <Button variant="outline" size="sm" data-testid="button-detail-view-call">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View Full Call Details
                  </Button>
                </Link>
              </div>

              <Separator />

              {/* Variables Collected */}
              <div>
                <h3 className="font-semibold mb-4">Data Collected During Call</h3>
                {Object.keys(selectedExecution.variables || {}).length === 0 ? (
                  <div className="text-sm text-muted-foreground p-4 border rounded-md text-center">
                    No data was collected during this call execution
                  </div>
                ) : (
                  <ScrollArea className="h-48 border rounded-md">
                    <div className="p-4 space-y-2">
                      {Object.entries(selectedExecution.variables || {}).map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg"
                          data-testid={`variable-${key}`}
                        >
                          <div className="font-medium text-sm min-w-[140px] text-primary">
                            {key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()}
                          </div>
                          <div className="text-sm text-foreground flex-1">
                            {typeof value === "object" ? (
                              <pre className="text-xs bg-background rounded p-2 overflow-x-auto">
                                {JSON.stringify(value, null, 2)}
                              </pre>
                            ) : (
                              String(value) || <span className="text-muted-foreground italic">Empty</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>

              {selectedExecution.error && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-semibold mb-4 text-destructive">Error Details</h3>
                    <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                      <pre className="text-sm text-destructive whitespace-pre-wrap" data-testid="text-detail-error">
                        {selectedExecution.error}
                      </pre>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
