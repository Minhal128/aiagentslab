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
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { 
  Plus, 
  Trash2, 
  Loader2, 
  Edit, 
  Code, 
  BarChart3,
  Check,
  ChevronUp,
  ChevronDown,
  HelpCircle
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AnalyticsScript } from "@shared/schema";

interface ScriptFormData {
  name: string;
  type: string;
  code: string;
  headCode: string;
  bodyCode: string;
  placement: string[];
  loadPriority: number;
  async: boolean;
  defer: boolean;
  enabled: boolean;
  hideOnInternalPages: boolean;
  description: string;
}

const SCRIPT_TYPES = [
  { value: 'gtm', label: 'Google Tag Manager' },
  { value: 'ga4', label: 'Google Analytics 4' },
  { value: 'facebook_pixel', label: 'Facebook Pixel' },
  { value: 'linkedin', label: 'LinkedIn Insight' },
  { value: 'twitter', label: 'Twitter Pixel' },
  { value: 'tiktok', label: 'TikTok Pixel' },
  { value: 'hotjar', label: 'Hotjar' },
  { value: 'clarity', label: 'Microsoft Clarity' },
  { value: 'custom', label: 'Custom Script' },
];

const SCRIPT_TEMPLATES: Record<string, { code: string; headCode: string; bodyCode: string; placement: string[]; description: string }> = {
  gtm: {
    code: '',
    headCode: `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXX');</script>
<!-- End Google Tag Manager -->`,
    bodyCode: `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`,
    placement: ['head', 'body'],
    description: 'Google Tag Manager container for managing all your tags. Replace GTM-XXXX with your container ID. GTM requires code in both head and body sections.',
  },
  ga4: {
    code: '',
    headCode: `<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
<!-- End Google Analytics 4 -->`,
    bodyCode: '',
    placement: ['head'],
    description: 'Google Analytics 4 tracking. Replace G-XXXXXXXXXX with your Measurement ID.',
  },
  facebook_pixel: {
    code: '',
    headCode: `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'YOUR_PIXEL_ID');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=YOUR_PIXEL_ID&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`,
    bodyCode: '',
    placement: ['head'],
    description: 'Facebook/Meta Pixel for conversion tracking. Replace YOUR_PIXEL_ID with your Pixel ID.',
  },
  linkedin: {
    code: '',
    headCode: `<!-- LinkedIn Insight Tag -->
<script type="text/javascript">
_linkedin_partner_id = "YOUR_PARTNER_ID";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);
</script>
<script type="text/javascript">
(function(l) {
if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
window.lintrk.q=[]}
var s = document.getElementsByTagName("script")[0];
var b = document.createElement("script");
b.type = "text/javascript";b.async = true;
b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
s.parentNode.insertBefore(b, s);})(window.lintrk);
</script>
<noscript>
<img height="1" width="1" style="display:none;" alt="" src="https://px.ads.linkedin.com/collect/?pid=YOUR_PARTNER_ID&fmt=gif" />
</noscript>
<!-- End LinkedIn Insight Tag -->`,
    bodyCode: '',
    placement: ['head'],
    description: 'LinkedIn Insight Tag for conversion tracking. Replace YOUR_PARTNER_ID with your Partner ID.',
  },
  twitter: {
    code: '',
    headCode: `<!-- Twitter Universal Website Tag -->
<script>
!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','YOUR_PIXEL_ID');
</script>
<!-- End Twitter Universal Website Tag -->`,
    bodyCode: '',
    placement: ['head'],
    description: 'Twitter/X Pixel for conversion tracking. Replace YOUR_PIXEL_ID with your Pixel ID.',
  },
  tiktok: {
    code: '',
    headCode: `<!-- TikTok Pixel Code -->
<script>
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};

  ttq.load('YOUR_PIXEL_ID');
  ttq.page();
}(window, document, 'ttq');
</script>
<!-- End TikTok Pixel Code -->`,
    bodyCode: '',
    placement: ['head'],
    description: 'TikTok Pixel for conversion tracking. Replace YOUR_PIXEL_ID with your Pixel ID.',
  },
  hotjar: {
    code: '',
    headCode: `<!-- Hotjar Tracking Code -->
<script>
    (function(h,o,t,j,a,r){
        h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
        h._hjSettings={hjid:YOUR_SITE_ID,hjsv:6};
        a=o.getElementsByTagName('head')[0];
        r=o.createElement('script');r.async=1;
        r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
        a.appendChild(r);
    })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
</script>
<!-- End Hotjar Tracking Code -->`,
    bodyCode: '',
    placement: ['head'],
    description: 'Hotjar for heatmaps and session recordings. Replace YOUR_SITE_ID with your Site ID.',
  },
  clarity: {
    code: '',
    headCode: `<!-- Microsoft Clarity -->
<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "YOUR_PROJECT_ID");
</script>
<!-- End Microsoft Clarity -->`,
    bodyCode: '',
    placement: ['head'],
    description: 'Microsoft Clarity for session recordings and heatmaps. Replace YOUR_PROJECT_ID with your Project ID.',
  },
  custom: {
    code: '',
    headCode: '',
    bodyCode: '',
    placement: ['head'],
    description: 'Custom tracking or analytics script.',
  },
};

