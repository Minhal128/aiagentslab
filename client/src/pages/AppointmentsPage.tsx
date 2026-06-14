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
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Calendar as CalendarIcon, Clock, Settings, ChevronLeft, ChevronRight,
  AlertCircle, CalendarDays, CalendarCheck, Phone, Mail, Briefcase,
  Timer, FileText, X, CheckCircle2, XCircle, RefreshCw, CalendarClock,
  Link2, Link2Off, Upload,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth,
  isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isToday,
  isBefore, isAfter, startOfDay, endOfDay,
} from "date-fns";

interface AppointmentMetadata {
  aiCollectedPhone?: string;
  verifiedPhone?: string;
  phoneDiscrepancy?: boolean;
  aiCollectedName?: string;
  verifiedName?: string;
}

interface Appointment {
  id: string;
  userId: string;
  callId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  appointmentDate: string;
  appointmentTime: string;
  scheduledFor: string;
  duration: number;
  serviceName: string | null;
  status: string;
  notes: string | null;
  statusReason: string | null;
  googleCalendarEventId: string | null;
  metadata: AppointmentMetadata | null;
  createdAt: string;
}

interface AppointmentSettings {
  id: string;
  userId: string;
  allowOverlap: boolean;
  bufferTime: number;
  maxPerDay: number | null;
  syncToGoogleCalendar: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: string[];
  createdAt: string;
  updatedAt: string;
}

interface CalendarStatus {
  connected: boolean;
  email?: string;
}

const defaultSettings: Partial<AppointmentSettings> = {
  allowOverlap: false,
  bufferTime: 15,
  maxPerDay: null,
  syncToGoogleCalendar: false,
  workingHoursStart: "09:00",
  workingHoursEnd: "17:00",
  workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
};

const STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled", icon: CalendarClock, color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  { value: "confirmed", label: "Confirmed", icon: CheckCircle2, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "completed", label: "Completed", icon: CalendarCheck, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { value: "rescheduled", label: "Rescheduled", icon: RefreshCw, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { value: "cancelled", label: "Cancelled", icon: XCircle, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
];

