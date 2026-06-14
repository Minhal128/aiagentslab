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
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Phone, CheckCircle2, XCircle, PhoneCall, PhoneIncoming, Clock, ExternalLink, FileText, MessageSquare, Layout, Activity } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { PhoneConflictDialog, PhoneConflictState, initialPhoneConflictState } from "./PhoneConflictDialog";
import { Separator } from "@/components/ui/separator";

interface TestFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
  flowName: string;
}

type QueueStatus = {
  status: 'waiting' | 'processing' | 'completed' | 'failed' | 'cancelled';
  position: number;
  ready: boolean;
  callId?: string;
  errorMessage?: string;
  message?: string;
};

const getCallProgress = (status: string, metadata?: any) => {
  const terminationReason = metadata?.terminationReason || metadata?.termination_reason || metadata?.failureReason;
  const isUserHangup = terminationReason === 'user_hung_up' || terminationReason === 'user hung up';

  const statusMap: Record<string, { label: string; progress: number; description: string; isComplete: boolean; isError: boolean }> = {
    "initiated": { label: "Initiating Call", progress: 20, description: "Call is being placed...", isComplete: false, isError: false },
    "queued": { label: "Call Queued", progress: 20, description: "Waiting to dial...", isComplete: false, isError: false },
    "ringing": { label: "Ringing", progress: 40, description: "Dialing number...", isComplete: false, isError: false },
    "in-progress": { label: "Call In Progress", progress: 70, description: "Call connected - testing flow...", isComplete: false, isError: false },
    "answered": { label: "Call Answered", progress: 70, description: "Call connected - testing flow...", isComplete: false, isError: false },
    "completed": { label: "Call Completed", progress: 100, description: "Test call finished successfully", isComplete: true, isError: false },
    "failed": { label: isUserHangup ? "Call Ended" : "Call Failed", progress: 100, description: isUserHangup ? "Call ended by user" : "The call could not be completed", isComplete: true, isError: true },
    "busy": { label: "Line Busy", progress: 100, description: "The phone number was busy", isComplete: true, isError: true },
    "no-answer": { label: "Call Disconnected", progress: 100, description: "Call was disconnected or not answered", isComplete: true, isError: true },
    "canceled": { label: "Call Canceled", progress: 100, description: "The call was canceled", isComplete: true, isError: true },
  };
  return statusMap[status] || { label: "Unknown", progress: 0, description: "Status unknown", isComplete: false, isError: true };
};

