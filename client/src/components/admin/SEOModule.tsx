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
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Save, Loader2, Plus, Trash2, ExternalLink, Globe, FileText, Bot, Share2, Building2, HelpCircle, ShoppingBag, Upload, RefreshCw, Wand2, Image } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface SitemapUrl {
  url: string;
  changefreq: string;
  priority: number;
  lastmod?: string;
}

interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
}

interface FaqItem {
  question: string;
  answer: string;
}

interface OrganizationSchema {
  name?: string;
  url?: string;
  logo?: string;
  email?: string;
  phone?: string;
}

interface ProductSchema {
  name?: string;
  description?: string;
  image?: string;
  brand?: string;
  sku?: string;
  price?: string;
  priceCurrency?: string;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder' | 'Discontinued';
  url?: string;
  ratingValue?: string;
  ratingCount?: string;
}

interface SeoSettings {
  id: string;
  defaultTitle: string | null;
  defaultDescription: string | null;
  defaultKeywords: string[] | null;
  defaultOgImage: string | null;
  canonicalBaseUrl: string | null;
  sitemapUrls: SitemapUrl[];
  robotsRules: RobotsRule[];
  robotsCrawlDelay: number | null;
  structuredDataOrg: OrganizationSchema | null;
  structuredDataFaq: FaqItem[] | null;
  structuredDataProduct: ProductSchema | null;
  twitterHandle: string | null;
  facebookAppId: string | null;
  googleVerification: string | null;
  bingVerification: string | null;
  updatedAt: string | null;
  keywordsInput?: string;
}

