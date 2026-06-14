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
import { CampaignCard } from "../CampaignCard";

export default function CampaignCardExample() {
  return (
    <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <CampaignCard
        id="example-1"
        name="Q4 Lead Qualification Drive"
        type="Lead Qualification"
        status="in_progress"
        totalContacts={500}
        completedCalls={325}
        successRate={87.3}
        onView={() => console.log("View campaign")}
        onEdit={() => console.log("Edit campaign")}
      />
      <CampaignCard
        id="example-2"
        name="Customer Feedback Survey"
        type="Feedback Collection"
        status="pending"
        totalContacts={1000}
        completedCalls={0}
        onView={() => console.log("View campaign")}
        onEdit={() => console.log("Edit campaign")}
      />
      <CampaignCard
        id="example-3"
        name="Holiday Promotion 2024"
        type="Promotional"
        status="scheduled"
        totalContacts={2500}
        completedCalls={0}
        schedule="Dec 15, 2024 at 9:00 AM"
        onView={() => console.log("View campaign")}
      />
    </div>
  );
}
