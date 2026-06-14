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
import { CallsTable } from "../CallsTable";

const mockCalls = [
  {
    id: "1",
    contact: "John Smith",
    phone: "+1 (555) 123-4567",
    campaign: "Q4 Lead Qualification",
    duration: "3:24",
    status: "completed" as const,
    classification: "warm" as const,
    sentiment: "positive" as const,
    timestamp: "2 hours ago",
  },
  {
    id: "2",
    contact: "Sarah Johnson",
    phone: "+1 (555) 234-5678",
    campaign: "Customer Feedback",
    duration: "1:45",
    status: "completed" as const,
    classification: "hot" as const,
    sentiment: "positive" as const,
    timestamp: "3 hours ago",
  },
  {
    id: "3",
    contact: "Mike Davis",
    phone: "+1 (555) 345-6789",
    campaign: "Q4 Lead Qualification",
    duration: "0:32",
    status: "failed" as const,
    timestamp: "5 hours ago",
  },
];

export default function CallsTableExample() {
  return (
    <div className="p-8">
      <CallsTable
        calls={mockCalls}
        onViewTranscript={(id) => console.log("View transcript:", id)}
        onDownloadRecording={(id) => console.log("Download recording:", id)}
      />
    </div>
  );
}
