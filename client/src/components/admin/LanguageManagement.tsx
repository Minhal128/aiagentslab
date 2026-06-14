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
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Plus, Trash2, Pencil, Globe, Loader2, Star, Languages, Search, ChevronRight, ChevronDown, Save, Sprout, ArrowUpDown, Key, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PlatformLanguage } from "@shared/schema";
import { LanguageFlag } from "../LanguageFlag";

interface TranslationEntry {
  key: string;
  path: string[];
  value: string;
  englishValue: string;
  isCustom: boolean;
}

function flattenTranslations(obj: Record<string, unknown>, prefix = ""): { key: string; value: unknown }[] {
  const entries: { key: string; value: unknown }[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      entries.push(...flattenTranslations(value as Record<string, unknown>, fullKey));
    } else {
      entries.push({ key: fullKey, value });
    }
  }
  return entries;
}

function getNestedValue(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const result = { ...obj };
  let current = result;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    } else {
      current[key] = { ...(current[key] as Record<string, unknown>) };
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
  return result;
}

export default function LanguageManagement() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("languages");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isTranslationEditorOpen, setIsTranslationEditorOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<PlatformLanguage | null>(null);

  const [newLanguageCode, setNewLanguageCode] = useState("");
  const [newLanguageName, setNewLanguageName] = useState("");
  const [newLanguageNativeName, setNewLanguageNativeName] = useState("");
  const [newLanguageFlag, setNewLanguageFlag] = useState("");
  const [newLanguageDirection, setNewLanguageDirection] = useState<"ltr" | "rtl">("ltr");
  const [copyFromLanguage, setCopyFromLanguage] = useState<string>("none");

  const [editName, setEditName] = useState("");
  const [editNativeName, setEditNativeName] = useState("");
  const [editFlag, setEditFlag] = useState("");
  const [editDirection, setEditDirection] = useState<"ltr" | "rtl">("ltr");

  const [translationSearch, setTranslationSearch] = useState("");
  const [editedTranslations, setEditedTranslations] = useState<Record<string, unknown>>({});
  const [hasTranslationChanges, setHasTranslationChanges] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const [isAddKeyDialogOpen, setIsAddKeyDialogOpen] = useState(false);
  const [newKeyPath, setNewKeyPath] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [syncKeyToAll, setSyncKeyToAll] = useState(true);
  const [keyPathError, setKeyPathError] = useState<string | null>(null);

  const [isDeleteKeyDialogOpen, setIsDeleteKeyDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [deleteFromAll, setDeleteFromAll] = useState(true);

  const { data: languages = [], isLoading } = useQuery<PlatformLanguage[]>({
    queryKey: ["/api/admin/platform-languages"],
  });

  const englishLanguage = useMemo(() =>
    languages.find(l => l.code === "en"),
    [languages]
  );

  const seedLanguagesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/platform-languages/seed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-languages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/platform-languages"] });
      toast({
        title: t("common.success"),
        description: "Default languages have been seeded successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message,
      });
    },
  });

  const createLanguageMutation = useMutation({
    mutationFn: async (data: {
      code: string;
      name: string;
      nativeName: string;
      flag?: string;
      direction: "ltr" | "rtl";
      translations: Record<string, unknown>;
    }) => {
      return apiRequest("POST", "/api/admin/platform-languages", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-languages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/platform-languages"] });
      setIsAddDialogOpen(false);
      resetAddForm();
      toast({
        title: t("common.success"),
        description: "Language created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message,
      });
    },
  });

  const updateLanguageMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PlatformLanguage> }) => {
      return apiRequest("PATCH", `/api/admin/platform-languages/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-languages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/platform-languages"] });
      setIsEditDialogOpen(false);
      setIsTranslationEditorOpen(false);
      setHasTranslationChanges(false);
      toast({
        title: t("common.success"),
        description: "Language updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message,
      });
    },
  });

  const deleteLanguageMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/platform-languages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-languages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/platform-languages"] });
      setIsDeleteDialogOpen(false);
      setSelectedLanguage(null);
      toast({
        title: t("common.success"),
        description: "Language deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message,
      });
    },
  });

  const addKeyMutation = useMutation({
    mutationFn: async (data: { keyPath: string; values: Record<string, string>; syncToAll: boolean }) => {
      return apiRequest("POST", "/api/admin/platform-languages/add-key", data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-languages"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/public/platform-languages"] });
      setIsAddKeyDialogOpen(false);
      setNewKeyPath("");
      setNewKeyValue("");
      setSyncKeyToAll(true);
      setKeyPathError(null);
      setIsTranslationEditorOpen(false);
      toast({
        title: t("common.success"),
        description: "Translation key added successfully. Reopen the editor to see the new key.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message,
      });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (data: { keyPath: string; languageId?: string }) => {
      return apiRequest("POST", "/api/admin/platform-languages/delete-key", data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-languages"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/public/platform-languages"] });
      setIsDeleteKeyDialogOpen(false);
      setKeyToDelete(null);
      setDeleteFromAll(true);
      setIsTranslationEditorOpen(false);
      toast({
        title: t("common.success"),
        description: "Translation key deleted successfully. Reopen the editor to see updated translations.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message,
      });
    },
  });

  const resetAddForm = () => {
    setNewLanguageCode("");
    setNewLanguageName("");
    setNewLanguageNativeName("");
    setNewLanguageFlag("");
    setNewLanguageDirection("ltr");
    setCopyFromLanguage("none");
  };

  const handleAddLanguage = () => {
    let translations: Record<string, unknown> = {};

    if (copyFromLanguage && copyFromLanguage !== "none") {
      const sourceLanguage = languages.find(l => l.code === copyFromLanguage);
      if (sourceLanguage) {
        translations = sourceLanguage.translations as Record<string, unknown>;
      }
    }

    createLanguageMutation.mutate({
      code: newLanguageCode,
      name: newLanguageName,
      nativeName: newLanguageNativeName,
      flag: newLanguageFlag || undefined,
      direction: newLanguageDirection,
      translations,
    });
  };

  const handleOpenEdit = (language: PlatformLanguage) => {
    setSelectedLanguage(language);
    setEditName(language.name);
    setEditNativeName(language.nativeName);
    setEditFlag(language.flag || "");
    setEditDirection(language.direction as "ltr" | "rtl");
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!selectedLanguage) return;
    updateLanguageMutation.mutate({
      id: selectedLanguage.id,
      data: {
        name: editName,
        nativeName: editNativeName,
        flag: editFlag || undefined,
        direction: editDirection,
      },
    });
  };

  const handleToggleEnabled = (language: PlatformLanguage) => {
    updateLanguageMutation.mutate({
      id: language.id,
      data: { isEnabled: !language.isEnabled },
    });
  };

  const handleSetDefault = (language: PlatformLanguage) => {
    if (language.isDefault) return;
    updateLanguageMutation.mutate({
      id: language.id,
      data: { isDefault: true },
    });
  };

  const handleOpenTranslationEditor = (language: PlatformLanguage) => {
    setSelectedLanguage(language);
    setEditedTranslations(language.translations as Record<string, unknown>);
    setHasTranslationChanges(false);
    setTranslationSearch("");
    setExpandedSections(new Set());
    setIsTranslationEditorOpen(true);
  };

  const handleTranslationChange = (path: string[], value: string) => {
    const newTranslations = setNestedValue(editedTranslations, path, value);
    setEditedTranslations(newTranslations);
    setHasTranslationChanges(true);
  };

  const handleSaveTranslations = () => {
    if (!selectedLanguage) return;
    updateLanguageMutation.mutate({
      id: selectedLanguage.id,
      data: { translations: editedTranslations },
    });
  };

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const filteredTranslationEntries = useMemo(() => {
    const flattened = flattenTranslations(editedTranslations);
    const englishFlattened = englishLanguage
      ? Object.fromEntries(
        flattenTranslations(englishLanguage.translations as Record<string, unknown>)
          .map(e => [e.key, e.value])
      )
      : {};

    const entries: TranslationEntry[] = flattened.map(entry => ({
      key: entry.key,
      path: entry.key.split("."),
      value: String(entry.value ?? ""),
      englishValue: String(englishFlattened[entry.key] ?? ""),
      isCustom: entry.key.startsWith("custom."),
    }));

    if (!translationSearch) return entries;

    const search = translationSearch.toLowerCase();
    return entries.filter(
      entry =>
        entry.key.toLowerCase().includes(search) ||
        entry.value.toLowerCase().includes(search) ||
        entry.englishValue.toLowerCase().includes(search)
    );
  }, [editedTranslations, englishLanguage, translationSearch]);

  const validateKeyPath = (path: string): string | null => {
    if (!path) return "Key path is required";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(path)) {
      return "Invalid format. Use: section.subsection.key (letters, numbers, underscores only)";
    }
    const existingKeys = flattenTranslations(editedTranslations).map(e => e.key);
    if (existingKeys.includes(path)) {
      return "This key already exists";
    }
    return null;
  };

  const handleAddKey = () => {
    if (!selectedLanguage) return;
    const error = validateKeyPath(newKeyPath);
    if (error) {
      setKeyPathError(error);
      return;
    }

    const values: Record<string, string> = {
      [selectedLanguage.code]: newKeyValue,
    };

    addKeyMutation.mutate({
      keyPath: newKeyPath,
      values,
      syncToAll: syncKeyToAll,
    });
  };

  const handleDeleteKey = () => {
    if (!keyToDelete) return;

    deleteKeyMutation.mutate({
      keyPath: keyToDelete,
      languageId: deleteFromAll ? undefined : selectedLanguage?.id,
    });
  };

  const openDeleteKeyDialog = (keyPath: string) => {
    setKeyToDelete(keyPath);
    setDeleteFromAll(true);
    setIsDeleteKeyDialogOpen(true);
  };

  const groupedTranslations = useMemo(() => {
    const groups: Record<string, TranslationEntry[]> = {};
    for (const entry of filteredTranslationEntries) {
      const section = entry.path[0];
      if (!groups[section]) {
        groups[section] = [];
      }
      groups[section].push(entry);
    }
    return groups;
  }, [filteredTranslationEntries]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (languages.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">{t("admin.languages.title") || "Language Management"}</h2>
          <p className="text-muted-foreground">
            {t("admin.languages.description") || "Manage platform languages and translations"}
          </p>
        </div>

        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="rounded-full bg-muted p-4">
              <Languages className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No Languages Configured</h3>
              <p className="text-muted-foreground mt-1">
                Get started by seeding the default platform languages
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => seedLanguagesMutation.mutate()}
              disabled={seedLanguagesMutation.isPending}
              data-testid="button-seed-languages"
            >
              {seedLanguagesMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sprout className="mr-2 h-4 w-4" />
              )}
              Seed Default Languages
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t("admin.languages.title") || "Language Management"}</h2>
          <p className="text-muted-foreground">
            {t("admin.languages.description") || "Manage platform languages and translations"}
          </p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-language">
          <Plus className="mr-2 h-4 w-4" />
          Add Language
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Platform Languages
          </CardTitle>
          <CardDescription>
            {languages.length} language{languages.length !== 1 ? "s" : ""} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Flag</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Native Name</TableHead>
                <TableHead className="w-20">Code</TableHead>
                <TableHead className="w-24">Direction</TableHead>
                <TableHead className="w-20 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <ArrowUpDown className="h-3 w-3" />
                    Order
                  </div>
                </TableHead>
                <TableHead className="w-24 text-center">Enabled</TableHead>
                <TableHead className="w-24 text-center">Default</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(Array.isArray(languages) ? languages : []).map((language) => (
                <TableRow key={language.id} data-testid={`row-language-${language.id}`}>
                  <TableCell>
                    <div className="w-8 h-8 rounded-full overflow-hidden border border-border shadow-sm">
                      <LanguageFlag code={language.code} flag={language.flag} />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{language.name}</TableCell>
                  <TableCell>{language.nativeName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {language.code}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={language.direction === "rtl" ? "secondary" : "outline"}>
                      {language.direction.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">
                    {language.sortOrder}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={language.isEnabled}
                      onCheckedChange={() => handleToggleEnabled(language)}
                      disabled={language.isDefault || updateLanguageMutation.isPending}
                      data-testid={`switch-enabled-${language.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    {language.isDefault ? (
                      <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                        <Star className="h-3 w-3 mr-1 fill-current" />
                        Default
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefault(language)}
                        disabled={updateLanguageMutation.isPending}
                        data-testid={`button-set-default-${language.id}`}
                      >
                        Set Default
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenTranslationEditor(language)}
                        data-testid={`button-translations-${language.id}`}
                      >
                        <Languages className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(language)}
                        data-testid={`button-edit-${language.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedLanguage(language);
                          setIsDeleteDialogOpen(true);
                        }}
                        disabled={language.isDefault}
                        data-testid={`button-delete-${language.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Language</DialogTitle>
            <DialogDescription>
              Add a new language to the platform
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="languageCode">Language Code *</Label>
              <Input
                id="languageCode"
                placeholder="e.g., en, es, zh-CN"
                value={newLanguageCode}
                onChange={(e) => setNewLanguageCode(e.target.value)}
                maxLength={5}
                data-testid="input-language-code"
              />
              <p className="text-xs text-muted-foreground">2-5 characters, ISO 639-1 format</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="languageName">Display Name *</Label>
              <Input
                id="languageName"
                placeholder="e.g., English, Spanish"
                value={newLanguageName}
                onChange={(e) => setNewLanguageName(e.target.value)}
                data-testid="input-language-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nativeName">Native Name *</Label>
              <Input
                id="nativeName"
                placeholder="e.g., English, Español"
                value={newLanguageNativeName}
                onChange={(e) => setNewLanguageNativeName(e.target.value)}
                data-testid="input-native-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="flag">Flag Emoji</Label>
                <Input
                  id="flag"
                  placeholder="🇺🇸"
                  value={newLanguageFlag}
                  onChange={(e) => setNewLanguageFlag(e.target.value)}
                  data-testid="input-flag"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="direction">Text Direction</Label>
                <Select value={newLanguageDirection} onValueChange={(v) => setNewLanguageDirection(v as "ltr" | "rtl")}>
                  <SelectTrigger data-testid="select-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ltr">LTR (Left to Right)</SelectItem>
                    <SelectItem value="rtl">RTL (Right to Left)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="copyFrom">Copy Translations From</Label>
              <Select value={copyFromLanguage} onValueChange={setCopyFromLanguage}>
                <SelectTrigger data-testid="select-copy-from">
                  <SelectValue placeholder="Start with empty translations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Start with empty translations</SelectItem>
                  {(Array.isArray(languages) ? languages : []).map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optionally copy existing translations as a starting point
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button
              onClick={handleAddLanguage}
              disabled={!newLanguageCode || !newLanguageName || !newLanguageNativeName || createLanguageMutation.isPending}
              data-testid="button-confirm-add"
            >
              {createLanguageMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Language
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Language</DialogTitle>
            <DialogDescription>
              Update language details for {selectedLanguage?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editName">Display Name</Label>
              <Input
                id="editName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editNativeName">Native Name</Label>
              <Input
                id="editNativeName"
                value={editNativeName}
                onChange={(e) => setEditNativeName(e.target.value)}
                data-testid="input-edit-native-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editFlag">Flag Emoji</Label>
                <Input
                  id="editFlag"
                  value={editFlag}
                  onChange={(e) => setEditFlag(e.target.value)}
                  data-testid="input-edit-flag"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDirection">Text Direction</Label>
                <Select value={editDirection} onValueChange={(v) => setEditDirection(v as "ltr" | "rtl")}>
                  <SelectTrigger data-testid="select-edit-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ltr">LTR</SelectItem>
                    <SelectItem value="rtl">RTL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={!editName || !editNativeName || updateLanguageMutation.isPending}
              data-testid="button-confirm-edit"
            >
              {updateLanguageMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Language</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedLanguage?.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedLanguage?.isDefault && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Cannot delete the default language. Set another language as default first.
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedLanguage && deleteLanguageMutation.mutate(selectedLanguage.id)}
              disabled={selectedLanguage?.isDefault || deleteLanguageMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteLanguageMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTranslationEditorOpen} onOpenChange={setIsTranslationEditorOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <span className="text-2xl">{selectedLanguage?.flag}</span>
              {selectedLanguage?.name} Translations
            </DialogTitle>
            <DialogDescription>
              Edit translations for {selectedLanguage?.nativeName}. English reference values are shown for comparison.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search translations by key or value..."
                value={translationSearch}
                onChange={(e) => setTranslationSearch(e.target.value)}
                className="pl-10"
                data-testid="input-translation-search"
              />
            </div>
            {hasTranslationChanges && (
              <Badge variant="secondary" className="animate-pulse">
                Unsaved changes
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNewKeyPath("custom.");
                setNewKeyValue("");
                setKeyPathError(null);
                setIsAddKeyDialogOpen(true);
              }}
              data-testid="button-add-custom-key"
            >
              <Key className="mr-2 h-4 w-4" />
              Add Custom Key
            </Button>
          </div>

          <Alert className="flex-shrink-0">
            <Key className="h-4 w-4" />
            <AlertDescription>
              <strong>Tip:</strong> Use <code className="bg-muted px-1 rounded">custom.</code> prefix for new keys (e.g., <code className="bg-muted px-1 rounded">custom.welcomeMessage</code>). Custom keys can be safely deleted.
            </AlertDescription>
          </Alert>

          <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg">
            <div className="p-4 space-y-2">
              {Object.entries(groupedTranslations).map(([section, entries]) => (
                <div key={section} className="border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between p-3 bg-muted/50 hover-elevate transition-colors"
                    onClick={() => toggleSection(section)}
                    data-testid={`button-section-${section}`}
                  >
                    <span className="font-medium flex items-center gap-2">
                      {expandedSections.has(section) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      {section}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {entries.length} keys
                    </Badge>
                  </button>

                  {expandedSections.has(section) && (
                    <div className="divide-y">
                      {entries.map((entry) => (
                        <div key={entry.key} className="p-3 grid grid-cols-12 gap-4 items-start">
                          <div className="col-span-3">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-mono text-muted-foreground break-all flex-1">
                                {entry.key}
                              </p>
                              {entry.isCustom && (
                                <Badge variant="secondary" className="text-xs shrink-0">
                                  Custom
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="col-span-4">
                            <p className="text-xs text-muted-foreground mb-1">English reference:</p>
                            <p className="text-sm bg-muted/30 p-2 rounded text-muted-foreground">
                              {entry.englishValue || <span className="italic">No English value</span>}
                            </p>
                          </div>
                          <div className="col-span-4">
                            <p className="text-xs text-muted-foreground mb-1">Translation:</p>
                            <Input
                              value={entry.value}
                              onChange={(e) => handleTranslationChange(entry.path, e.target.value)}
                              className="text-sm"
                              data-testid={`input-translation-${entry.key.replace(/\./g, "-")}`}
                            />
                          </div>
                          <div className="col-span-1 flex justify-end">
                            {entry.isCustom && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => openDeleteKeyDialog(entry.key)}
                                    data-testid={`button-delete-key-${entry.key.replace(/\./g, "-")}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Delete this custom key
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {Object.keys(groupedTranslations).length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  {translationSearch ? (
                    <p>No translations matching "{translationSearch}"</p>
                  ) : (
                    <p>No translations available</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsTranslationEditorOpen(false);
                setHasTranslationChanges(false);
              }}
              data-testid="button-cancel-translations"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveTranslations}
              disabled={!hasTranslationChanges || updateLanguageMutation.isPending}
              data-testid="button-save-translations"
            >
              {updateLanguageMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Translations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddKeyDialogOpen} onOpenChange={setIsAddKeyDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Add Custom Translation Key
            </DialogTitle>
            <DialogDescription>
              Add a new translation key to {selectedLanguage?.name}. Use the <code className="bg-muted px-1 rounded">custom.</code> prefix for easy identification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newKeyPath">Key Path *</Label>
              <Input
                id="newKeyPath"
                placeholder="e.g., custom.welcomeMessage"
                value={newKeyPath}
                onChange={(e) => {
                  setNewKeyPath(e.target.value);
                  setKeyPathError(null);
                }}
                className={keyPathError ? "border-destructive" : ""}
                data-testid="input-new-key-path"
              />
              {keyPathError ? (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {keyPathError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Format: section.subsection.key (letters, numbers, underscores)
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="newKeyValue">Translation Value for {selectedLanguage?.name}</Label>
              <Input
                id="newKeyValue"
                placeholder="Enter the translation..."
                value={newKeyValue}
                onChange={(e) => setNewKeyValue(e.target.value)}
                data-testid="input-new-key-value"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="syncToAll"
                checked={syncKeyToAll}
                onCheckedChange={(checked) => setSyncKeyToAll(checked as boolean)}
                data-testid="checkbox-sync-to-all"
              />
              <Label htmlFor="syncToAll" className="text-sm font-normal cursor-pointer">
                Add this key to all languages (with empty value as placeholder)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddKeyDialogOpen(false);
                setNewKeyPath("");
                setNewKeyValue("");
                setKeyPathError(null);
              }}
              data-testid="button-cancel-add-key"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddKey}
              disabled={!newKeyPath || addKeyMutation.isPending}
              data-testid="button-confirm-add-key"
            >
              {addKeyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteKeyDialogOpen} onOpenChange={setIsDeleteKeyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Translation Key
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the key <code className="bg-muted px-1 rounded font-mono">{keyToDelete}</code>?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This action cannot be undone. The translation value will be permanently removed.
              </AlertDescription>
            </Alert>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="deleteFromAll"
                checked={deleteFromAll}
                onCheckedChange={(checked) => setDeleteFromAll(checked as boolean)}
                data-testid="checkbox-delete-from-all"
              />
              <Label htmlFor="deleteFromAll" className="text-sm font-normal cursor-pointer">
                Delete from all languages (recommended)
              </Label>
            </div>
            {!deleteFromAll && (
              <p className="text-xs text-muted-foreground">
                This will only delete the key from {selectedLanguage?.name}. Other languages will keep this key.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteKeyDialogOpen(false);
                setKeyToDelete(null);
              }}
              data-testid="button-cancel-delete-key"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteKey}
              disabled={deleteKeyMutation.isPending}
              data-testid="button-confirm-delete-key"
            >
              {deleteKeyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  );
}
