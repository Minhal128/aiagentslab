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
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, FileText, Trash2, Eye, GripVertical, X, ClipboardList, CheckSquare, Download, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { AuthStorage } from "@/lib/auth-storage";

interface Form {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: string;
}

interface FormField {
  id: string;
  formId: string;
  label: string;
  type: string;
  required: boolean;
  options: string[] | null;
  order: number;
}

interface FormSubmissionResponse {
  fieldId: string;
  question: string;
  answer: string;
}

interface FormSubmission {
  id: string;
  formId: string;
  callId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  responses: FormSubmissionResponse[] | null;
  submittedAt: string;
}

interface FormWithFields extends Form {
  fields: FormField[];
}

export default function FormsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [submissionsDialogOpen, setSubmissionsDialogOpen] = useState(false);
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
  });
  const [fields, setFields] = useState<Array<{
    tempId: string;
    label: string;
    type: string;
    required: boolean;
    options: string;
  }>>([]);

  const fieldTypeOptions = [
    { value: "text", label: t("forms.fieldTypes.text") },
    { value: "yes_no", label: t("forms.fieldTypes.yesNo") },
    { value: "multiple_choice", label: t("forms.fieldTypes.multipleChoice") },
    { value: "number", label: t("forms.fieldTypes.number") },
  ];

  const { data: forms = [], isLoading } = useQuery<Form[]>({
    queryKey: ["/api/flow-automation/forms"],
  });

  const { data: submissions = [] } = useQuery<FormSubmission[]>({
    queryKey: [`/api/flow-automation/forms/${selectedForm?.id}/submissions`],
    enabled: !!selectedForm?.id,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      // Map frontend field properties to backend expected names
      const mappedFields = fields.map((field, index) => {
        let options = null;
        if (field.type === "multiple_choice" && field.options.trim()) {
          options = field.options.split(",").map((o) => o.trim()).filter(Boolean);
        }
        return {
          question: field.label,
          fieldType: field.type,
          isRequired: field.required,
          options,
          order: index,
        };
      });

      const formRes = await apiRequest("POST", "/api/flow-automation/forms", {
        name: formData.name,
        description: formData.description || null,
        fields: mappedFields,
      });
      const newForm = await formRes.json();

      return newForm;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/forms"] });
      toast({ title: t("forms.toast.created") });
      handleCloseCreate();
    },
    onError: (error: any) => {
      toast({
        title: t("forms.toast.createFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/flow-automation/forms/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/forms"] });
      toast({ title: t("forms.toast.deleted") });
    },
    onError: (error: any) => {
      toast({
        title: t("forms.toast.deleteFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCloseCreate = () => {
    setCreateDialogOpen(false);
    setFormData({ name: "", description: "" });
    setFields([]);
  };

  const addField = () => {
    setFields([
      ...fields,
      {
        tempId: `temp-${Date.now()}`,
        label: "",
        type: "text",
        required: false,
        options: "",
      },
    ]);
  };

  const updateField = (tempId: string, updates: Partial<typeof fields[0]>) => {
    setFields(fields.map((f) => (f.tempId === tempId ? { ...f, ...updates } : f)));
  };

  const removeField = (tempId: string) => {
    setFields(fields.filter((f) => f.tempId !== tempId));
  };

  const moveField = (tempId: string, direction: "up" | "down") => {
    const index = fields.findIndex((f) => f.tempId === tempId);
    if (index === -1) return;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === fields.length - 1) return;

    const newFields = [...fields];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    [newFields[index], newFields[swapIndex]] = [newFields[swapIndex], newFields[index]];
    setFields(newFields);
  };

  const handleViewSubmissions = (form: Form) => {
    setSelectedForm(form);
    setSubmissionsDialogOpen(true);
  };

  const handleDownloadCSV = () => {
    if (!selectedForm || submissions.length === 0) return;
    
    // Build CSV headers from all unique questions
    const headers = ["Submission ID", "Contact Name", "Contact Phone", "Submitted At"];
    const allQuestions = new Set<string>();
    submissions.forEach(sub => {
      (sub.responses || []).forEach(r => allQuestions.add(r.question));
    });
    const questionHeaders = Array.from(allQuestions);
    headers.push(...questionHeaders);
    
    // Build CSV rows
    const rows = submissions.map(sub => {
      const row: string[] = [
        sub.id,
        sub.contactName || "N/A",
        sub.contactPhone || "N/A",
        format(new Date(sub.submittedAt), "yyyy-MM-dd HH:mm:ss"),
      ];
      
      // Add answers in the same order as question headers
      questionHeaders.forEach(question => {
        const response = (sub.responses || []).find(r => r.question === question);
        row.push(response ? response.answer : "");
      });
      
      return row;
    });
    
    // Escape CSV values
    const escapeCSV = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };
    
    const csvContent = [
      headers.map(escapeCSV).join(","),
      ...rows.map(row => row.map(escapeCSV).join(","))
    ].join("\n");
    
    // Download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedForm.name.replace(/[^a-z0-9]/gi, "_")}_submissions_${format(new Date(), "yyyyMMdd")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    toast({ title: t("forms.toast.downloadSuccess") });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">{t("forms.loading")}</div>
        </div>
      </div>
    );
  }

  const totalForms = forms.length;
  // Calculate total submissions from all forms (using submissionCount from API)
  const totalSubmissions = forms.reduce((sum, form) => sum + ((form as any).submissionCount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand/5 via-brand/3 to-brand/5 dark:from-brand/10 dark:via-brand/5 dark:to-brand/10 border border-cyan-100 dark:border-cyan-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand to-brand/90 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <ClipboardList className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground" data-testid="text-page-title">
                {t("forms.title")}
              </h1>
              <p className="text-muted-foreground mt-0.5">{t("forms.subtitle")}</p>
            </div>
          </div>
          <Button 
            onClick={() => setCreateDialogOpen(true)} 
            className="bg-cyan-600 hover:bg-cyan-700 text-white"
            data-testid="button-create-form"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("forms.createForm")}
          </Button>
        </div>

        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-cyan-100/50 dark:border-cyan-800/30">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              <div className="text-2xl font-bold text-cyan-700 dark:text-cyan-300">{totalForms}</div>
            </div>
            <div className="text-cyan-600/70 dark:text-cyan-400/70 text-sm">{t("forms.totalForms")}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-brand/10">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-brand" />
              <div className="text-2xl font-bold text-brand">{totalSubmissions}</div>
            </div>
            <div className="text-brand/70 text-sm">{t("forms.submissions")}</div>
          </div>
        </div>
      </div>

      {forms.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t("forms.noForms")}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              {t("forms.noFormsDescription")}
            </p>
            <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-first-form">
              <Plus className="h-4 w-4 mr-2" />
              {t("forms.createFirstForm")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {forms.map((form) => (
            <Card key={form.id} className="hover-elevate">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-lg" data-testid={`text-form-name-${form.id}`}>
                        {form.name}
                      </CardTitle>
                    </div>
                    {form.description && (
                      <CardDescription className="text-sm">{form.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewSubmissions(form)}
                      data-testid={`button-view-submissions-${form.id}`}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      {t("forms.viewSubmissions")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteMutation.mutate(form.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${form.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {t("forms.createdOn")} {format(new Date(form.createdAt), "MMM d, yyyy")}
                  </div>
                  <Badge variant="secondary" data-testid={`badge-submissions-${form.id}`}>
                    {(form as any).submissionCount || 0} {t("forms.submissions").toLowerCase()}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-create-dialog-title">{t("forms.createForm")}</DialogTitle>
            <DialogDescription>{t("forms.buildCustomForm")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="form-name">{t("forms.formNameRequired")}</Label>
                <Input
                  id="form-name"
                  placeholder={t("forms.formNamePlaceholder")}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  data-testid="input-form-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="form-description">{t("forms.formDescription")}</Label>
                <Textarea
                  id="form-description"
                  placeholder={t("forms.descriptionPlaceholder")}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  data-testid="input-form-description"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{t("forms.formFields")}</h3>
                <Button onClick={addField} variant="outline" size="sm" data-testid="button-add-field">
                  <Plus className="h-4 w-4 mr-2" />
                  {t("forms.addField")}
                </Button>
              </div>

              {fields.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
                  {t("forms.addFieldHint")}
                </div>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-3 pr-4">
                    {fields.map((field, index) => (
                      <Card key={field.tempId} className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col gap-1 pt-7">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => moveField(field.tempId, "up")}
                                disabled={index === 0}
                                data-testid={`button-move-up-${field.tempId}`}
                              >
                                ▲
                              </Button>
                              <GripVertical className="h-4 w-4 text-muted-foreground" />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => moveField(field.tempId, "down")}
                                disabled={index === fields.length - 1}
                                data-testid={`button-move-down-${field.tempId}`}
                              >
                                ▼
                              </Button>
                            </div>

                            <div className="flex-1 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                  <Label>{t("forms.fieldLabel")}</Label>
                                  <Input
                                    placeholder={t("forms.fieldLabelPlaceholder")}
                                    value={field.label}
                                    onChange={(e) => updateField(field.tempId, { label: e.target.value })}
                                    data-testid={`input-field-label-${field.tempId}`}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>{t("forms.fieldType")}</Label>
                                  <Select
                                    value={field.type}
                                    onValueChange={(value) => updateField(field.tempId, { type: value })}
                                  >
                                    <SelectTrigger data-testid={`select-field-type-${field.tempId}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {fieldTypeOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              {field.type === "multiple_choice" && (
                                <div className="space-y-2">
                                  <Label>{t("forms.fieldOptions")}</Label>
                                  <Input
                                    placeholder={t("forms.optionsPlaceholder")}
                                    value={field.options}
                                    onChange={(e) => updateField(field.tempId, { options: e.target.value })}
                                    data-testid={`input-field-options-${field.tempId}`}
                                  />
                                </div>
                              )}

                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  id={`required-${field.tempId}`}
                                  checked={field.required}
                                  onChange={(e) => updateField(field.tempId, { required: e.target.checked })}
                                  data-testid={`checkbox-required-${field.tempId}`}
                                  className="h-4 w-4"
                                />
                                <Label htmlFor={`required-${field.tempId}`} className="cursor-pointer">
                                  {t("forms.requiredField")}
                                </Label>
                              </div>
                            </div>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeField(field.tempId)}
                              data-testid={`button-remove-field-${field.tempId}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseCreate} data-testid="button-cancel-create">
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formData.name || fields.length === 0 || createMutation.isPending}
              data-testid="button-submit-create"
            >
              {t("forms.createFormButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={submissionsDialogOpen} onOpenChange={setSubmissionsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-submissions-dialog-title">
              {t("forms.formSubmissions")}
            </DialogTitle>
            <DialogDescription>
              {selectedForm?.name}
            </DialogDescription>
          </DialogHeader>

          {submissions.length > 0 && (
            <div className="flex justify-end mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadCSV}
                data-testid="button-download-csv"
              >
                <Download className="h-4 w-4 mr-2" />
                {t("forms.downloadCSV")}
              </Button>
            </div>
          )}

          <ScrollArea className="h-96">
            {submissions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {t("forms.noSubmissions")}
              </div>
            ) : (
              <div className="space-y-3 pr-4">
                {submissions.map((submission) => (
                  <Card key={submission.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {t("forms.callId")}: {submission.callId ? submission.callId.slice(0, 12) + '...' : 'N/A'}
                          </span>
                          {submission.callId && (
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              data-testid={`button-view-call-${submission.id}`}
                            >
                              <Link href={`/app/calls/${submission.callId}`}>
                                <ExternalLink className="h-3 w-3 mr-1" />
                                {t("forms.viewCall")}
                              </Link>
                            </Button>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(submission.submittedAt), "MMM d, yyyy h:mm a")}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {submission.contactName && (
                          <div className="flex gap-3 text-sm">
                            <div className="font-medium min-w-[140px]">{t("forms.contactName")}:</div>
                            <div className="text-muted-foreground flex-1">{submission.contactName}</div>
                          </div>
                        )}
                        {submission.contactPhone && (
                          <div className="flex gap-3 text-sm">
                            <div className="font-medium min-w-[140px]">{t("forms.contactPhone")}:</div>
                            <div className="text-muted-foreground flex-1">{submission.contactPhone}</div>
                          </div>
                        )}
                        {(submission.responses || []).map((response, idx) => (
                          <div key={idx} className="flex gap-3 text-sm">
                            <div className="font-medium min-w-[140px]">{response.question}:</div>
                            <div className="text-muted-foreground flex-1">{response.answer}</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
