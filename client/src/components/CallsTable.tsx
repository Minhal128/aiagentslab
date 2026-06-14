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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { Eye, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";

interface Call {
  serial?: number;
  id: string;
  contact: string;
  phone: string;
  campaign: string;
  duration: string;
  status: "completed" | "failed" | "calling";
  classification?: "hot" | "warm" | "cold";
  sentiment?: "positive" | "neutral" | "negative";
  timestamp: string;
}

interface CallsTableProps {
  calls: Call[];
  onViewTranscript?: (callId: string) => void;
  onDownloadRecording?: (callId: string) => void;
}

const sentimentColors = {
  positive: "text-success",
  neutral: "text-muted-foreground",
  negative: "text-destructive",
};

export function CallsTable({ calls, onViewTranscript, onDownloadRecording }: CallsTableProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-medium uppercase text-xs w-12">#</TableHead>
            <TableHead className="font-medium uppercase text-xs">Contact</TableHead>
            <TableHead className="font-medium uppercase text-xs">Campaign</TableHead>
            <TableHead className="font-medium uppercase text-xs">Duration</TableHead>
            <TableHead className="font-medium uppercase text-xs">Status</TableHead>
            <TableHead className="font-medium uppercase text-xs">Classification</TableHead>
            <TableHead className="font-medium uppercase text-xs">Sentiment</TableHead>
            <TableHead className="font-medium uppercase text-xs">Timestamp</TableHead>
            <TableHead className="font-medium uppercase text-xs text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-16 text-muted-foreground">
                No calls found
              </TableCell>
            </TableRow>
          ) : (
            calls.map((call, index) => (
              <TableRow 
                key={call.id} 
                data-testid={`row-call-${call.id}`}
                className="cursor-pointer hover-elevate"
                onClick={() => setLocation(`/app/calls/${call.id}`)}
              >
                <TableCell className="text-sm font-medium text-muted-foreground">
                  {call.serial || index + 1}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium" data-testid="text-contact-name">{call.contact}</span>
                    <span className="text-sm text-muted-foreground font-mono">{call.phone}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{call.campaign}</TableCell>
                <TableCell className="font-mono text-sm">{call.duration}</TableCell>
                <TableCell>
                  <StatusBadge status={call.status} />
                </TableCell>
                <TableCell>
                  {call.classification && <StatusBadge status={call.classification} />}
                </TableCell>
                <TableCell>
                  {call.sentiment && (
                    <span className={`text-sm capitalize ${sentimentColors[call.sentiment]}`}>
                      {call.sentiment}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{call.timestamp}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewTranscript?.(call.id);
                      }}
                      data-testid="button-view-transcript"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {call.status === "completed" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownloadRecording?.(call.id);
                        }}
                        data-testid="button-download-recording"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
