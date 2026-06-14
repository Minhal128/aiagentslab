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
import { MetricCard } from "../MetricCard";
import { Phone, Users, Clock, TrendingUp } from "lucide-react";

export default function MetricCardExample() {
  return (
    <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <MetricCard
        title="Total Calls"
        value="12,543"
        icon={Phone}
        trend={{ value: 12.5, direction: "up" }}
      />
      <MetricCard
        title="Success Rate"
        value="87.3%"
        icon={TrendingUp}
        trend={{ value: 5.2, direction: "up" }}
      />
      <MetricCard
        title="Warm Leads"
        value="1,842"
        icon={Users}
        trend={{ value: 8.1, direction: "up" }}
      />
      <MetricCard
        title="Avg Duration"
        value="2:34"
        icon={Clock}
        subtitle="minutes per call"
      />
    </div>
  );
}