function getStatusConfig(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0];
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function AvatarColor(name: string) {
  const colors = [
    "bg-rose-500", "bg-pink-500", "bg-fuchsia-500", "bg-violet-500",
    "bg-blue-500", "bg-cyan-500", "bg-teal-500", "bg-emerald-500",
    "bg-amber-500", "bg-orange-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function StatusBadge({ status }: { status: string }) {
  const cfg = getStatusConfig(status);
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${cfg.color}`}
      data-testid={`badge-status-${status}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

interface UpdateStatusModalProps {
  appointment: Appointment | null;
  onClose: () => void;
}

function UpdateStatusModal({ appointment, onClose }: UpdateStatusModalProps) {
  const { toast } = useToast();
  const [newStatus, setNewStatus] = useState(appointment?.status ?? "scheduled");
  const [reason, setReason] = useState(appointment?.statusReason ?? "");

  useEffect(() => {
    if (appointment) {
      setNewStatus(appointment.status);
      setReason(appointment.statusReason ?? "");
    }
  }, [appointment]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/flow-automation/appointments/${appointment!.id}`, {
        status: newStatus,
        statusReason: reason.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/appointments"] });
      toast({ title: "Status updated successfully" });
      onClose();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    },
  });

  const needsReason = ["cancelled", "rescheduled", "completed"].includes(newStatus);

  return (
    <Dialog open={!!appointment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="text-update-status-title">Update Appointment Status</DialogTitle>
          <DialogDescription>
            Change the status for{" "}
            <span className="font-medium text-foreground">{appointment?.contactName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>New Status</Label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger data-testid="select-new-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {opt.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status-reason">
              {needsReason ? "Reason" : "Notes"}
              {!needsReason && <span className="text-muted-foreground text-xs ml-1">(optional)</span>}
            </Label>
            <Textarea
              id="status-reason"
              placeholder={
                newStatus === "cancelled"
                  ? "Why was this appointment cancelled?"
                  : newStatus === "rescheduled"
                  ? "Reason for rescheduling..."
                  : newStatus === "completed"
                  ? "Any completion notes..."
                  : "Optional notes..."
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none"
              rows={3}
              data-testid="textarea-status-reason"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-status">
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            data-testid="button-save-status"
          >
            {updateMutation.isPending ? "Saving..." : "Update Status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AppointmentCardProps {
  apt: Appointment;
  onUpdateStatus: (apt: Appointment) => void;
  calendarConnected?: boolean;
}

function AppointmentCard({ apt, onUpdateStatus, calendarConnected }: AppointmentCardProps) {
  const { toast } = useToast();
  const initials = getInitials(apt.contactName);
  const avatarColor = AvatarColor(apt.contactName);
  const scheduledDate = new Date(apt.scheduledFor);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/flow-automation/appointments/${apt.id}/sync-calendar`, {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Sync failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/appointments"] });
      toast({ title: "Synced to Google Calendar" });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const isSynced = !!apt.googleCalendarEventId;
  const canSync = calendarConnected && apt.status !== "cancelled";

  return (
    <Card className="hover-elevate" data-testid={`card-appointment-${apt.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <Avatar className="h-10 w-10 shrink-0 mt-0.5">
            <AvatarFallback className={`${avatarColor} text-white text-sm font-semibold`}>
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground" data-testid={`text-contact-name-${apt.id}`}>
                  {apt.contactName}
                </span>
                <StatusBadge status={apt.status} />
                {isSynced && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    title="Synced to Google Calendar"
                    data-testid={`badge-calendar-synced-${apt.id}`}
                  >
                    <CalendarIcon className="h-3 w-3" />
                    Calendar
                  </span>
                )}
                {apt.metadata?.phoneDiscrepancy && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-700 text-xs">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Phone mismatch
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <div className="text-right">
                  <div className="font-medium text-sm" data-testid={`text-scheduled-date-${apt.id}`}>
                    {format(scheduledDate, "MMM d, yyyy")}
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid={`text-scheduled-time-${apt.id}`}>
                    {format(scheduledDate, "h:mm a")}
                  </div>
                </div>
                {canSync && !isSynced && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    data-testid={`button-sync-calendar-${apt.id}`}
                    title="Sync to Google Calendar"
                  >
                    <Upload className="h-3.5 w-3.5 mr-1" />
                    Sync
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdateStatus(apt)}
                  data-testid={`button-update-status-${apt.id}`}
                >
                  Update Status
                </Button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />
                <span data-testid={`text-phone-${apt.id}`}>{apt.contactPhone}</span>
              </span>
              {apt.contactEmail && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  <span data-testid={`text-email-${apt.id}`}>{apt.contactEmail}</span>
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {apt.serviceName && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Briefcase className="h-3.5 w-3.5" />
                  <span data-testid={`text-service-${apt.id}`}>{apt.serviceName}</span>
                </span>
              )}
              <span className="flex items-center gap-1 text-muted-foreground">
                <Timer className="h-3.5 w-3.5" />
                <span data-testid={`text-duration-${apt.id}`}>{apt.duration} min</span>
              </span>
            </div>

            {apt.notes && (
              <div className="mt-2 flex gap-1.5 text-sm text-muted-foreground bg-muted/40 rounded-md p-2">
                <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span data-testid={`text-notes-${apt.id}`}>{apt.notes}</span>
              </div>
            )}

            {apt.statusReason && (
              <div className="mt-2 flex gap-1.5 text-sm bg-muted/40 rounded-md p-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reason: </span>
                  <span className="text-muted-foreground" data-testid={`text-status-reason-${apt.id}`}>
                    {apt.statusReason}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs">{description}</p>
    </div>
  );
}

export default function AppointmentsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const listRef = useRef<HTMLDivElement>(null);

  const [calendarView, setCalendarView] = useState<"day" | "week" | "month">("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState("upcoming");
  const [statusFilter, setStatusFilter] = useState("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsData, setSettingsData] = useState<Partial<AppointmentSettings>>(defaultSettings);
  const [updatingAppointment, setUpdatingAppointment] = useState<Appointment | null>(null);

  const { data: allAppointments = [], isLoading } = useQuery<Appointment[]>({
    queryKey: ["/api/flow-automation/appointments"],
  });

  const { data: settings } = useQuery<AppointmentSettings>({
    queryKey: ["/api/flow-automation/appointment-settings"],
  });

  const { data: calendarStatus, refetch: refetchCalendarStatus } = useQuery<CalendarStatus>({
    queryKey: ["/api/google-calendar/status"],
  });

  useEffect(() => {
    if (settings) setSettingsData(settings);
  }, [settings]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_calendar_connected") === "true") {
      toast({ title: "Google Calendar connected successfully" });
      refetchCalendarStatus();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        allowOverlap: settingsData.allowOverlap ?? false,
        bufferTime: settingsData.bufferTime ?? 15,
        maxPerDay: settingsData.maxPerDay ?? null,
        syncToGoogleCalendar: settingsData.syncToGoogleCalendar ?? false,
        workingHoursStart: settingsData.workingHoursStart || "09:00",
        workingHoursEnd: settingsData.workingHoursEnd || "17:00",
        workingDays: settingsData.workingDays || ["monday", "tuesday", "wednesday", "thursday", "friday"],
      };
      const res = await apiRequest("PUT", "/api/flow-automation/appointment-settings", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/appointment-settings"] });
      toast({ title: t("appointments.toast.settingsSaved") });
      setSettingsOpen(false);
    },
    onError: (error: any) => {
      toast({ title: t("appointments.toast.settingsFailed"), description: error.message, variant: "destructive" });
    },
  });

  const connectCalendarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/google-calendar/auth", undefined);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get authorization URL");
      return data as { url: string };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err: any) => {
      toast({ title: "Failed to connect Google Calendar", description: err.message, variant: "destructive" });
    },
  });

  const disconnectCalendarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/google-calendar/disconnect", undefined);
      if (!res.ok) throw new Error("Disconnect failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/status"] });
      setSettingsData((prev) => ({ ...prev, syncToGoogleCalendar: false }));
      toast({ title: "Google Calendar disconnected" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to disconnect", description: err.message, variant: "destructive" });
    },
  });

  const now = new Date();

  const getTabAppointments = (tab: string) => {
    switch (tab) {
      case "today":
        return allAppointments.filter((a) => isSameDay(new Date(a.scheduledFor), now));
      case "upcoming":
        return allAppointments.filter((a) => isAfter(new Date(a.scheduledFor), endOfDay(now)));
      case "past":
        return allAppointments.filter((a) => isBefore(new Date(a.scheduledFor), startOfDay(now)));
      default:
        return allAppointments;
    }
  };

  const getFilteredList = () => {
    let list = getTabAppointments(activeTab);

    if (statusFilter !== "all") {
      list = list.filter((a) => a.status === statusFilter);
    }

    if (selectedDate) {
      list = list.filter((a) => isSameDay(new Date(a.scheduledFor), selectedDate));
    }

    return list.sort((a, b) => {
      if (activeTab === "past") {
        return new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime();
      }
      return new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime();
    });
  };

  const filteredList = getFilteredList();

  const getAppointmentsForDate = (date: Date) =>
    allAppointments.filter((a) => isSameDay(new Date(a.scheduledFor), date));

  const getMonthDays = () => {
    const start = startOfWeek(startOfMonth(currentDate));
    const end = endOfWeek(endOfMonth(currentDate));
    return eachDayOfInterval({ start, end });
  };

  const handleDayClick = (day: Date) => {
    if (selectedDate && isSameDay(day, selectedDate)) {
      setSelectedDate(null);
    } else {
      setSelectedDate(day);
      setActiveTab("all");
      setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  };

  const toggleWorkingDay = (day: string) => {
    const workingDays = settingsData.workingDays || [];
    setSettingsData({
      ...settingsData,
      workingDays: workingDays.includes(day) ? workingDays.filter((d) => d !== day) : [...workingDays, day],
    });
  };

  const calendarDays = [
    { key: "sun", label: t("appointments.calendar.days.sun") },
    { key: "mon", label: t("appointments.calendar.days.mon") },
    { key: "tue", label: t("appointments.calendar.days.tue") },
    { key: "wed", label: t("appointments.calendar.days.wed") },
    { key: "thu", label: t("appointments.calendar.days.thu") },
    { key: "fri", label: t("appointments.calendar.days.fri") },
    { key: "sat", label: t("appointments.calendar.days.sat") },
  ];

  const workingDayOptions = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  const tabCounts = {
    all: allAppointments.length,
    today: allAppointments.filter((a) => isSameDay(new Date(a.scheduledFor), now)).length,
    upcoming: allAppointments.filter((a) => isAfter(new Date(a.scheduledFor), endOfDay(now))).length,
    past: allAppointments.filter((a) => isBefore(new Date(a.scheduledFor), startOfDay(now))).length,
  };

  const totalAppointments = allAppointments.length;
  const upcomingCount = allAppointments.filter((a) => isAfter(new Date(a.scheduledFor), endOfDay(now))).length;
  const completedCount = allAppointments.filter((a) => a.status === "completed").length;
  const cancelledCount = allAppointments.filter((a) => a.status === "cancelled").length;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t("appointments.loading")}</div>
      </div>
    );
  }

  const getEmptyState = () => {
    if (selectedDate) {
      return {
        icon: CalendarIcon,
        title: `No appointments on ${format(selectedDate, "MMMM d")}`,
        description: "There are no appointments scheduled for this day.",
      };
    }
    switch (activeTab) {
      case "today":
        return { icon: CalendarDays, title: "Nothing scheduled today", description: "No appointments are booked for today." };
      case "upcoming":
        return { icon: CalendarClock, title: "No upcoming appointments", description: "There are no future appointments scheduled yet. They'll show up here when your AI agent books them." };
      case "past":
        return { icon: CalendarCheck, title: "No past appointments", description: "Completed appointments will appear here." };
      default:
        return { icon: CalendarIcon, title: "No appointments yet", description: "Appointments booked by your AI agents will appear here." };
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-50 via-pink-100/50 to-red-50 dark:from-rose-950/40 dark:via-pink-900/30 dark:to-red-950/40 border border-rose-100 dark:border-rose-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/25">
              <CalendarDays className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground" data-testid="text-page-title">
                {t("appointments.title")}
              </h1>
              <p className="text-muted-foreground mt-0.5">{t("appointments.subtitle")}</p>
            </div>
          </div>
          <Button
            onClick={() => setSettingsOpen(true)}
            variant="outline"
            className="border-rose-200 dark:border-rose-800"
            data-testid="button-settings"
          >
            <Settings className="h-4 w-4 mr-2" />
            {t("common.settings")}
          </Button>
        </div>

        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-rose-100/50 dark:border-rose-800/30">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              <div className="text-2xl font-bold text-rose-700 dark:text-rose-300">{totalAppointments}</div>
            </div>
            <div className="text-rose-600/70 dark:text-rose-400/70 text-sm">{t("appointments.stats.total")}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-pink-100/50 dark:border-pink-800/30">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-pink-600 dark:text-pink-400" />
              <div className="text-2xl font-bold text-pink-700 dark:text-pink-300">{upcomingCount}</div>
            </div>
            <div className="text-pink-600/70 dark:text-pink-400/70 text-sm">{t("appointments.stats.upcoming")}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-800/30">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{completedCount}</div>
            </div>
            <div className="text-emerald-600/70 dark:text-emerald-400/70 text-sm">{t("appointments.stats.completed")}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-slate-100/50 dark:border-slate-700/30">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-slate-600 dark:text-slate-400" />
              <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{cancelledCount}</div>
            </div>
            <div className="text-slate-600/70 dark:text-slate-400/70 text-sm">{t("appointments.stats.cancelled")}</div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setCurrentDate(subMonths(currentDate, 1))} data-testid="button-prev-month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())} data-testid="button-today">
                {t("appointments.calendar.today")}
              </Button>
              <Button variant="outline" size="icon" onClick={() => setCurrentDate(addMonths(currentDate, 1))} data-testid="button-next-month">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <h2 className="text-lg font-semibold ml-1" data-testid="text-current-month">
                {format(currentDate, "MMMM yyyy")}
              </h2>
            </div>
            <Tabs value={calendarView} onValueChange={(v: any) => setCalendarView(v)}>
              <TabsList>
                <TabsTrigger value="day" data-testid="tab-day">{t("appointments.calendar.day")}</TabsTrigger>
                <TabsTrigger value="week" data-testid="tab-week">{t("appointments.calendar.week")}</TabsTrigger>
                <TabsTrigger value="month" data-testid="tab-month">{t("appointments.calendar.month")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {calendarView === "month" && (
            <div>
              <div className="grid grid-cols-7 mb-2">
                {calendarDays.map((day) => (
                  <div key={day.key} className="text-center text-xs font-semibold text-muted-foreground py-2 uppercase tracking-wide">
                    {day.label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {getMonthDays().map((day, index) => {
                  const dayApts = getAppointmentsForDate(day);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const isTodayDay = isToday(day);
                  const isSelected = selectedDate && isSameDay(day, selectedDate);

                  return (
                    <button
                      key={index}
                      type="button"
                      className={`min-h-20 p-1.5 border rounded-md text-left transition-colors cursor-pointer hover-elevate ${
                        !isCurrentMonth ? "opacity-40" : ""
                      } ${isTodayDay ? "border-rose-400 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-700" : "border-border"} ${
                        isSelected ? "border-primary bg-primary/10 ring-1 ring-primary" : ""
                      }`}
                      onClick={() => handleDayClick(day)}
                      data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                    >
                      <div className={`text-xs font-semibold mb-1 ${isTodayDay ? "text-rose-600 dark:text-rose-400" : ""} ${isSelected ? "text-primary" : ""}`}>
                        {format(day, "d")}
                      </div>
                      {dayApts.length > 0 && (
                        <div className="space-y-0.5">
                          {dayApts.slice(0, 2).map((apt) => {
                            const cfg = getStatusConfig(apt.status);
                            return (
                              <div
                                key={apt.id}
                                className={`text-xs px-1 py-0.5 rounded truncate ${cfg.color}`}
                                title={`${apt.contactName} — ${format(new Date(apt.scheduledFor), "h:mm a")}`}
                              >
                                {format(new Date(apt.scheduledFor), "h:mm a")}
                              </div>
                            );
                          })}
                          {dayApts.length > 2 && (
                            <div className="text-xs text-muted-foreground px-1">
                              +{dayApts.length - 2} more
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedDate && (
                <div className="mt-3 flex items-center gap-2 p-2 bg-primary/5 border border-primary/20 rounded-md">
                  <CalendarIcon className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">
                    Showing appointments for {format(selectedDate, "MMMM d, yyyy")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 ml-auto"
                    onClick={() => setSelectedDate(null)}
                    data-testid="button-clear-date-filter"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {calendarView === "week" && (
            <div className="text-center py-12 text-muted-foreground">
              {t("appointments.calendar.weekViewSoon")}
            </div>
          )}

          {calendarView === "day" && (
            <div className="text-center py-12 text-muted-foreground">
              {t("appointments.calendar.dayViewSoon")}
            </div>
          )}
        </CardContent>
      </Card>

      <div ref={listRef}>
        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSelectedDate(null); }}>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <TabsList data-testid="tabs-appointment-list">
              <TabsTrigger value="all" data-testid="tab-all">
                All
                <span className="ml-1.5 text-xs bg-muted-foreground/20 px-1.5 py-0.5 rounded-full">{tabCounts.all}</span>
              </TabsTrigger>
              <TabsTrigger value="today" data-testid="tab-today">
                Today
                {tabCounts.today > 0 && (
                  <span className="ml-1.5 text-xs bg-rose-500 text-white px-1.5 py-0.5 rounded-full">{tabCounts.today}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="upcoming" data-testid="tab-upcoming">
                Upcoming
                {tabCounts.upcoming > 0 && (
                  <span className="ml-1.5 text-xs bg-muted-foreground/20 px-1.5 py-0.5 rounded-full">{tabCounts.upcoming}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="past" data-testid="tab-past">
                Past
                {tabCounts.past > 0 && (
                  <span className="ml-1.5 text-xs bg-muted-foreground/20 px-1.5 py-0.5 rounded-full">{tabCounts.past}</span>
                )}
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-1.5 flex-wrap" data-testid="status-filter-chips">
              {["all", ...STATUS_OPTIONS.map((s) => s.value)].map((s) => {
                const isActive = statusFilter === s;
                const cfg = s !== "all" ? getStatusConfig(s) : null;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                      isActive
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover-elevate"
                    }`}
                    data-testid={`filter-status-${s}`}
                  >
                    {s === "all" ? "All Statuses" : cfg!.label}
                  </button>
                );
              })}
            </div>
          </div>

          {(["all", "today", "upcoming", "past"] as const).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-0">
              {filteredList.length === 0 ? (
                (() => {
                  const es = getEmptyState();
                  return <EmptyState icon={es.icon} title={es.title} description={es.description} />;
                })()
              ) : (
                <ScrollArea className="h-[600px]">
                  <div className="space-y-3 pr-3">
                    {filteredList.map((apt) => (
                      <AppointmentCard
                        key={apt.id}
                        apt={apt}
                        onUpdateStatus={setUpdatingAppointment}
                        calendarConnected={calendarStatus?.connected}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <UpdateStatusModal
        appointment={updatingAppointment}
        onClose={() => setUpdatingAppointment(null)}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-settings-title">{t("appointments.settings.title")}</DialogTitle>
            <DialogDescription>{t("appointments.settings.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-4">

              {/* Google Calendar Integration */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-blue-500" />
                  <Label className="text-base font-semibold">Google Calendar Integration</Label>
                </div>

                {calendarStatus?.connected ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Connected</span>
                        {calendarStatus.email && (
                          <span className="text-xs text-emerald-600/80 dark:text-emerald-400/80 ml-2">{calendarStatus.email}</span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => disconnectCalendarMutation.mutate()}
                        disabled={disconnectCalendarMutation.isPending}
                        data-testid="button-disconnect-calendar"
                        className="shrink-0"
                      >
                        <Link2Off className="h-3.5 w-3.5 mr-1" />
                        {disconnectCalendarMutation.isPending ? "Disconnecting..." : "Disconnect"}
                      </Button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Auto-sync new appointments</Label>
                        <p className="text-sm text-muted-foreground">
                          Automatically create Google Calendar events when AI books appointments
                        </p>
                      </div>
                      <Switch
                        checked={settingsData.syncToGoogleCalendar ?? false}
                        onCheckedChange={(checked) =>
                          setSettingsData({ ...settingsData, syncToGoogleCalendar: checked })
                        }
                        data-testid="switch-sync-google-calendar"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Connect your Google Calendar to automatically sync appointments booked by your AI agent.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => connectCalendarMutation.mutate()}
                      disabled={connectCalendarMutation.isPending}
                      data-testid="button-connect-calendar"
                    >
                      <Link2 className="h-4 w-4 mr-2" />
                      {connectCalendarMutation.isPending ? "Opening Google..." : "Connect Google Calendar"}
                    </Button>
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("appointments.settings.allowOverlap")}</Label>
                  <p className="text-sm text-muted-foreground">{t("appointments.settings.allowOverlapDescription")}</p>
                </div>
                <Switch
                  checked={settingsData.allowOverlap}
                  onCheckedChange={(checked) => setSettingsData({ ...settingsData, allowOverlap: checked })}
                  data-testid="switch-allow-overlap"
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="buffer-time">{t("appointments.settings.bufferTime")}</Label>
                <Input
                  id="buffer-time"
                  type="number"
                  value={settingsData.bufferTime}
                  onChange={(e) => setSettingsData({ ...settingsData, bufferTime: parseInt(e.target.value) || 0 })}
                  data-testid="input-buffer-time"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="max-per-day">{t("appointments.settings.maxPerDay")}</Label>
                <Input
                  id="max-per-day"
                  type="number"
                  placeholder={t("appointments.settings.maxPerDayPlaceholder")}
                  value={settingsData.maxPerDay || ""}
                  onChange={(e) =>
                    setSettingsData({ ...settingsData, maxPerDay: e.target.value ? parseInt(e.target.value) : null })
                  }
                  data-testid="input-max-per-day"
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>{t("appointments.settings.workingHours")}</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="hours-start">{t("appointments.settings.startTime")}</Label>
                    <Input
                      id="hours-start"
                      type="time"
                      value={settingsData.workingHoursStart}
                      onChange={(e) => setSettingsData({ ...settingsData, workingHoursStart: e.target.value })}
                      data-testid="input-hours-start"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hours-end">{t("appointments.settings.endTime")}</Label>
                    <Input
                      id="hours-end"
                      type="time"
                      value={settingsData.workingHoursEnd}
                      onChange={(e) => setSettingsData({ ...settingsData, workingHoursEnd: e.target.value })}
                      data-testid="input-hours-end"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>{t("appointments.settings.workingDays")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {workingDayOptions.map((day) => (
                    <div
                      key={day}
                      className={`p-3 border rounded-md cursor-pointer hover-elevate ${
                        settingsData.workingDays?.includes(day) ? "border-primary bg-primary/5" : ""
                      }`}
                      onClick={() => toggleWorkingDay(day)}
                      data-testid={`day-option-${day}`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-4 w-4 rounded border ${
                            settingsData.workingDays?.includes(day) ? "bg-primary border-primary" : "border-muted-foreground"
                          }`}
                        />
                        <span className="text-sm font-medium capitalize">{t(`appointments.settings.days.${day}`)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)} data-testid="button-cancel-settings">
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => saveSettingsMutation.mutate()}
              disabled={saveSettingsMutation.isPending}
              data-testid="button-save-settings"
            >
              {t("appointments.settings.saveSettings")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