export default function SEOModule() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [formData, setFormData] = useState<Partial<SeoSettings>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [newSitemapUrl, setNewSitemapUrl] = useState({ url: "", changefreq: "weekly", priority: 0.5 });
  const [newFaq, setNewFaq] = useState({ question: "", answer: "" });

  const { data: settings, isLoading } = useQuery<SeoSettings>({
    queryKey: ["/api/admin/seo"]
  });

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const updateSettings = useMutation({
    mutationFn: async (data: Partial<SeoSettings>) => {
      // Filter out fields that should not be sent to backend (dates come as strings and cause serialization errors)
      const { id, createdAt, updatedAt, keywordsInput, ...cleanData } = data as any;
      return apiRequest("PATCH", "/api/admin/seo", cleanData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo"] });
      toast({
        title: t("admin.seo.settingsSaved"),
        description: t("admin.seo.settingsSavedDesc")
      });
      setHasChanges(false);
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const addSitemapUrl = useMutation({
    mutationFn: async (urlData: { url: string; changefreq: string; priority: number }) => {
      return apiRequest("POST", "/api/admin/seo/sitemap-urls", urlData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo"] });
      setNewSitemapUrl({ url: "", changefreq: "weekly", priority: 0.5 });
      toast({
        title: t("admin.seo.urlAdded"),
        description: t("admin.seo.urlAddedDesc")
      });
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const removeSitemapUrl = useMutation({
    mutationFn: async (url: string) => {
      return apiRequest("DELETE", "/api/admin/seo/sitemap-urls", { url });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo"] });
      toast({
        title: t("admin.seo.urlRemoved"),
        description: t("admin.seo.urlRemovedDesc")
      });
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const generateDefaultSitemap = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/seo/generate-sitemap", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo"] });
      toast({
        title: t("admin.seo.sitemap.generated") || "Sitemap Generated",
        description: t("admin.seo.sitemap.generatedDesc") || `Created ${data.urlCount || 9} default URLs`
      });
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const rebuildSitemap = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/seo/rebuild-sitemap", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo"] });
      toast({
        title: t("admin.seo.sitemap.rebuilt") || "Sitemap Rebuilt",
        description: t("admin.seo.sitemap.rebuiltDesc") || `Updated ${data.urlCount || 0} URLs with latest dates`
      });
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const uploadImage = useMutation({
    mutationFn: async ({ imageData, imageType, fileName }: { imageData: string; imageType: string; fileName: string }) => {
      return apiRequest("POST", "/api/admin/seo/upload-image", { imageData, imageType, fileName });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo"] });
      if (data.imageType === 'ogImage') {
        setFormData(prev => ({ ...prev, defaultOgImage: data.url }));
      }
      toast({
        title: t("admin.seo.social.imageUploaded") || "Image Uploaded",
        description: t("admin.seo.social.imageUploadedDesc") || "Image uploaded successfully"
      });
    },
    onError: (error: any) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, imageType: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const imageData = reader.result as string;
      uploadImage.mutate({ imageData, imageType, fileName: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleChange = (key: keyof SeoSettings, value: any) => {
    setFormData(prev => ({
      ...prev,
      [key]: value
    }));
    setHasChanges(true);
  };

  const handleOrgChange = (key: keyof OrganizationSchema, value: string) => {
    setFormData(prev => ({
      ...prev,
      structuredDataOrg: {
        ...(prev.structuredDataOrg || {}),
        [key]: value
      }
    }));
    setHasChanges(true);
  };

  const handleProductChange = (key: keyof ProductSchema, value: string) => {
    setFormData(prev => ({
      ...prev,
      structuredDataProduct: {
        ...(prev.structuredDataProduct || {}),
        [key]: value
      }
    }));
    setHasChanges(true);
  };

  const addFaqItem = () => {
    if (!newFaq.question || !newFaq.answer) return;
    const currentFaqs = formData.structuredDataFaq || [];
    setFormData(prev => ({
      ...prev,
      structuredDataFaq: [...currentFaqs, newFaq]
    }));
    setNewFaq({ question: "", answer: "" });
    setHasChanges(true);
  };

  const removeFaqItem = (index: number) => {
    const currentFaqs = formData.structuredDataFaq || [];
    setFormData(prev => ({
      ...prev,
      structuredDataFaq: currentFaqs.filter((_, i) => i !== index)
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    await updateSettings.mutateAsync(formData);
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
      <Tabs defaultValue="meta" className="space-y-4">
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="meta" data-testid="seo-tab-meta">
            <Globe className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">{t("admin.seo.tabs.meta")}</span>
            <span className="sm:hidden">Meta</span>
          </TabsTrigger>
          <TabsTrigger value="sitemap" data-testid="seo-tab-sitemap">
            <FileText className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">{t("admin.seo.tabs.sitemap")}</span>
            <span className="sm:hidden">Sitemap</span>
          </TabsTrigger>
          <TabsTrigger value="robots" data-testid="seo-tab-robots">
            <Bot className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">{t("admin.seo.tabs.robots")}</span>
            <span className="sm:hidden">Robots</span>
          </TabsTrigger>
          <TabsTrigger value="social" data-testid="seo-tab-social">
            <Share2 className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">{t("admin.seo.tabs.social")}</span>
            <span className="sm:hidden">Social</span>
          </TabsTrigger>
          <TabsTrigger value="structured" data-testid="seo-tab-structured">
            <Building2 className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">{t("admin.seo.tabs.structured")}</span>
            <span className="sm:hidden">Schema</span>
          </TabsTrigger>
        </TabsList>

        {/* Meta Tags Tab */}
        <TabsContent value="meta" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                {t("admin.seo.metaTags.title")}
              </CardTitle>
              <CardDescription>
                {t("admin.seo.metaTags.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-1">
                  <Label>{t("admin.seo.metaTags.defaultTitle")}</Label>
                  <InfoTooltip content={t("admin.seo.metaTags.defaultTitleTooltip")} />
                </div>
                <Input
                  value={formData.defaultTitle || ""}
                  onChange={(e) => handleChange("defaultTitle", e.target.value)}
                  placeholder={t("admin.seo.metaTags.defaultTitlePlaceholder")}
                  data-testid="input-seo-title"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("admin.seo.metaTags.defaultTitleHint")}
                </p>
              </div>

              <div>
                <div className="flex items-center gap-1">
                  <Label>{t("admin.seo.metaTags.defaultDescription")}</Label>
                  <InfoTooltip content={t("admin.seo.metaTags.defaultDescriptionTooltip")} />
                </div>
                <Textarea
                  value={formData.defaultDescription || ""}
                  onChange={(e) => handleChange("defaultDescription", e.target.value)}
                  placeholder={t("admin.seo.metaTags.defaultDescriptionPlaceholder")}
                  rows={3}
                  data-testid="input-seo-description"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("admin.seo.metaTags.defaultDescriptionHint")}
                </p>
              </div>

              <div>
                <div className="flex items-center gap-1">
                  <Label>{t("admin.seo.metaTags.keywords")}</Label>
                  <InfoTooltip content={t("admin.seo.metaTags.keywordsTooltip")} />
                </div>
                <Input
                  value={formData.keywordsInput !== undefined 
                    ? formData.keywordsInput 
                    : (Array.isArray(formData.defaultKeywords) ? formData.defaultKeywords.join(', ') : (formData.defaultKeywords || ""))}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData(prev => ({
                      ...prev,
                      keywordsInput: value,
                      defaultKeywords: value ? value.split(',').map(k => k.trim()).filter(k => k.length > 0) : []
                    }));
                    setHasChanges(true);
                  }}
                  placeholder={t("admin.seo.metaTags.keywordsPlaceholder")}
                  data-testid="input-seo-keywords"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("admin.seo.metaTags.keywordsHint") || "Separate keywords with commas"}
                </p>
              </div>

              <div>
                <div className="flex items-center gap-1">
                  <Label>{t("admin.seo.metaTags.canonicalUrl")}</Label>
                  <InfoTooltip content={t("admin.seo.metaTags.canonicalUrlTooltip")} />
                </div>
                <Input
                  value={formData.canonicalBaseUrl || ""}
                  onChange={(e) => handleChange("canonicalBaseUrl", e.target.value)}
                  placeholder={t("admin.seo.metaTags.canonicalUrlPlaceholder")}
                  data-testid="input-seo-canonical"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-1">
                    <Label>{t("admin.seo.metaTags.googleVerification")}</Label>
                    <InfoTooltip content={t("admin.seo.metaTags.googleVerificationTooltip")} />
                  </div>
                  <Input
                    value={formData.googleVerification || ""}
                    onChange={(e) => handleChange("googleVerification", e.target.value)}
                    placeholder={t("admin.seo.metaTags.googleVerificationPlaceholder")}
                    data-testid="input-google-verification"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-1">
                    <Label>{t("admin.seo.metaTags.bingVerification")}</Label>
                    <InfoTooltip content={t("admin.seo.metaTags.bingVerificationTooltip")} />
                  </div>
                  <Input
                    value={formData.bingVerification || ""}
                    onChange={(e) => handleChange("bingVerification", e.target.value)}
                    placeholder={t("admin.seo.metaTags.bingVerificationPlaceholder")}
                    data-testid="input-bing-verification"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sitemap Tab */}
        <TabsContent value="sitemap" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    {t("admin.seo.sitemap.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("admin.seo.sitemap.description")}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateDefaultSitemap.mutate()}
                    disabled={generateDefaultSitemap.isPending}
                    data-testid="button-generate-sitemap"
                  >
                    {generateDefaultSitemap.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4 mr-2" />
                    )}
                    {t("admin.seo.sitemap.generateDefault") || "Generate Default"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => rebuildSitemap.mutate()}
                    disabled={rebuildSitemap.isPending || !formData.sitemapUrls?.length}
                    data-testid="button-rebuild-sitemap"
                  >
                    {rebuildSitemap.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    {t("admin.seo.sitemap.rebuild") || "Rebuild"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open('/sitemap.xml', '_blank')}
                    data-testid="button-view-sitemap"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t("admin.seo.sitemap.viewSitemap")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add new URL form */}
              <div className="flex flex-col sm:flex-row gap-3 p-4 border rounded-lg bg-muted/30">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">{t("admin.seo.sitemap.urlPath")}</Label>
                  <Input
                    value={newSitemapUrl.url}
                    onChange={(e) => setNewSitemapUrl(prev => ({ ...prev, url: e.target.value }))}
                    placeholder={t("admin.seo.sitemap.urlPathPlaceholder")}
                    data-testid="input-sitemap-url"
                  />
                </div>
                <div className="w-full sm:w-36">
                  <Label className="text-xs text-muted-foreground mb-1 block">{t("admin.seo.sitemap.changeFreq")}</Label>
                  <Select
                    value={newSitemapUrl.changefreq}
                    onValueChange={(value) => setNewSitemapUrl(prev => ({ ...prev, changefreq: value }))}
                  >
                    <SelectTrigger data-testid="select-changefreq">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">{t("admin.seo.sitemap.changeFreqOptions.always")}</SelectItem>
                      <SelectItem value="hourly">{t("admin.seo.sitemap.changeFreqOptions.hourly")}</SelectItem>
                      <SelectItem value="daily">{t("admin.seo.sitemap.changeFreqOptions.daily")}</SelectItem>
                      <SelectItem value="weekly">{t("admin.seo.sitemap.changeFreqOptions.weekly")}</SelectItem>
                      <SelectItem value="monthly">{t("admin.seo.sitemap.changeFreqOptions.monthly")}</SelectItem>
                      <SelectItem value="yearly">{t("admin.seo.sitemap.changeFreqOptions.yearly")}</SelectItem>
                      <SelectItem value="never">{t("admin.seo.sitemap.changeFreqOptions.never")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full sm:w-24">
                  <Label className="text-xs text-muted-foreground mb-1 block">{t("admin.seo.sitemap.priority")}</Label>
                  <Select
                    value={String(newSitemapUrl.priority)}
                    onValueChange={(value) => setNewSitemapUrl(prev => ({ ...prev, priority: parseFloat(value) }))}
                  >
                    <SelectTrigger data-testid="select-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1.0">1.0</SelectItem>
                      <SelectItem value="0.9">0.9</SelectItem>
                      <SelectItem value="0.8">0.8</SelectItem>
                      <SelectItem value="0.7">0.7</SelectItem>
                      <SelectItem value="0.6">0.6</SelectItem>
                      <SelectItem value="0.5">0.5</SelectItem>
                      <SelectItem value="0.4">0.4</SelectItem>
                      <SelectItem value="0.3">0.3</SelectItem>
                      <SelectItem value="0.2">0.2</SelectItem>
                      <SelectItem value="0.1">0.1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={() => addSitemapUrl.mutate(newSitemapUrl)}
                    disabled={!newSitemapUrl.url || addSitemapUrl.isPending}
                    data-testid="button-add-sitemap-url"
                  >
                    {addSitemapUrl.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    <span className="ml-2 hidden sm:inline">{t("admin.seo.sitemap.addUrl")}</span>
                  </Button>
                </div>
              </div>

              {/* Info about defaults */}
              <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-lg">
                <p className="font-medium mb-1">{t("admin.seo.sitemap.defaultPages")}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">/</Badge>
                  <Badge variant="secondary">/pricing</Badge>
                  <Badge variant="secondary">/features</Badge>
                  <Badge variant="secondary">/blog</Badge>
                  <Badge variant="secondary">/contact</Badge>
                </div>
              </div>

              {/* Custom URLs table */}
              {formData.sitemapUrls && formData.sitemapUrls.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>URL</TableHead>
                        <TableHead className="w-28">{t("admin.seo.sitemap.changeFreq")}</TableHead>
                        <TableHead className="w-20">{t("admin.seo.sitemap.priority")}</TableHead>
                        <TableHead className="w-28">{t("admin.seo.sitemap.lastModified")}</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {formData.sitemapUrls.map((url, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-mono text-sm">{url.url}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{url.changefreq}</Badge>
                          </TableCell>
                          <TableCell>{url.priority}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {url.lastmod || '-'}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeSitemapUrl.mutate(url.url)}
                              disabled={removeSitemapUrl.isPending}
                              data-testid={`button-remove-url-${index}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  {t("admin.seo.sitemap.noCustomUrls")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Robots Tab */}
        <TabsContent value="robots" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    {t("admin.seo.robots.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("admin.seo.robots.description")}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('/robots.txt', '_blank')}
                  data-testid="button-view-robots"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t("admin.seo.robots.viewRobots")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-1">
                  <Label>{t("admin.seo.robots.crawlDelay")}</Label>
                  <InfoTooltip content={t("admin.seo.robots.crawlDelayTooltip")} />
                </div>
                <Input
                  type="number"
                  min="0"
                  max="60"
                  value={formData.robotsCrawlDelay || 0}
                  onChange={(e) => handleChange("robotsCrawlDelay", parseInt(e.target.value) || 0)}
                  className="w-32"
                  data-testid="input-crawl-delay"
                />
              </div>

              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium mb-2">{t("admin.seo.robots.defaultRules")}</p>
                <pre className="text-xs font-mono bg-background p-3 rounded border overflow-x-auto">
{`User-agent: *
Allow: /
Allow: /pricing
Allow: /features
Allow: /blog
Allow: /contact
Disallow: /app/
Disallow: /admin/
Disallow: /api/`}
                </pre>
                <p className="text-xs text-muted-foreground mt-2">
                  {t("admin.seo.robots.defaultRulesNote")}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Social Tab */}
        <TabsContent value="social" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                {t("admin.seo.social.title")}
              </CardTitle>
              <CardDescription>
                {t("admin.seo.social.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* OG Image Upload Section */}
              <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
                <div className="flex items-center gap-2">
                  <Image className="h-5 w-5" />
                  <Label className="text-base font-medium">{t("admin.seo.social.ogImage") || "Open Graph Image"}</Label>
                  <InfoTooltip content={t("admin.seo.social.ogImageTooltip")} />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Image Preview */}
                  <div className="flex flex-col gap-2">
                    {formData.defaultOgImage ? (
                      <div className="relative border rounded-lg overflow-hidden bg-background">
                        <img 
                          src={formData.defaultOgImage} 
                          alt="OG Preview" 
                          className="w-full h-40 object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        <div className="absolute bottom-2 right-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleChange("defaultOgImage", "")}
                            data-testid="button-remove-og-image"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            {t("common.remove") || "Remove"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center h-40 bg-muted/20">
                        <Image className="h-8 w-8 text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground text-center">
                          {t("admin.seo.social.noImage") || "No image uploaded"}
                        </p>
                      </div>
                    )}
                  </div>
                  
                  {/* Upload Controls */}
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        {t("admin.seo.social.uploadImage") || "Upload Image"}
                      </Label>
                      <div className="flex gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e, 'ogImage')}
                          className="hidden"
                          id="og-image-upload"
                          data-testid="input-upload-og-image"
                        />
                        <Button
                          variant="outline"
                          onClick={() => document.getElementById('og-image-upload')?.click()}
                          disabled={uploadImage.isPending}
                          data-testid="button-upload-og-image"
                        >
                          {uploadImage.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4 mr-2" />
                          )}
                          {t("admin.seo.social.chooseFile") || "Choose File"}
                        </Button>
                      </div>
                    </div>
                    
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        {t("admin.seo.social.orEnterUrl") || "Or enter URL directly"}
                      </Label>
                      <Input
                        value={formData.defaultOgImage || ""}
                        onChange={(e) => handleChange("defaultOgImage", e.target.value)}
                        placeholder={t("admin.seo.social.ogImagePlaceholder")}
                        data-testid="input-og-image"
                      />
                    </div>
                    
                    <p className="text-xs text-muted-foreground">
                      {t("admin.seo.social.ogImageHint") || "Recommended size: 1200x630 pixels"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Social Handles */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-1">
                    <Label>{t("admin.seo.social.twitterHandle")}</Label>
                    <InfoTooltip content={t("admin.seo.social.twitterHandleTooltip")} />
                  </div>
                  <Input
                    value={formData.twitterHandle || ""}
                    onChange={(e) => handleChange("twitterHandle", e.target.value)}
                    placeholder={t("admin.seo.social.twitterHandlePlaceholder")}
                    data-testid="input-twitter-handle"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-1">
                    <Label>{t("admin.seo.social.facebookAppId")}</Label>
                    <InfoTooltip content={t("admin.seo.social.facebookAppIdTooltip")} />
                  </div>
                  <Input
                    value={formData.facebookAppId || ""}
                    onChange={(e) => handleChange("facebookAppId", e.target.value)}
                    placeholder={t("admin.seo.social.facebookAppIdPlaceholder")}
                    data-testid="input-facebook-app-id"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Structured Data Tab */}
        <TabsContent value="structured" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {t("admin.seo.structured.title")}
              </CardTitle>
              <CardDescription>
                {t("admin.seo.structured.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="multiple" className="w-full" defaultValue={["organization"]}>
                {/* Organization Schema */}
                <AccordionItem value="organization">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {t("admin.seo.structured.organization")}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pt-4">
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("admin.seo.structured.organizationDescription")}
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label>{t("admin.seo.structured.organizationName")}</Label>
                        <Input
                          value={formData.structuredDataOrg?.name || ""}
                          onChange={(e) => handleOrgChange("name", e.target.value)}
                          placeholder={t("admin.seo.structured.organizationNamePlaceholder")}
                          data-testid="input-org-name"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.organizationUrl")}</Label>
                        <Input
                          value={formData.structuredDataOrg?.url || ""}
                          onChange={(e) => handleOrgChange("url", e.target.value)}
                          placeholder={t("admin.seo.structured.organizationUrlPlaceholder")}
                          data-testid="input-org-url"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.organizationLogo")}</Label>
                        <Input
                          value={formData.structuredDataOrg?.logo || ""}
                          onChange={(e) => handleOrgChange("logo", e.target.value)}
                          placeholder={t("admin.seo.structured.organizationLogoPlaceholder")}
                          data-testid="input-org-logo"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.organizationEmail")}</Label>
                        <Input
                          value={formData.structuredDataOrg?.email || ""}
                          onChange={(e) => handleOrgChange("email", e.target.value)}
                          placeholder={t("admin.seo.structured.organizationEmailPlaceholder")}
                          data-testid="input-org-email"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.organizationPhone")}</Label>
                        <Input
                          value={formData.structuredDataOrg?.phone || ""}
                          onChange={(e) => handleOrgChange("phone", e.target.value)}
                          placeholder={t("admin.seo.structured.organizationPhonePlaceholder")}
                          data-testid="input-org-phone"
                        />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* FAQ Schema */}
                <AccordionItem value="faq">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <HelpCircle className="h-4 w-4" />
                      {t("admin.seo.structured.faq")}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pt-4">
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("admin.seo.structured.faqDescription")}
                    </p>

                    {/* Add new FAQ */}
                    <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">{t("admin.seo.structured.faqQuestion")}</Label>
                        <Input
                          value={newFaq.question}
                          onChange={(e) => setNewFaq(prev => ({ ...prev, question: e.target.value }))}
                          placeholder="What is your product?"
                          data-testid="input-faq-question"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">{t("admin.seo.structured.faqAnswer")}</Label>
                        <Textarea
                          value={newFaq.answer}
                          onChange={(e) => setNewFaq(prev => ({ ...prev, answer: e.target.value }))}
                          placeholder="Our product is..."
                          rows={2}
                          data-testid="input-faq-answer"
                        />
                      </div>
                      <Button
                        onClick={addFaqItem}
                        disabled={!newFaq.question || !newFaq.answer}
                        size="sm"
                        data-testid="button-add-faq"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {t("admin.seo.structured.addFaq")}
                      </Button>
                    </div>

                    {/* FAQ List */}
                    {formData.structuredDataFaq && formData.structuredDataFaq.length > 0 ? (
                      <div className="space-y-2">
                        {formData.structuredDataFaq.map((faq, index) => (
                          <div key={index} className="p-3 border rounded-lg flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className="font-medium text-sm">{faq.question}</p>
                              <p className="text-sm text-muted-foreground mt-1">{faq.answer}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFaqItem(index)}
                              data-testid={`button-remove-faq-${index}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center py-4 text-muted-foreground text-sm">
                        {t("admin.seo.structured.noFaqs")}
                      </p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Product Schema */}
                <AccordionItem value="product">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4" />
                      {t("admin.seo.structured.product")}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pt-4">
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("admin.seo.structured.productDescription")}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label>{t("admin.seo.structured.productName")}</Label>
                        <Input
                          value={formData.structuredDataProduct?.name || ""}
                          onChange={(e) => handleProductChange("name", e.target.value)}
                          placeholder="AgentLabs Pro"
                          data-testid="input-product-name"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productBrand") || "Brand"}</Label>
                        <Input
                          value={formData.structuredDataProduct?.brand || ""}
                          onChange={(e) => handleProductChange("brand", e.target.value)}
                          placeholder="AgentLabs"
                          data-testid="input-product-brand"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label>{t("admin.seo.structured.productDescriptionField")}</Label>
                        <Textarea
                          value={formData.structuredDataProduct?.description || ""}
                          onChange={(e) => handleProductChange("description", e.target.value)}
                          placeholder="AI-powered bulk calling platform for businesses"
                          rows={2}
                          data-testid="input-product-description"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productImage") || "Image URL"}</Label>
                        <Input
                          value={formData.structuredDataProduct?.image || ""}
                          onChange={(e) => handleProductChange("image", e.target.value)}
                          placeholder="https://example.com/product.jpg"
                          data-testid="input-product-image"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productSku") || "SKU"}</Label>
                        <Input
                          value={formData.structuredDataProduct?.sku || ""}
                          onChange={(e) => handleProductChange("sku", e.target.value)}
                          placeholder="AGENTLABS-PRO-001"
                          data-testid="input-product-sku"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productPrice")}</Label>
                        <Input
                          value={formData.structuredDataProduct?.price || ""}
                          onChange={(e) => handleProductChange("price", e.target.value)}
                          placeholder="99.00"
                          data-testid="input-product-price"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productCurrency")}</Label>
                        <Input
                          value={formData.structuredDataProduct?.priceCurrency || ""}
                          onChange={(e) => handleProductChange("priceCurrency", e.target.value)}
                          placeholder="USD"
                          data-testid="input-product-currency"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productUrl") || "Product URL"}</Label>
                        <Input
                          value={formData.structuredDataProduct?.url || ""}
                          onChange={(e) => handleProductChange("url", e.target.value)}
                          placeholder="https://example.com/product"
                          data-testid="input-product-url"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productAvailability") || "Availability"}</Label>
                        <Select
                          value={formData.structuredDataProduct?.availability || "InStock"}
                          onValueChange={(value) => handleProductChange("availability", value)}
                        >
                          <SelectTrigger data-testid="select-product-availability">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="InStock">In Stock</SelectItem>
                            <SelectItem value="OutOfStock">Out of Stock</SelectItem>
                            <SelectItem value="PreOrder">Pre-Order</SelectItem>
                            <SelectItem value="Discontinued">Discontinued</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productRatingValue") || "Rating Value"}</Label>
                        <Input
                          value={formData.structuredDataProduct?.ratingValue || ""}
                          onChange={(e) => handleProductChange("ratingValue", e.target.value)}
                          placeholder="4.8"
                          data-testid="input-product-rating-value"
                        />
                      </div>
                      <div>
                        <Label>{t("admin.seo.structured.productRatingCount") || "Rating Count"}</Label>
                        <Input
                          value={formData.structuredDataProduct?.ratingCount || ""}
                          onChange={(e) => handleProductChange("ratingCount", e.target.value)}
                          placeholder="150"
                          data-testid="input-product-rating-count"
                        />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateSettings.isPending}
          data-testid="button-save-seo"
        >
          {updateSettings.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("admin.seo.saving")}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {t("admin.seo.save")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