const DEFAULT_FORM_DATA: ScriptFormData = {
  name: '',
  type: 'custom',
  code: '',
  headCode: '',
  bodyCode: '',
  placement: ['head'],
  loadPriority: 0,
  async: false,
  defer: false,
  enabled: true,
  hideOnInternalPages: false,
  description: '',
};

function InfoTooltip({ content }: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          aria-label="More information"
        >
          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help ml-1" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[300px]">
        <p className="text-sm">{content}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export default function AnalyticsModule() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scriptToDelete, setScriptToDelete] = useState<AnalyticsScript | null>(null);
  const [editingScript, setEditingScript] = useState<AnalyticsScript | null>(null);
  const [formData, setFormData] = useState<ScriptFormData>(DEFAULT_FORM_DATA);

  const { data: scripts, isLoading, refetch } = useQuery<AnalyticsScript[]>({
    queryKey: ["/api/admin/analytics-scripts"],
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const createScript = useMutation({
    mutationFn: async (data: ScriptFormData) => {
      return apiRequest("POST", "/api/admin/analytics-scripts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics-scripts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/analytics-scripts"] });
      refetch();
      toast({
        title: t("admin.analytics.scriptCreated"),
        description: t("admin.analytics.scriptCreatedDesc"),
      });
      resetForm();
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateScript = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ScriptFormData> }) => {
      return apiRequest("PATCH", `/api/admin/analytics-scripts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics-scripts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/analytics-scripts"] });
      refetch();
      toast({
        title: t("admin.analytics.scriptUpdated"),
        description: t("admin.analytics.scriptUpdatedDesc"),
      });
      resetForm();
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteScript = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/analytics-scripts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics-scripts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/analytics-scripts"] });
      refetch();
      toast({
        title: t("admin.analytics.scriptDeleted"),
        description: t("admin.analytics.scriptDeletedDesc"),
      });
      setDeleteDialogOpen(false);
      setScriptToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PATCH", `/api/admin/analytics-scripts/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics-scripts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/analytics-scripts"] });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData(DEFAULT_FORM_DATA);
    setEditingScript(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleOpenEdit = (script: AnalyticsScript) => {
    setEditingScript(script);
    const placement = Array.isArray(script.placement) ? script.placement : [script.placement];
    
    const existingHeadCode = (script as any).headCode || '';
    const existingBodyCode = (script as any).bodyCode || '';
    const legacyCode = script.code || '';
    
    let headCodeToUse = existingHeadCode;
    let bodyCodeToUse = existingBodyCode;
    
    // Migrate legacy code to appropriate field based on placement
    if (!existingHeadCode && !existingBodyCode && legacyCode) {
      const hasHeadPlacement = placement.includes('head');
      const hasBodyPlacement = placement.includes('body');
      
      if (hasHeadPlacement && hasBodyPlacement) {
        // For dual placement legacy scripts, intelligently split the code
        // Extract script, style, link, meta tags for head
        // Extract noscript and other elements for body
        const headElements: string[] = [];
        const bodyElements: string[] = [];
        
        // Match script tags (including content)
        const scriptMatches = legacyCode.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
        headElements.push(...scriptMatches);
        
        // Match style tags
        const styleMatches = legacyCode.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
        headElements.push(...styleMatches);
        
        // Match link tags (self-closing or not)
        const linkMatches = legacyCode.match(/<link[^>]*\/?>/gi) || [];
        headElements.push(...linkMatches);
        
        // Match meta tags (self-closing or not)
        const metaMatches = legacyCode.match(/<meta[^>]*\/?>/gi) || [];
        headElements.push(...metaMatches);
        
        // Match noscript tags for body
        const noscriptMatches = legacyCode.match(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi) || [];
        bodyElements.push(...noscriptMatches);
        
        headCodeToUse = headElements.join('\n').trim();
        bodyCodeToUse = bodyElements.join('\n').trim();
        
        // If we couldn't parse anything meaningful, fall back to putting all in head
        if (!headCodeToUse && !bodyCodeToUse) {
          headCodeToUse = legacyCode;
        }
      } else if (hasBodyPlacement && !hasHeadPlacement) {
        // Body-only placement: migrate to bodyCode
        bodyCodeToUse = legacyCode;
      } else {
        // Head-only or default: migrate to headCode
        headCodeToUse = legacyCode;
      }
    }
    
    setFormData({
      name: script.name,
      type: script.type,
      code: legacyCode,
      headCode: headCodeToUse,
      bodyCode: bodyCodeToUse,
      placement: placement,
      loadPriority: script.loadPriority,
      async: script.async || false,
      defer: script.defer || false,
      enabled: script.enabled,
      hideOnInternalPages: script.hideOnInternalPages || false,
      description: script.description || '',
    });
    setDialogOpen(true);
  };

  const handleTypeChange = (type: string) => {
    const template = SCRIPT_TEMPLATES[type];
    if (template && !editingScript) {
      setFormData(prev => ({
        ...prev,
        type,
        code: template.code,
        headCode: template.headCode,
        bodyCode: template.bodyCode,
        placement: template.placement,
        description: template.description,
        name: prev.name || SCRIPT_TYPES.find(t => t.value === type)?.label || '',
      }));
    } else {
      setFormData(prev => ({ ...prev, type }));
    }
  };

  const handlePlacementChange = (value: string, checked: boolean) => {
    setFormData(prev => {
      const newPlacement = checked 
        ? [...prev.placement, value]
        : prev.placement.filter(p => p !== value);
      return { ...prev, placement: newPlacement.length > 0 ? newPlacement : ['head'] };
    });
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({
        title: t("common.error"),
        description: t("admin.analytics.nameRequired"),
        variant: "destructive",
      });
      return;
    }
    const hasHeadCode = formData.headCode.trim().length > 0;
    const hasBodyCode = formData.bodyCode.trim().length > 0;
    if (!hasHeadCode && !hasBodyCode) {
      toast({
        title: t("common.error"),
        description: t("admin.analytics.codeRequired"),
        variant: "destructive",
      });
      return;
    }
    if (formData.placement.length === 0) {
      toast({
        title: t("common.error"),
        description: t("admin.analytics.placementRequired"),
        variant: "destructive",
      });
      return;
    }

    // Populate legacy 'code' field from headCode or bodyCode for backward compatibility
    const headCodeTrimmed = formData.headCode.trim();
    const bodyCodeTrimmed = formData.bodyCode.trim();
    const legacyCode = headCodeTrimmed || bodyCodeTrimmed || '';
    
    const dataToSubmit = {
      ...formData,
      headCode: headCodeTrimmed || undefined,
      bodyCode: bodyCodeTrimmed || undefined,
      code: legacyCode,
    };

    if (editingScript) {
      updateScript.mutate({ id: editingScript.id, data: dataToSubmit });
    } else {
      createScript.mutate(dataToSubmit as ScriptFormData);
    }
  };

  const handleConfirmDelete = (script: AnalyticsScript) => {
    setScriptToDelete(script);
    setDeleteDialogOpen(true);
  };

  const getTypeLabel = (type: string) => {
    return SCRIPT_TYPES.find(t => t.value === type)?.label || type;
  };

  const getTypeBadgeVariant = (type: string): "default" | "secondary" | "outline" => {
    switch (type) {
      case 'gtm':
      case 'ga4':
        return 'default';
      case 'facebook_pixel':
      case 'linkedin':
      case 'twitter':
      case 'tiktok':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const formatPlacement = (placement: string | string[]) => {
    const placements = Array.isArray(placement) ? placement : [placement];
    return placements.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' & ');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                {t("admin.analytics.scriptsTitle")}
              </CardTitle>
              <CardDescription>
                {t("admin.analytics.scriptsDescription")}
              </CardDescription>
            </div>
            <Button onClick={handleOpenCreate} data-testid="button-add-script">
              <Plus className="h-4 w-4 mr-2" />
              {t("admin.analytics.addScript")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {scripts && scripts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.analytics.name")}</TableHead>
                  <TableHead>{t("admin.analytics.type")}</TableHead>
                  <TableHead>{t("admin.analytics.placement")}</TableHead>
                  <TableHead className="text-center">{t("admin.analytics.priority")}</TableHead>
                  <TableHead className="text-center">{t("admin.analytics.enabled")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scripts
                  .sort((a, b) => b.loadPriority - a.loadPriority)
                  .map((script) => (
                  <TableRow key={script.id} data-testid={`row-script-${script.id}`}>
                    <TableCell className="font-medium">{script.name}</TableCell>
                    <TableCell>
                      <Badge variant={getTypeBadgeVariant(script.type)}>
                        {getTypeLabel(script.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(Array.isArray(script.placement) ? script.placement : [script.placement]).map((p) => (
                          <Badge key={p} variant="outline" className="capitalize">
                            {p === 'head' ? (
                              <ChevronUp className="h-3 w-3 mr-1" />
                            ) : (
                              <ChevronDown className="h-3 w-3 mr-1" />
                            )}
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">{script.loadPriority}</TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={script.enabled}
                        onCheckedChange={(checked) => toggleEnabled.mutate({ id: script.id, enabled: checked })}
                        data-testid={`switch-enabled-${script.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(script)}
                          data-testid={`button-edit-${script.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleConfirmDelete(script)}
                          data-testid={`button-delete-${script.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Code className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t("admin.analytics.noScripts")}</p>
              <p className="text-sm mt-2">
                {t("admin.analytics.noScriptsHint")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) resetForm();
        setDialogOpen(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              {editingScript 
                ? t("admin.analytics.editScript")
                : t("admin.analytics.addScript")
              }
            </DialogTitle>
            <DialogDescription>
              {editingScript
                ? t("admin.analytics.editScriptDesc")
                : t("admin.analytics.addScriptDesc")
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center">
                  <Label htmlFor="name">{t("admin.analytics.scriptName")}</Label>
                  <InfoTooltip content={t("admin.analytics.tooltips.name")} />
                </div>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t("admin.analytics.scriptNamePlaceholder")}
                  data-testid="input-script-name"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center">
                  <Label htmlFor="type">{t("admin.analytics.scriptType")}</Label>
                  <InfoTooltip content={t("admin.analytics.tooltips.type")} />
                </div>
                <Select value={formData.type} onValueChange={handleTypeChange}>
                  <SelectTrigger data-testid="select-script-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCRIPT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center">
                <Label htmlFor="headCode">
                  <ChevronUp className="h-4 w-4 inline mr-1" />
                  Head Code
                </Label>
                <InfoTooltip content="Scripts that go in the <head> section of your page. This includes most tracking scripts like Google Analytics, Facebook Pixel, etc." />
              </div>
              <Textarea
                id="headCode"
                value={formData.headCode}
                onChange={(e) => setFormData(prev => ({ ...prev, headCode: e.target.value }))}
                placeholder="Paste the code that goes in <head> section here..."
                className="font-mono text-sm min-h-[120px]"
                data-testid="textarea-head-code"
              />
              <p className="text-xs text-muted-foreground">
                Code injected into the &lt;head&gt; section. Most analytics scripts go here.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center">
                <Label htmlFor="bodyCode">
                  <ChevronDown className="h-4 w-4 inline mr-1" />
                  Body Code
                </Label>
                <InfoTooltip content="Scripts that go right after the opening <body> tag. Some services like Google Tag Manager require a noscript fallback here." />
              </div>
              <Textarea
                id="bodyCode"
                value={formData.bodyCode}
                onChange={(e) => setFormData(prev => ({ ...prev, bodyCode: e.target.value }))}
                placeholder="Paste the code that goes after <body> tag here (optional)..."
                className="font-mono text-sm min-h-[80px]"
                data-testid="textarea-body-code"
              />
              <p className="text-xs text-muted-foreground">
                Code injected after the &lt;body&gt; tag. Used for noscript fallbacks (e.g., Google Tag Manager).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center">
                  <Label>{t("admin.analytics.placement")}</Label>
                  <InfoTooltip content={t("admin.analytics.tooltips.placement")} />
                </div>
                <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="placement-head"
                      checked={formData.placement.includes('head')}
                      onCheckedChange={(checked) => handlePlacementChange('head', !!checked)}
                      data-testid="checkbox-placement-head"
                    />
                    <Label htmlFor="placement-head" className="font-normal cursor-pointer flex items-center gap-2">
                      <ChevronUp className="h-4 w-4" />
                      <span>{t("admin.analytics.placementHead")}</span>
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {t("admin.analytics.headDesc")}
                  </p>
                  
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="placement-body"
                      checked={formData.placement.includes('body')}
                      onCheckedChange={(checked) => handlePlacementChange('body', !!checked)}
                      data-testid="checkbox-placement-body"
                    />
                    <Label htmlFor="placement-body" className="font-normal cursor-pointer flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      <span>{t("admin.analytics.placementBody")}</span>
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {t("admin.analytics.bodyDesc")}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center">
                  <Label htmlFor="priority">{t("admin.analytics.loadPriority")}</Label>
                  <InfoTooltip content={t("admin.analytics.tooltips.priority")} />
                </div>
                <Input
                  id="priority"
                  type="number"
                  value={formData.loadPriority}
                  onChange={(e) => setFormData(prev => ({ ...prev, loadPriority: parseInt(e.target.value) || 0 }))}
                  min={0}
                  max={100}
                  data-testid="input-priority"
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin.analytics.priorityHint")}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center">
                <Label>{t("admin.analytics.scriptOptions")}</Label>
                <InfoTooltip content={t("admin.analytics.tooltips.options")} />
              </div>
              <div className="flex items-center gap-6 p-3 border rounded-md bg-muted/30">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="async"
                    checked={formData.async}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, async: !!checked }))}
                    data-testid="checkbox-async"
                  />
                  <Label htmlFor="async" className="font-normal cursor-pointer">
                    {t("admin.analytics.asyncOption")}
                  </Label>
                  <InfoTooltip content={t("admin.analytics.tooltips.async")} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="defer"
                    checked={formData.defer}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, defer: !!checked }))}
                    data-testid="checkbox-defer"
                  />
                  <Label htmlFor="defer" className="font-normal cursor-pointer">
                    {t("admin.analytics.deferOption")}
                  </Label>
                  <InfoTooltip content={t("admin.analytics.tooltips.defer")} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="enabled"
                    checked={formData.enabled}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, enabled: !!checked }))}
                    data-testid="checkbox-enabled"
                  />
                  <Label htmlFor="enabled" className="font-normal cursor-pointer">
                    {t("admin.analytics.enabled")}
                  </Label>
                  <InfoTooltip content={t("admin.analytics.tooltips.enabled")} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center">
                <Label>Page Scope</Label>
                <InfoTooltip content="Control where this script runs. Enable this to hide the script on admin and user dashboard pages, only showing it on public-facing pages." />
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/30">
                <Switch
                  id="hideOnInternalPages"
                  checked={formData.hideOnInternalPages}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, hideOnInternalPages: checked }))}
                  data-testid="switch-hide-on-internal-pages"
                />
                <Label htmlFor="hideOnInternalPages" className="font-normal cursor-pointer">
                  Hide on Admin & User Dashboard
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                When enabled, this script will only run on public pages (landing page, etc.) and will be hidden on /admin and /app routes.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center">
                <Label htmlFor="description">{t("admin.analytics.description")}</Label>
                <InfoTooltip content={t("admin.analytics.tooltips.description")} />
              </div>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t("admin.analytics.descriptionPlaceholder")}
                rows={2}
                data-testid="textarea-description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={createScript.isPending || updateScript.isPending}
              data-testid="button-save-script"
            >
              {(createScript.isPending || updateScript.isPending) ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {editingScript 
                ? t("common.save")
                : t("common.create")
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.analytics.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.analytics.deleteDesc")}
              {scriptToDelete && (
                <span className="block mt-2 font-medium">
                  {t("admin.analytics.scriptLabel")}: {scriptToDelete.name}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => scriptToDelete && deleteScript.mutate(scriptToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteScript.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
