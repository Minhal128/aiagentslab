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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, BookOpen, Mic, Target } from "lucide-react";
import { Link } from "wouter";
import { useBranding } from "@/components/BrandingProvider";

const quickActions = [
  {
    title: "Create Campaign",
    description: "Launch a new calling campaign",
    icon: Target,
    href: "/campaigns",
    color: "bg-slate-900 dark:bg-slate-100",
  },
  {
    title: "Create Agent",
    description: "Build a new AI voice agent",
    icon: Users,
    href: "/agents",
    color: "bg-slate-900 dark:bg-slate-100",
  },
  {
    title: "Add Knowledge",
    description: "Upload documents or URLs",
    icon: BookOpen,
    href: "/knowledge-base",
    color: "bg-slate-900 dark:bg-slate-100",
  },
  {
    title: "Manage Voices",
    description: "Customize voice settings",
    icon: Mic,
    href: "/voices",
    color: "bg-slate-900 dark:bg-slate-100",
  },
];

export default function HomePage() {
  const { branding } = useBranding();
  const appName = branding.app_name || "the platform";
  
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-foreground mb-2">Welcome to {appName}</h1>
        <p className="text-muted-foreground">Get started by creating your first AI agent or exploring the platform</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {quickActions.map((action) => (
          <Card key={action.title} className="p-6 hover-elevate cursor-pointer" data-testid={`card-${action.title.toLowerCase().replace(/\s+/g, "-")}`}>
            <Link href={action.href}>
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${action.color}`}>
                  <action.icon className="h-6 w-6 text-white dark:text-slate-900" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-1">{action.title}</h3>
                  <p className="text-sm text-muted-foreground">{action.description}</p>
                </div>
              </div>
            </Link>
          </Card>
        ))}
      </div>

      <Card className="p-8 text-center">
        <h2 className="text-xl font-semibold mb-2">Need Help Getting Started?</h2>
        <p className="text-muted-foreground mb-4">
          Check out our documentation and tutorials to learn how to build powerful AI agents
        </p>
        <Button data-testid="button-view-docs">View Documentation</Button>
      </Card>
    </div>
  );
}
