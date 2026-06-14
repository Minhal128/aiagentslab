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
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { GitBranch, Layers, Copy, Sparkles, LayoutTemplate } from "lucide-react";
import { useTranslation } from 'react-i18next';

interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  isTemplate: boolean;
  nodeCount: number;
  preview: string[];
}

export default function FlowTemplatesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<FlowTemplate | null>(null);
  const [flowName, setFlowName] = useState("");

  const { data: templates = [], isLoading } = useQuery<FlowTemplate[]>({
    queryKey: ["/api/flow-automation/flow-templates"],
  });

  const cloneMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/flow-automation/flow-templates/${selectedTemplate?.id}/clone`,
        { name: flowName }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/flows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usage"] });
      toast({
        title: t('flowTemplates.toast.flowCreated'),
        description: t('flowTemplates.toast.flowCreatedDesc'),
      });
      handleCloseClone();
    },
    onError: (error: any) => {
      toast({
        title: t('flowTemplates.toast.createFailed'),
        description: error.data?.message ?? error.message,
        variant: "destructive",
      });
    },
  });

  const handleCloneTemplate = (template: FlowTemplate) => {
    setSelectedTemplate(template);
    setFlowName(template.name);
    setCloneDialogOpen(true);
  };

  const handleCloseClone = () => {
    setCloneDialogOpen(false);
    setSelectedTemplate(null);
    setFlowName("");
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">{t('flowTemplates.loadingTemplates')}</div>
        </div>
      </div>
    );
  }

  const totalTemplates = templates.length;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-50 via-purple-100/50 to-pink-50 dark:from-fuchsia-950/40 dark:via-purple-900/30 dark:to-pink-950/40 border border-fuchsia-100 dark:border-fuchsia-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 flex items-center justify-center shadow-lg shadow-fuchsia-500/25">
              <LayoutTemplate className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground" data-testid="text-page-title">
                {t('flowTemplates.title')}
              </h1>
              <p className="text-muted-foreground mt-0.5">
                {t('flowTemplates.subtitle')}
              </p>
            </div>
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-fuchsia-100/50 dark:border-fuchsia-800/30">
            <div className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" />
              <div className="text-2xl font-bold text-fuchsia-700 dark:text-fuchsia-300">{totalTemplates}</div>
            </div>
            <div className="text-fuchsia-600/70 dark:text-fuchsia-400/70 text-sm">{t('flowTemplates.availableTemplates')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-purple-100/50 dark:border-purple-800/30">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <div className="text-2xl font-bold text-purple-700 dark:text-purple-300">{t('flowTemplates.readyToUse')}</div>
            </div>
            <div className="text-purple-600/70 dark:text-purple-400/70 text-sm">{t('flowTemplates.preconfiguredWorkflows')}</div>
          </div>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t('flowTemplates.noTemplates')}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {t('flowTemplates.noTemplatesDesc')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id} className="hover-elevate">
              <CardHeader>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-primary" />
                    <Badge variant="outline" className="text-xs">
                      {t('flowTemplates.template')}
                    </Badge>
                  </div>
                  <Layers className="h-5 w-5 text-muted-foreground" />
                </div>
                <CardTitle className="text-xl" data-testid={`text-template-name-${template.id}`}>
                  {template.name}
                </CardTitle>
                <CardDescription className="text-sm mt-2">{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {t('flowTemplates.nodesCount', { count: template.nodeCount })}
                  </Badge>
                  {template.preview.slice(0, 3).map((nodeType, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs capitalize shrink-0">
                      {nodeType}
                    </Badge>
                  ))}
                </div>
                <Button
                  className="w-full"
                  onClick={() => handleCloneTemplate(template)}
                  data-testid={`button-use-template-${template.id}`}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  {t('flowTemplates.useThisTemplate')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-clone-dialog-title">{t('flowTemplates.createFromTemplate')}</DialogTitle>
            <DialogDescription>
              {selectedTemplate?.name} - {selectedTemplate?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="flow-name">{t('flowTemplates.flowNameRequired')}</Label>
              <Input
                id="flow-name"
                placeholder={t('flowTemplates.flowNamePlaceholder')}
                value={flowName}
                onChange={(e) => setFlowName(e.target.value)}
                data-testid="input-flow-name"
              />
              <p className="text-xs text-muted-foreground">
                {t('flowTemplates.customizeAfterCreation')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseClone} data-testid="button-cancel-clone">
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => cloneMutation.mutate()}
              disabled={!flowName || cloneMutation.isPending}
              data-testid="button-submit-clone"
            >
              {t('flowTemplates.createFlow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
