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
import { Badge } from "@/components/ui/badge";
import { Circle, Clock, CheckCircle2, XCircle, AlertCircle, AlertTriangle, Phone, PhoneOff } from "lucide-react";

export type Status = 
  | "pending" 
  | "in_progress" 
  | "completed" 
  | "failed" 
  | "credit_failed"
  | "warm" 
  | "cold" 
  | "hot" 
  | "calling"
  | "scheduled"
  | "draft"
  | "running"
  | "paused";

interface StatusBadgeProps {
  status: Status;
  label?: string;
}

const statusConfig = {
  pending: {
    icon: Clock,
    variant: "secondary" as const,
    label: "Pending",
  },
  in_progress: {
    icon: Phone,
    variant: "default" as const,
    label: "In Progress",
  },
  calling: {
    icon: Phone,
    variant: "default" as const,
    label: "Calling",
  },
  completed: {
    icon: CheckCircle2,
    variant: "secondary" as const,
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    variant: "destructive" as const,
    label: "Failed",
  },
  credit_failed: {
    icon: AlertTriangle,
    variant: "destructive" as const,
    label: "Not Billed - Low Credits",
  },
  scheduled: {
    icon: Clock,
    variant: "secondary" as const,
    label: "Scheduled",
  },
  warm: {
    icon: Circle,
    variant: "secondary" as const,
    label: "Warm Lead",
    color: "text-warning",
  },
  cold: {
    icon: Circle,
    variant: "secondary" as const,
    label: "Cold Lead",
    color: "text-info",
  },
  hot: {
    icon: Circle,
    variant: "secondary" as const,
    label: "Hot Lead",
    color: "text-destructive",
  },
  draft: {
    icon: Circle,
    variant: "outline" as const,
    label: "Draft",
  },
  running: {
    icon: Phone,
    variant: "default" as const,
    label: "Running",
  },
  paused: {
    icon: PhoneOff,
    variant: "secondary" as const,
    label: "Paused",
  },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status] || {
    icon: Circle,
    variant: "outline" as const,
    label: status,
  };
  const Icon = config.icon;
  const displayLabel = label || config.label;
  const iconColor = "color" in config ? config.color : "";

  return (
    <Badge variant={config.variant} className="gap-1.5" data-testid={`badge-status-${status}`}>
      <Icon className={`h-3 w-3 ${iconColor}`} />
      {displayLabel}
    </Badge>
  );
}