const formatDuration = (seconds: number | null | undefined) => {
  if (!seconds) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

const formatErrorDetail = (detail: string | null | undefined) => {
  if (!detail) return null;
  const lower = detail.toLowerCase();
  if (lower.includes('user_hung_up') || lower.includes('user hung up')) return "Call ended by user";
  if (lower.includes('agent_hung_up') || lower.includes('agent hung up')) return "Call ended by AI agent";
  if (lower.includes('user_silence_timeout')) return "Call ended due to silence";
  if (lower.includes('max_duration_reached')) return "Maximum call duration reached";
  if (lower.includes('eleven_labs_error')) return "Technical error from ElevenLabs";

  // Clean up underscores and capitalize
  return detail.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export function TestFlowDialog({ open, onOpenChange, flowId, flowName }: TestFlowDialogProps) {
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [testCallId, setTestCallId] = useState<string | null>(null);
  const [queueEntryId, setQueueEntryId] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState<PhoneConflictState>(initialPhoneConflictState);

  // Poll call status (active only once call is placed)
  const { data: callDetails } = useQuery<any>({
    queryKey: ["/api/calls", testCallId],
    enabled: !!testCallId,
    refetchInterval: (query) => {
      const data = query.state.data as any;
      const status = data?.status;

      // If completed but missing AI summary or transcript, keep polling for a few more seconds
      // as webhooks might still be processing the recording/analysis
      if (status === "completed" && (!data.aiSummary || !data.transcript)) {
        return 3000;
      }

      if (!status || ["completed", "failed", "busy", "no-answer", "canceled"].includes(status)) return false;
      return 2000;
    },
  });

  // Poll queue status (active while in queue and no call placed yet).
  // The server places the call server-side once the entry is claimed;
  // we just poll until we see 'completed' (→ callId) or 'failed'/'cancelled' (→ error).
  const { data: queueStatus } = useQuery<QueueStatus>({
    queryKey: ["/api/flow-automation/queue", queueEntryId],
    enabled: !!queueEntryId && !testCallId,
    refetchInterval: 5000,
  });

  // Cancel queue entry
  const cancelQueueMutation = useMutation({
    mutationFn: async (entryId: string) =>
      apiRequest("DELETE", `/api/flow-automation/queue/${entryId}`),
  });

  // Test call mutation (only for fresh user-initiated submissions — not re-submissions)
  const testMutation = useMutation({
    mutationFn: async () => {
      const digitsOnly = phoneNumber.replace(/\D/g, "");

      // Basic validation for length and country code
      if (digitsOnly.length === 0) {
        throw new Error("Please enter a phone number");
      }

      if (digitsOnly.length === 10) {
        throw new Error("Missing country code. Please include it (e.g., +1 for US, +91 for India)");
      }

      if (digitsOnly.length < 10) {
        throw new Error("Phone number is too short. Please include country code and at least 10 digits.");
      }

      const formattedPhone = `+${digitsOnly}`;
      const res = await apiRequest("POST", `/api/flow-automation/flows/${flowId}/test`, {
        phoneNumber: formattedPhone,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.queued === true) {
        // Added to queue — server will place call when a phone frees up
        setQueueEntryId(data.queueEntryId);
        return;
      }

      // Call placed immediately (phone was available)
      setTestCallId(data.callId);

      if (data.warning) {
        toast({ title: "Warning: Phone Number in Use", description: data.warning.message, variant: "destructive", duration: 8000 });
      }
      const isPartial = data.note || data.message?.includes("coming soon");
      toast({
        title: isPartial ? "Test Call Record Created" : "Test call initiated",
        description: isPartial
          ? "Call record created successfully."
          : "Your test call has been started. Check the Calls page to see the results.",
      });
    },
    onError: (error: any) => {
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

      const isNoPhoneNumbers = error.message?.includes("No active phone numbers");
      const isNotImplemented = error.message?.includes("not yet implemented") || error.message?.includes("501");
      const hasPlivoNumbers = error.hasPlivoNumbers === true;
      const isProviderMismatch = error.error?.includes("provider mismatch");

      let title = "Error starting test call";
      let description = error.message;
      if (isNoPhoneNumbers) { title = "No Phone Numbers"; description = "You need to purchase or rent a phone number before making test calls."; }
      else if (isNotImplemented) { title = "Feature Coming Soon"; description = "Test call functionality is currently under development."; }
      else if (hasPlivoNumbers || isProviderMismatch) { title = "Phone/Agent Mismatch"; description = error.suggestion ? `${error.message} ${error.suggestion}` : error.message; }

      toast({ title, description, variant: "destructive" });
    },
  });

  // React to queue status transitions (server places call; we poll until terminal)
  useEffect(() => {
    if (!queueStatus || testCallId) return;

    // ── Call placed successfully by server ─────────────────────────────────
    if (queueStatus.status === 'completed' && queueStatus.callId) {
      setQueueEntryId(null);
      setTestCallId(queueStatus.callId);
      toast({
        title: "Test call initiated",
        description: "Your test call has been started. Check the Calls page to see the results.",
      });
      return;
    }

    // ── Call placement failed ───────────────────────────────────────────────
    if (queueStatus.status === 'failed') {
      setQueueEntryId(null);
      toast({
        title: "Queue: Call Failed",
        description: queueStatus.errorMessage || "The test call could not be placed. Please try again.",
        variant: "destructive",
      });
      return;
    }

    // ── Queue entry cancelled (timeout or user action) ─────────────────────
    if (queueStatus.status === 'cancelled') {
      setQueueEntryId(null);
      toast({
        title: "Queue Expired",
        description: queueStatus.message || "Your queue position expired. Please try again.",
        variant: "destructive",
      });
      return;
    }
  }, [queueStatus, testCallId]);

  const handleCancelQueue = () => {
    if (queueEntryId) {
      cancelQueueMutation.mutate(queueEntryId);
      setQueueEntryId(null);
    }
  };

  const handleClose = () => {
    if (queueEntryId) {
      cancelQueueMutation.mutate(queueEntryId);
    }
    setPhoneNumber("");
    setTestCallId(null);
    setQueueEntryId(null);
    onOpenChange(false);
  };

  // Derived display state
  const isInQueue = !!queueEntryId && !testCallId;
  const queueIsProcessing = queueStatus?.status === 'processing';
  const queuePosition = queueStatus?.position ?? 1;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md max-h-[95vh] flex flex-col" data-testid="dialog-test-flow">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-primary" />
              Test Flow: {flowName}
            </DialogTitle>
            <DialogDescription>
              Place a real test call to validate your conversation flow works as expected
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto pr-2 py-2 -mr-2">
            {isInQueue ? (
              /* ── Queue waiting / processing view ── */
              <div className="space-y-4 py-4">
                <div className="flex flex-col items-center justify-center py-6 space-y-5">
                  <div className="rounded-full bg-yellow-100 dark:bg-yellow-900/20 p-4 relative">
                    <Clock className="w-12 h-12 text-yellow-600 dark:text-yellow-400" />
                    <div className="absolute -bottom-1 -right-1">
                      <Loader2 className="w-6 h-6 text-yellow-600 dark:text-yellow-400 animate-spin" />
                    </div>
                  </div>

                  <div className="text-center space-y-2">
                    <div className="font-semibold text-lg">
                      {queueIsProcessing ? "Connecting..." : "Waiting in Queue"}
                    </div>
                    {!queueIsProcessing && (
                      <div className="text-3xl font-bold text-primary" data-testid="text-queue-position">
                        #{queuePosition}
                      </div>
                    )}
                    <div className="text-sm text-muted-foreground" data-testid="text-queue-description">
                      {queueIsProcessing
                        ? "A phone number is available. Placing your call now..."
                        : "All shared phone numbers are currently in use. You will be connected automatically as soon as one becomes available."}
                    </div>
                  </div>
                </div>

                <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="font-medium">While you wait:</div>
                  <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                    <li>Your call will start automatically — no action needed</li>
                    <li>Estimated wait: under 2 minutes</li>
                    <li>You can cancel at any time</li>
                  </ul>
                </div>
              </div>
            ) : !testCallId ? (
              /* ── Phone number entry form ── */
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="test-phone">Phone Number *</Label>
                  <Input
                    id="test-phone"
                    type="tel"
                    placeholder="+1234567890"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    disabled={testMutation.isPending}
                    data-testid="input-test-phone"
                  />
                  <p className="text-xs text-muted-foreground">Include country code (e.g., +1 for USA)</p>
                </div>

                <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="font-medium">What happens when you test?</div>
                  <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                    <li>A real call will be placed to your phone number</li>
                    <li>The AI agent will execute your flow nodes in sequence</li>
                    <li>The call will be recorded and logged</li>
                    <li>You'll see the results in the Calls page</li>
                  </ul>
                </div>
              </div>
            ) : (
              /* ── Call in progress view ── */
              <div className="space-y-4 py-4">
                {(() => {
                  const status = callDetails?.status || "initiated";
                  const progress = getCallProgress(status, callDetails?.metadata);

                  // Extract diagnostic information for failures
                  const metadata = callDetails?.metadata || {};
                  const errorDetail = metadata.error || metadata.terminationReason || metadata.failureReason || callDetails?.errorMessage;
                  const hasAiSummary = !!callDetails?.aiSummary;
                  const hasTranscript = !!callDetails?.transcript;

                  return (
                    <div className="space-y-6">
                      <div className="flex flex-col items-center justify-center py-4 space-y-4">
                        {progress.isError ? (
                          <div className="rounded-full bg-red-100 dark:bg-red-900/20 p-4">
                            <XCircle className="w-12 h-12 text-red-600 dark:text-red-500" />
                          </div>
                        ) : progress.isComplete ? (
                          <div className="rounded-full bg-green-100 dark:bg-green-900/20 p-4">
                            <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-500" />
                          </div>
                        ) : (
                          <div className="rounded-full bg-blue-100 dark:bg-blue-900/20 p-4 relative">
                            {status === "ringing" ? (
                              <PhoneIncoming className="w-12 h-12 text-blue-600 dark:text-blue-500 animate-pulse" />
                            ) : (
                              <PhoneCall className="w-12 h-12 text-blue-600 dark:text-blue-500" />
                            )}
                            {!progress.isComplete && (
                              <div className="absolute -bottom-1 -right-1">
                                <Loader2 className="w-6 h-6 text-blue-600 dark:text-blue-500 animate-spin" />
                              </div>
                            )}
                          </div>
                        )}

                        <div className="text-center space-y-2">
                          <div className="font-semibold text-lg">{progress.label}</div>
                          <div className="text-sm text-muted-foreground">{progress.description}</div>
                          <div className="flex items-center justify-center gap-2">
                            <div className="text-xs font-mono bg-muted/50 px-3 py-1.5 rounded">
                              Call ID: {testCallId.substring(0, 12)}...
                            </div>
                            {callDetails?.duration !== undefined && (
                              <div className="text-xs font-medium bg-muted/50 px-3 py-1.5 rounded flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDuration(callDetails.duration)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Progress</span>
                          <span>{progress.progress}%</span>
                        </div>
                        <Progress value={progress.progress} className="h-2" data-testid="progress-call-status" />
                      </div>

                      {!progress.isComplete && (
                        <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm border">
                          <div className="font-medium flex items-center gap-2">
                            <Activity className="w-4 h-4 text-primary" />
                            What to expect:
                          </div>
                          <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                            {status === "initiated" || status === "queued" ? (
                              <><li>The call is being connected</li><li>Your phone will ring in a moment</li></>
                            ) : status === "ringing" ? (
                              <><li>Your phone should be ringing now</li><li>Answer to start the flow test</li></>
                            ) : (
                              <><li>The AI is executing your flow</li><li>Listen and respond to test it</li></>
                            )}
                          </ul>
                        </div>
                      )}

                      {progress.isComplete && (
                        <div className="space-y-4">
                          <div className={`rounded-lg p-4 space-y-3 text-sm border ${progress.isError
                            ? "bg-red-50/50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30"
                            : "bg-green-50/50 dark:bg-green-950/20 border-green-100 dark:border-green-900/30"
                            }`}>
                            <div className="flex items-center justify-between">
                              <div className={`font-semibold flex items-center gap-2 ${progress.isError ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"
                                }`}>
                                {progress.isError ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                                {progress.isError ? (errorDetail?.includes('user_hung_up') ? "Call Ended" : "Test Failed") : "Test Successfully Completed"}
                              </div>
                              {!progress.isError && (
                                <Badge variant="outline" className="bg-green-100/50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                                  Success
                                </Badge>
                              )}
                            </div>

                            {progress.isError ? (
                              <div className="space-y-2">
                                <p className="text-red-800/80 dark:text-red-200/80 leading-relaxed">
                                  {formatErrorDetail(errorDetail) || "The call could not be completed. This might be due to an incorrect phone number or insufficient credits."}
                                </p>
                                <Separator className="bg-red-200/50 dark:bg-red-800/50" />
                                <div className="text-xs font-medium">Next Steps:</div>
                                <ul className="space-y-1 list-disc list-inside opacity-80 text-red-800/70 dark:text-red-200/70">
                                  <li>Verify your phone number format (+123...)</li>
                                  <li>Check your credit balance in Billing</li>
                                  <li>Review the Execution Logs for error details</li>
                                </ul>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {hasAiSummary ? (
                                  <div className="bg-white/50 dark:bg-black/20 p-3 rounded-md border border-green-100/50 dark:border-green-900/30">
                                    <div className="text-xs font-semibold text-green-800/60 dark:text-green-200/60 uppercase tracking-wider mb-1 flex items-center gap-1">
                                      <MessageSquare className="w-3 h-3" />
                                      AI Summary
                                    </div>
                                    <p className="text-green-900/80 dark:text-green-100/80 italic leading-relaxed">
                                      "{callDetails.aiSummary}"
                                    </p>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 text-green-800/60 dark:text-green-200/60 animate-pulse">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span className="text-xs italic">Generating AI summary...</span>
                                  </div>
                                )}

                                <Separator className="bg-green-200/50 dark:bg-green-800/50" />

                                <div className="grid grid-cols-1 gap-2">
                                  <Link href={`/app/calls/${testCallId}`}>
                                    <a className="flex items-center justify-between p-2.5 rounded-md bg-white/40 dark:bg-black/20 hover:bg-white/80 dark:hover:bg-black/40 border border-green-100/30 dark:border-green-900/20 transition-colors group">
                                      <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-green-600 dark:text-green-400" />
                                        <span className="font-medium text-green-900 dark:text-green-100">View Transcript</span>
                                      </div>
                                      <ExternalLink className="w-3.5 h-3.5 text-green-600/50 dark:text-green-400/50 group-hover:text-green-600 transition-colors" />
                                    </a>
                                  </Link>

                                  <Link href={`/app/flows?tab=execution&callId=${testCallId}`}>
                                    <a className="flex items-center justify-between p-2.5 rounded-md bg-white/40 dark:bg-black/20 hover:bg-white/80 dark:hover:bg-black/40 border border-green-100/30 dark:border-green-900/20 transition-colors group">
                                      <div className="flex items-center gap-2">
                                        <Layout className="w-4 h-4 text-green-600 dark:text-green-400" />
                                        <span className="font-medium text-green-900 dark:text-green-100">Execution Analysis</span>
                                      </div>
                                      <ExternalLink className="w-3.5 h-3.5 text-green-600/50 dark:text-green-400/50 group-hover:text-green-600 transition-colors" />
                                    </a>
                                  </Link>
                                </div>
                              </div>
                            )}
                          </div>

                          {!progress.isError && !hasTranscript && (
                            <p className="text-center text-[10px] text-muted-foreground animate-pulse italic">
                              Finalizing call logs and synchronizing records...
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {isInQueue ? (
              <Button
                variant="outline"
                onClick={handleCancelQueue}
                disabled={cancelQueueMutation.isPending}
                data-testid="button-cancel-queue"
              >
                {cancelQueueMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Leave Queue
              </Button>
            ) : !testCallId ? (
              <>
                <Button variant="outline" onClick={handleClose} data-testid="button-cancel-test">
                  Cancel
                </Button>
                <Button
                  onClick={() => testMutation.mutate()}
                  disabled={!phoneNumber || testMutation.isPending}
                  data-testid="button-start-test"
                >
                  {testMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting Call...</>
                  ) : (
                    <><Phone className="w-4 h-4 mr-2" />Start Test Call</>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={handleClose} className="w-full" data-testid="button-close-success">
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PhoneConflictDialog
        open={conflictDialog.isOpen}
        onClose={() => setConflictDialog(initialPhoneConflictState)}
        title={conflictDialog.title}
        message={conflictDialog.message}
        conflictType={conflictDialog.conflictType}
        connectedAgentName={conflictDialog.connectedAgentName}
        campaignName={conflictDialog.campaignName}
      />
    </>
  );
}
