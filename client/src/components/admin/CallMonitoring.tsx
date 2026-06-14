'use strict';
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Loader2, 
  Phone, 
  RefreshCw, 
  Search, 
  AlertTriangle, 
  Play, 
  Eye, 
  Shield, 
  ShieldOff,
  Clock,
  CheckCircle,
  XCircle,
  Ban,
  FileText,
  Calendar,
  User,
  PhoneCall,
  MessageSquare
} from "lucide-react";
import { format } from "date-fns";
import { Pagination } from "@/components/Pagination";

interface CallUser {
  id: string;
  name: string;
  email: string;
  blockedReason?: string | null;
  blockedAt?: string | null;
}

interface CallViolation {
  id: string;
  callId: string;
  userId: string;
  detectedWord: string;
  context?: string | null;
  severity: string;
  status: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  actionTaken?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface Call {
  id: string;
  userId: string;
  campaignId?: string | null;
  phoneNumber?: string | null;
  status: string;
  callDirection: string;
  duration?: number | null;
  recordingUrl?: string | null;
  elevenLabsConversationId?: string | null;
  twilioSid?: string | null;
  transcript?: string | null;
  aiSummary?: string | null;
  classification?: string | null;
  sentiment?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  user?: CallUser | null;
  campaign?: { id: string; name: string } | null;
  agent?: { id: string; name: string } | null;
  violationCount?: number;
  violations?: CallViolation[];
  violationSummary?: string | null;
}

interface PaginatedCallsResponse {
  data: Call[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/10 text-green-700 border-green-500/30",
  "in-progress": "bg-blue-500/10 text-blue-700 border-blue-500/30",
  pending: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
  failed: "bg-red-500/10 text-red-700 border-red-500/30",
  cancelled: "bg-gray-500/10 text-gray-700 border-gray-500/30",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
  medium: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  high: "bg-red-500/10 text-red-700 border-red-500/30",
  critical: "bg-red-700/20 text-red-800 border-red-700/50",
};

const VIOLATION_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
  reviewed: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  dismissed: "bg-gray-500/10 text-gray-700 border-gray-500/30",
  actioned: "bg-green-500/10 text-green-700 border-green-500/30",
};

export default function CallMonitoring() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [hasViolationsFilter, setHasViolationsFilter] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [userToBlock, setUserToBlock] = useState<CallUser | null>(null);
  const [recordingBlobUrl, setRecordingBlobUrl] = useState<string | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const recordingBlobUrlRef = useRef<string | null>(null);
  const [inlinePlayingCallId, setInlinePlayingCallId] = useState<string | null>(null);
  const [inlineAudioLoading, setInlineAudioLoading] = useState<string | null>(null);
  const inlineAudioRef = useRef<HTMLAudioElement | null>(null);
  const inlineAudioBlobUrlRef = useRef<string | null>(null);
  const currentInlinePlayingIdRef = useRef<string | null>(null);

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    params.append("page", page.toString());
    params.append("pageSize", pageSize.toString());
    if (searchTerm) params.append("userId", searchTerm);
    if (statusFilter !== "all") params.append("status", statusFilter);
    if (hasViolationsFilter) params.append("hasViolations", "true");
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    return params.toString();
  };

  const { data: response, isLoading, refetch } = useQuery<PaginatedCallsResponse>({
    queryKey: ["/api/admin/calls", page, pageSize, searchTerm, statusFilter, hasViolationsFilter, startDate, endDate],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/calls?${buildQueryParams()}`);
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const calls = response?.data || [];
  const pagination = response?.pagination || { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 };

  const { data: callDetails, isLoading: loadingDetails, refetch: refetchDetails } = useQuery<Call>({
    queryKey: ["/api/admin/calls", selectedCall?.id],
    queryFn: async () => {
      if (!selectedCall?.id) throw new Error("No call selected");
      const res = await apiRequest("GET", `/api/admin/calls/${selectedCall.id}`);
      return res.json();
    },
    enabled: !!selectedCall?.id && showDetailsDialog,
  });

  const { data: violations, isLoading: loadingViolations, refetch: refetchViolations } = useQuery<CallViolation[]>({
    queryKey: ["/api/admin/calls", selectedCall?.id, "violations"],
    queryFn: async () => {
      if (!selectedCall?.id) return [];
      const res = await apiRequest("GET", `/api/admin/calls/${selectedCall.id}/violations`);
      return res.json();
    },
    enabled: !!selectedCall?.id && showDetailsDialog,
  });

  useEffect(() => {
    // Clean up previous blob URL when switching calls or closing dialog
    if (recordingBlobUrlRef.current) {
      URL.revokeObjectURL(recordingBlobUrlRef.current);
      recordingBlobUrlRef.current = null;
      setRecordingBlobUrl(null);
    }

    if (!showDetailsDialog || !callDetails?.id) {
      setRecordingError(null);
      return;
    }

    if (!callDetails.recordingUrl) {
      setRecordingBlobUrl(null);
      setRecordingLoading(false);
      return;
    }

    let isCancelled = false;

    const fetchRecording = async () => {
      setRecordingLoading(true);
      setRecordingError(null);
      try {
        const response = await apiRequest("GET", `/api/admin/calls/${callDetails.id}/recording`);
        if (!response.ok) {
          throw new Error("Failed to fetch recording");
        }
        const blob = await response.blob();
        if (isCancelled) {
          return;
        }
        const url = URL.createObjectURL(blob);
        recordingBlobUrlRef.current = url;
        setRecordingBlobUrl(url);
      } catch (error: any) {
        if (isCancelled) return;
        console.error("Failed to fetch recording:", error);
        setRecordingError(error.message || "Failed to load recording");
      } finally {
        if (!isCancelled) {
          setRecordingLoading(false);
        }
      }
    };

    fetchRecording();

    return () => {
      isCancelled = true;
      if (recordingBlobUrlRef.current) {
        URL.revokeObjectURL(recordingBlobUrlRef.current);
        recordingBlobUrlRef.current = null;
      }
    };
  }, [showDetailsDialog, callDetails?.id, callDetails?.recordingUrl]);

  const scanForViolations = useMutation({
    mutationFn: async (callId: string) => {
      return apiRequest("POST", `/api/admin/calls/${callId}/scan`);
    },
    onSuccess: () => {
      toast({ title: "Scan completed", description: "Call transcript has been scanned for violations." });
      refetchViolations();
      refetch();
    },
    onError: (error: any) => {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
    },
  });

  const updateViolation = useMutation({
    mutationFn: async ({ violationId, status, notes }: { violationId: string; status: string; notes?: string }) => {
      return apiRequest("PATCH", `/api/admin/content-violations/${violationId}`, { status, notes });
    },
    onSuccess: () => {
      toast({ title: "Violation updated" });
      refetchViolations();
      refetch();
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const blockUser = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      return apiRequest("POST", `/api/admin/users/${userId}/block`, { reason });
    },
    onSuccess: () => {
      toast({ title: "User blocked", description: "User has been blocked from making calls." });
      setShowBlockDialog(false);
      setBlockReason("");
      setUserToBlock(null);
      refetch();
      refetchDetails();
    },
    onError: (error: any) => {
      toast({ title: "Block failed", description: error.message, variant: "destructive" });
    },
  });

  const unblockUser = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("POST", `/api/admin/users/${userId}/unblock`);
    },
    onSuccess: () => {
      toast({ title: "User unblocked", description: "User can now make calls again." });
      refetch();
      refetchDetails();
    },
    onError: (error: any) => {
      toast({ title: "Unblock failed", description: error.message, variant: "destructive" });
    },
  });

  const scanAllCallsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/banned-words/scan-all-calls");
    },
    onSuccess: async (response) => {
      const result = await response.json();
      toast({
        title: "Scan completed",
        description: `Scanned ${result.scannedCount || 0} calls. Found ${result.violationsFound || 0} violations.`,
      });
      refetch();
    },
    onError: (error: any) => {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
    },
  });

  const cleanupInlineAudio = () => {
    if (inlineAudioRef.current) {
      inlineAudioRef.current.pause();
      inlineAudioRef.current.currentTime = 0;
      inlineAudioRef.current = null;
    }
    if (inlineAudioBlobUrlRef.current) {
      URL.revokeObjectURL(inlineAudioBlobUrlRef.current);
      inlineAudioBlobUrlRef.current = null;
    }
    setInlinePlayingCallId(null);
    currentInlinePlayingIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      cleanupInlineAudio();
    };
  }, []);

  const handleInlinePlay = async (e: React.MouseEvent, call: Call) => {
    e.stopPropagation();
    
    if (inlinePlayingCallId === call.id) {
      cleanupInlineAudio();
      return;
    }

    cleanupInlineAudio();
    currentInlinePlayingIdRef.current = call.id;
    setInlineAudioLoading(call.id);
    
    try {
      const response = await apiRequest("GET", `/api/admin/calls/${call.id}/recording`);
      
      if (currentInlinePlayingIdRef.current !== call.id) {
        return;
      }
      
      if (!response.ok) throw new Error("Failed to fetch recording");
      const blob = await response.blob();
      
      if (currentInlinePlayingIdRef.current !== call.id) {
        return;
      }
      
      const url = URL.createObjectURL(blob);
      
      if (currentInlinePlayingIdRef.current !== call.id) {
        URL.revokeObjectURL(url);
        return;
      }
      
      inlineAudioBlobUrlRef.current = url;
      
      const audio = new Audio(url);
      inlineAudioRef.current = audio;
      
      const capturedUrl = url;
      audio.onended = () => {
        if (currentInlinePlayingIdRef.current === call.id) {
          setInlinePlayingCallId(null);
          inlineAudioRef.current = null;
        }
        URL.revokeObjectURL(capturedUrl);
        if (inlineAudioBlobUrlRef.current === capturedUrl) {
          inlineAudioBlobUrlRef.current = null;
        }
      };
      
      audio.onerror = () => {
        if (currentInlinePlayingIdRef.current === call.id) {
          setInlinePlayingCallId(null);
          inlineAudioRef.current = null;
        }
        URL.revokeObjectURL(capturedUrl);
      };
      
      await audio.play();
      setInlinePlayingCallId(call.id);
    } catch (error: any) {
      if (currentInlinePlayingIdRef.current === call.id) {
        setInlineAudioLoading(null);
      }
      toast({ title: "Playback failed", description: error.message, variant: "destructive" });
    } finally {
      if (currentInlinePlayingIdRef.current === call.id) {
        setInlineAudioLoading(null);
      }
    }
  };

  const hasRecording = (call: Call) => {
    return !!(call.recordingUrl || call.elevenLabsConversationId);
  };

  const handlePageChange = (newPage: number) => setPage(newPage);
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  };

  const handleViewCall = (call: Call) => {
    setSelectedCall(call);
    setShowDetailsDialog(true);
  };

  const handleOpenBlockDialog = (user: CallUser) => {
    setUserToBlock(user);
    setBlockReason("");
    setShowBlockDialog(true);
  };

  const handleConfirmBlock = () => {
    if (!userToBlock || !blockReason.trim()) return;
    blockUser.mutate({ userId: userToBlock.id, reason: blockReason });
  };

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatPhoneNumber = (phone?: string | null) => {
    if (!phone) return "—";
    return phone;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold" data-testid="text-call-monitoring-title">
            Call Monitoring
          </h2>
          <p className="text-muted-foreground text-sm md:text-base">
            Monitor calls and manage content violations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => scanAllCallsMutation.mutate()}
            disabled={scanAllCallsMutation.isPending}
            data-testid="button-scan-all-calls"
          >
            {scanAllCallsMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Scan All Calls
          </Button>
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-calls">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
          <CardDescription>Filter calls by various criteria</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <Label htmlFor="search" className="text-sm">Search User</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Email or user ID..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                  className="pl-9"
                  data-testid="input-search-calls"
                />
              </div>
            </div>

            <div>
              <Label className="text-sm">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="mt-1" data-testid="select-status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="startDate" className="text-sm">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="mt-1"
                data-testid="input-start-date"
              />
            </div>

            <div>
              <Label htmlFor="endDate" className="text-sm">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="mt-1"
                data-testid="input-end-date"
              />
            </div>

            <div className="flex items-end pb-1">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="hasViolations"
                  checked={hasViolationsFilter}
                  onCheckedChange={(checked) => { setHasViolationsFilter(checked === true); setPage(1); }}
                  data-testid="checkbox-has-violations"
                />
                <Label htmlFor="hasViolations" className="text-sm cursor-pointer flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Has Violations
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Phone className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No calls found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Call ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Violations</TableHead>
                    <TableHead>Recording</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(Array.isArray(calls) ? calls : []).map((call) => (
                    <TableRow key={call.id} data-testid={`row-call-${call.id}`}>
                      <TableCell className="font-mono text-xs">
                        {call.id.substring(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-medium">{call.user?.name || "Unknown"}</div>
                            <div className="text-xs text-muted-foreground">{call.user?.email}</div>
                          </div>
                          {call.user?.blockedAt && (
                            <Badge variant="destructive" className="text-xs">
                              <Ban className="h-3 w-3 mr-1" />
                              Blocked
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatPhoneNumber(call.phoneNumber)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[call.status] || ""}>
                          {call.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatDuration(call.duration)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{format(new Date(call.createdAt), "MMM d, yyyy")}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(call.createdAt), "HH:mm:ss")}</div>
                      </TableCell>
                      <TableCell>
                        {(call.violationCount || 0) > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Badge variant="destructive" className="gap-1 cursor-pointer" data-testid={`badge-violations-${call.id}`}>
                                  <AlertTriangle className="h-3 w-3" />
                                  {call.violationCount}
                                </Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="font-medium text-sm">Detected violations:</p>
                              <p className="text-xs mt-1">
                                {call.violationSummary || "Click to view call details for violation information"}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant="outline" className="text-green-600 border-green-300">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Clean
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {hasRecording(call) ? (
                          <Button
                            variant={inlinePlayingCallId === call.id ? "default" : "outline"}
                            size="sm"
                            onClick={(e) => handleInlinePlay(e, call)}
                            disabled={inlineAudioLoading === call.id}
                            data-testid={`button-play-recording-${call.id}`}
                            className="gap-1"
                          >
                            {inlineAudioLoading === call.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : inlinePlayingCallId === call.id ? (
                              <XCircle className="h-3 w-3" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            {inlinePlayingCallId === call.id ? "Stop" : "Play"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">No recording</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewCall(call)}
                          data-testid={`button-view-call-${call.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pagination
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        pageSize={pagination.pageSize}
        totalItems={pagination.totalItems}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />

      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5" />
              Call Details
            </DialogTitle>
            <DialogDescription>
              View call recording, transcript, and violation details
            </DialogDescription>
          </DialogHeader>

          {loadingDetails ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : callDetails ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-2">
              <div className="space-y-6 pb-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Badge variant="outline" className={STATUS_COLORS[callDetails.status] || ""}>
                      {callDetails.status}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Direction</Label>
                    <p className="font-medium capitalize">{callDetails.callDirection}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Duration</Label>
                    <p className="font-mono">{formatDuration(callDetails.duration)}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Phone</Label>
                    <p className="font-mono text-sm">{formatPhoneNumber(callDetails.phoneNumber)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <User className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{callDetails.user?.name || "Unknown User"}</p>
                      <p className="text-sm text-muted-foreground">{callDetails.user?.email}</p>
                    </div>
                    {callDetails.user?.blockedAt && (
                      <Badge variant="destructive">
                        <Ban className="h-3 w-3 mr-1" />
                        Blocked
                      </Badge>
                    )}
                  </div>
                  {callDetails.user && (
                    <div>
                      {callDetails.user.blockedAt ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unblockUser.mutate(callDetails.user!.id)}
                          disabled={unblockUser.isPending}
                          data-testid="button-unblock-user"
                        >
                          {unblockUser.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <ShieldOff className="h-4 w-4 mr-2" />
                          )}
                          Unblock User
                        </Button>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleOpenBlockDialog(callDetails.user!)}
                          data-testid="button-block-user"
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          Block User
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {callDetails.campaign && (
                  <div className="p-4 rounded-lg border">
                    <Label className="text-xs text-muted-foreground">Campaign</Label>
                    <p className="font-medium">{callDetails.campaign.name}</p>
                  </div>
                )}

                {callDetails.recordingUrl && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Play className="h-4 w-4" />
                      Recording
                    </Label>
                    {recordingLoading ? (
                      <div className="flex items-center gap-2 p-4 rounded-lg border bg-muted/50">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">Loading recording...</span>
                      </div>
                    ) : recordingError ? (
                      <div className="flex items-center gap-2 p-4 rounded-lg border bg-destructive/10 text-destructive">
                        <XCircle className="h-4 w-4" />
                        <span className="text-sm">{recordingError}</span>
                      </div>
                    ) : recordingBlobUrl ? (
                      <audio
                        controls
                        className="w-full"
                        src={recordingBlobUrl}
                        data-testid="audio-call-recording"
                      >
                        Your browser does not support the audio element.
                      </audio>
                    ) : (
                      <div className="p-4 rounded-lg border bg-muted/50 text-muted-foreground text-sm">
                        Recording not available
                      </div>
                    )}
                  </div>
                )}

                {callDetails.transcript && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Transcript
                    </Label>
                    <div className="p-4 rounded-lg border bg-muted/50 max-h-64 overflow-y-auto">
                      <pre className="whitespace-pre-wrap text-sm font-mono" data-testid="text-call-transcript">
                        {callDetails.transcript}
                      </pre>
                    </div>
                  </div>
                )}

                {callDetails.aiSummary && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      AI Summary
                    </Label>
                    <p className="text-sm p-4 rounded-lg border" data-testid="text-ai-summary">
                      {callDetails.aiSummary}
                    </p>
                  </div>
                )}

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2 text-base font-semibold">
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                      Violations ({violations?.length || 0})
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => scanForViolations.mutate(callDetails.id)}
                      disabled={scanForViolations.isPending || !callDetails.transcript}
                      data-testid="button-scan-violations"
                    >
                      {scanForViolations.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Search className="h-4 w-4 mr-2" />
                      )}
                      Scan Transcript
                    </Button>
                  </div>

                  {loadingViolations ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : violations && violations.length > 0 ? (
                    <div className="space-y-3">
                      {violations.map((violation) => (
                        <div
                          key={violation.id}
                          className="p-4 rounded-lg border space-y-3"
                          data-testid={`violation-${violation.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={SEVERITY_COLORS[violation.severity] || ""}>
                                {violation.severity}
                              </Badge>
                              <span className="font-mono font-bold text-red-600">
                                "{violation.detectedWord}"
                              </span>
                            </div>
                            <Badge variant="outline" className={VIOLATION_STATUS_COLORS[violation.status] || ""}>
                              {violation.status}
                            </Badge>
                          </div>

                          {violation.context && (
                            <p className="text-sm text-muted-foreground italic">
                              Context: "...{violation.context}..."
                            </p>
                          )}

                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateViolation.mutate({ violationId: violation.id, status: "reviewed" })}
                              disabled={updateViolation.isPending || violation.status === "reviewed"}
                              data-testid={`button-review-violation-${violation.id}`}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Mark Reviewed
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => updateViolation.mutate({ violationId: violation.id, status: "dismissed" })}
                              disabled={updateViolation.isPending || violation.status === "dismissed"}
                              data-testid={`button-dismiss-violation-${violation.id}`}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Dismiss
                            </Button>
                          </div>

                          {violation.reviewedAt && (
                            <p className="text-xs text-muted-foreground">
                              Reviewed: {format(new Date(violation.reviewedAt), "MMM d, yyyy HH:mm")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <CheckCircle className="h-8 w-8 mb-2 text-green-500" />
                      <p>No violations detected</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-12 text-muted-foreground">
              No call data available
            </div>
          )}

          <DialogFooter className="flex-shrink-0 mt-4 border-t pt-4">
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)} data-testid="button-close-details">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Shield className="h-5 w-5" />
              Block User
            </DialogTitle>
            <DialogDescription>
              Block {userToBlock?.name || userToBlock?.email} from making calls. This action can be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="blockReason">Reason for blocking *</Label>
              <Textarea
                id="blockReason"
                placeholder="e.g., Content violation: banned words detected in call transcript"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="mt-1"
                rows={3}
                data-testid="input-block-reason"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBlockDialog(false)} data-testid="button-cancel-block">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmBlock}
              disabled={blockUser.isPending || !blockReason.trim()}
              data-testid="button-confirm-block"
            >
              {blockUser.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Ban className="h-4 w-4 mr-2" />
              )}
              Block User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
