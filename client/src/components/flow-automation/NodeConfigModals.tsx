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
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { GoogleSheetsPicker } from "@/components/GoogleSheetsPicker";

// ============================================
// MESSAGE NODE CONFIG MODAL
// ============================================
interface MessageNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function MessageNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: MessageNodeConfigProps) {
  const [message, setMessage] = useState(initialConfig?.message || "");
  const [waitForResponse, setWaitForResponse] = useState(
    initialConfig?.waitForResponse ?? false
  );

  useEffect(() => {
    if (initialConfig) {
      setMessage(initialConfig.message || "");
      setWaitForResponse(initialConfig.waitForResponse ?? false);
    }
  }, [initialConfig]);

  const handleSave = () => {
    onSave({
      type: "message",
      message,
      waitForResponse,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-message-config">
        <DialogHeader>
          <DialogTitle>Configure Message Node</DialogTitle>
          <DialogDescription>
            Set the message that will be spoken to the caller
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter the message to speak to the caller..."
              rows={4}
              data-testid="input-message"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="waitForResponse"
              checked={waitForResponse}
              onCheckedChange={(checked) => setWaitForResponse(checked === true)}
              data-testid="checkbox-wait-for-response"
            />
            <Label htmlFor="waitForResponse" className="text-sm font-normal cursor-pointer">
              Wait for response before proceeding
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2 ml-6">
            When OFF (default), agent speaks and immediately continues to the next step
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// QUESTION NODE CONFIG MODAL
// ============================================
interface QuestionNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function QuestionNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: QuestionNodeConfigProps) {
  const [question, setQuestion] = useState(initialConfig?.question || "");
  const [variableName, setVariableName] = useState(
    initialConfig?.variableName || ""
  );
  const [waitForResponse, setWaitForResponse] = useState(
    initialConfig?.waitForResponse ?? true
  );

  useEffect(() => {
    if (initialConfig) {
      setQuestion(initialConfig.question || "");
      setVariableName(initialConfig.variableName || "");
      setWaitForResponse(initialConfig.waitForResponse ?? true);
    }
  }, [initialConfig]);

  const handleSave = () => {
    onSave({
      type: "question",
      question,
      variableName,
      waitForResponse,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-question-config">
        <DialogHeader>
          <DialogTitle>Configure Question Node</DialogTitle>
          <DialogDescription>
            Ask a question and store the response
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="question">Question</Label>
            <Textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What question should the AI ask?"
              rows={3}
              data-testid="input-question"
            />
          </div>

          <div>
            <Label htmlFor="variableName">Variable Name</Label>
            <Input
              id="variableName"
              value={variableName}
              onChange={(e) => setVariableName(e.target.value)}
              placeholder="e.g., customer_name, email, reason"
              data-testid="input-variable-name"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The response will be saved to this variable
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="waitForResponse"
              checked={waitForResponse}
              onCheckedChange={(checked) => setWaitForResponse(checked === true)}
              data-testid="checkbox-wait-for-response"
            />
            <Label htmlFor="waitForResponse" className="text-sm font-normal cursor-pointer">
              Wait for response before proceeding
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2 ml-6">
            When ON (default), agent waits for the caller's answer before moving forward
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// CONDITION NODE CONFIG MODAL
// ============================================
interface Condition {
  id: string;
  variable: string;
  operator: string;
  value: string;
  targetNodeId: string;
}

interface ConditionNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function ConditionNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: ConditionNodeConfigProps) {
  const [conditions, setConditions] = useState<Condition[]>(
    initialConfig?.conditions || []
  );

  useEffect(() => {
    if (initialConfig) {
      setConditions(initialConfig.conditions || []);
    }
  }, [initialConfig]);

  const addCondition = () => {
    setConditions([
      ...conditions,
      {
        id: `cond-${Date.now()}`,
        variable: "",
        operator: "equals",
        value: "",
        targetNodeId: "",
      },
    ]);
  };

  const removeCondition = (id: string) => {
    setConditions(conditions.filter((c) => c.id !== id));
  };

  const updateCondition = (id: string, field: string, value: string) => {
    setConditions(
      conditions.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const handleSave = () => {
    onSave({
      type: "condition",
      conditions,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-condition-config">
        <DialogHeader>
          <DialogTitle>Configure Condition Node</DialogTitle>
          <DialogDescription>
            Create branching logic based on variables
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {conditions.map((condition, index) => (
            <div
              key={condition.id}
              className="p-4 border rounded-md space-y-3"
              data-testid={`condition-${index}`}
            >
              <div className="flex items-center justify-between">
                <Label>Condition {index + 1}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCondition(condition.id)}
                  data-testid={`button-remove-condition-${index}`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor={`variable-${condition.id}`}>Variable</Label>
                  <Input
                    id={`variable-${condition.id}`}
                    value={condition.variable}
                    onChange={(e) =>
                      updateCondition(condition.id, "variable", e.target.value)
                    }
                    placeholder="variable_name"
                    data-testid={`input-variable-${index}`}
                  />
                </div>

                <div>
                  <Label htmlFor={`operator-${condition.id}`}>Operator</Label>
                  <Select
                    value={condition.operator}
                    onValueChange={(value) =>
                      updateCondition(condition.id, "operator", value)
                    }
                  >
                    <SelectTrigger data-testid={`select-operator-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">Equals</SelectItem>
                      <SelectItem value="not_equals">Not Equals</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="not_contains">Not Contains</SelectItem>
                      <SelectItem value="greater_than">Greater Than</SelectItem>
                      <SelectItem value="less_than">Less Than</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor={`value-${condition.id}`}>Value</Label>
                  <Input
                    id={`value-${condition.id}`}
                    value={condition.value}
                    onChange={(e) =>
                      updateCondition(condition.id, "value", e.target.value)
                    }
                    placeholder="value"
                    data-testid={`input-value-${index}`}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor={`target-${condition.id}`}>
                  Then go to Node ID
                </Label>
                <Input
                  id={`target-${condition.id}`}
                  value={condition.targetNodeId}
                  onChange={(e) =>
                    updateCondition(condition.id, "targetNodeId", e.target.value)
                  }
                  placeholder="node-123456"
                  data-testid={`input-target-${index}`}
                />
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            onClick={addCondition}
            className="w-full"
            data-testid="button-add-condition"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Condition
          </Button>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// TRANSFER NODE CONFIG MODAL
// ============================================
interface TransferNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function TransferNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: TransferNodeConfigProps) {
  const [transferNumber, setTransferNumber] = useState(
    initialConfig?.transferNumber || ""
  );
  const [message, setMessage] = useState(
    initialConfig?.message || "Let me transfer you to someone who can help."
  );

  useEffect(() => {
    if (initialConfig) {
      setTransferNumber(initialConfig.transferNumber || "");
      setMessage(
        initialConfig.message || "Let me transfer you to someone who can help."
      );
    }
  }, [initialConfig]);

  const handleSave = () => {
    onSave({
      type: "transfer",
      transferNumber,
      message,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-transfer-config">
        <DialogHeader>
          <DialogTitle>Configure Transfer Node</DialogTitle>
          <DialogDescription>
            Transfer the call to a phone number
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="transferNumber">Transfer Number</Label>
            <Input
              id="transferNumber"
              value={transferNumber}
              onChange={(e) => setTransferNumber(e.target.value)}
              placeholder="+1234567890"
              type="tel"
              data-testid="input-transfer-number"
            />
          </div>

          <div>
            <Label htmlFor="message">Message Before Transfer</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What should the AI say before transferring?"
              rows={3}
              data-testid="input-transfer-message"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// DELAY NODE CONFIG MODAL
// ============================================
interface DelayNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function DelayNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: DelayNodeConfigProps) {
  const [seconds, setSeconds] = useState(initialConfig?.seconds || 5);
  const [waitForResponse, setWaitForResponse] = useState(
    initialConfig?.waitForResponse ?? false
  );

  useEffect(() => {
    if (initialConfig) {
      setSeconds(initialConfig.seconds || 5);
      setWaitForResponse(initialConfig.waitForResponse ?? false);
    }
  }, [initialConfig]);

  const handleSave = () => {
    onSave({
      type: "delay",
      seconds: parseInt(seconds.toString(), 10),
      waitForResponse,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-delay-config">
        <DialogHeader>
          <DialogTitle>Configure Delay Node</DialogTitle>
          <DialogDescription>
            Wait for a specified duration before continuing
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="seconds">Delay (seconds)</Label>
            <Input
              id="seconds"
              value={seconds}
              onChange={(e) => setSeconds(parseInt(e.target.value, 10) || 0)}
              type="number"
              min="1"
              max="60"
              data-testid="input-delay-seconds"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The conversation will pause for this duration
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="waitForResponse"
              checked={waitForResponse}
              onCheckedChange={(checked) => setWaitForResponse(checked === true)}
              data-testid="checkbox-wait-for-response"
            />
            <Label htmlFor="waitForResponse" className="text-sm font-normal cursor-pointer">
              Wait for response before proceeding
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2 ml-6">
            When OFF (default), agent proceeds immediately after delay
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// APPOINTMENT NODE CONFIG MODAL
// ============================================
interface AppointmentNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function AppointmentNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: AppointmentNodeConfigProps) {
  const [confirmMessage, setConfirmMessage] = useState(
    initialConfig?.confirmMessage || "Great! Let me book that appointment for you."
  );
  const [serviceName, setServiceName] = useState(
    initialConfig?.serviceName || ""
  );
  const [duration, setDuration] = useState<number>(initialConfig?.duration || 30);
  const [waitForResponse, setWaitForResponse] = useState(
    initialConfig?.waitForResponse ?? true
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sheetsExpanded, setSheetsExpanded] = useState(
    !!(initialConfig?.googleSheetId)
  );
  const [googleSheetId, setGoogleSheetId] = useState(initialConfig?.googleSheetId || "");
  const [googleSheetName, setGoogleSheetName] = useState(initialConfig?.googleSheetName || "Sheet1");
  const [googleSheetTitle, setGoogleSheetTitle] = useState(initialConfig?.googleSheetTitle || "");

  useEffect(() => {
    if (initialConfig) {
      setConfirmMessage(
        initialConfig.confirmMessage || "Great! Let me book that appointment for you."
      );
      setServiceName(initialConfig.serviceName || "");
      setDuration(initialConfig.duration || 30);
      setWaitForResponse(initialConfig.waitForResponse ?? true);
      setGoogleSheetId(initialConfig.googleSheetId || "");
      setGoogleSheetName(initialConfig.googleSheetName || "Sheet1");
      setGoogleSheetTitle(initialConfig.googleSheetTitle || "");
      setSheetsExpanded(!!(initialConfig.googleSheetId));
    }
  }, [initialConfig]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    const trimmedMessage = confirmMessage.trim();
    if (!trimmedMessage) {
      newErrors.confirmMessage = "Confirmation message is required";
    }
    
    // Check for NaN or invalid duration
    if (isNaN(duration) || duration < 15 || duration > 240) {
      newErrors.duration = "Duration must be a number between 15 and 240 minutes";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const trimmedMessage = confirmMessage.trim();
    const trimmedService = serviceName.trim();

    onSave({
      type: "appointment",
      confirmMessage: trimmedMessage,
      serviceName: trimmedService || undefined,
      duration: Number(duration),
      waitForResponse,
      // Explicitly clear all three fields so deselecting "None" removes stale data from merged config
      googleSheetId: googleSheetId || "",
      googleSheetName: googleSheetId ? googleSheetName : "",
      googleSheetTitle: googleSheetId ? googleSheetTitle : "",
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-appointment-config">
        <DialogHeader>
          <DialogTitle>Configure Appointment Node</DialogTitle>
          <DialogDescription>
            Book an appointment during the call
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="confirmMessage">
              Confirmation Message <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="confirmMessage"
              value={confirmMessage}
              onChange={(e) => {
                setConfirmMessage(e.target.value);
                if (errors.confirmMessage) {
                  setErrors((prev) => ({ ...prev, confirmMessage: "" }));
                }
              }}
              placeholder="What the AI says when booking the appointment..."
              rows={2}
              data-testid="input-confirm-message"
            />
            {errors.confirmMessage && (
              <p className="text-sm text-destructive mt-1">{errors.confirmMessage}</p>
            )}
          </div>

          <div>
            <Label htmlFor="serviceName">Service Name (Optional)</Label>
            <Input
              id="serviceName"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="e.g., Consultation, Demo, Support"
              data-testid="input-service-name"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty for general appointments
            </p>
          </div>

          <div>
            <Label htmlFor="duration">
              Duration (minutes) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="duration"
              value={duration}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setDuration(isNaN(val) ? 30 : val);
                if (errors.duration) {
                  setErrors((prev) => ({ ...prev, duration: "" }));
                }
              }}
              type="number"
              min="15"
              max="240"
              data-testid="input-duration"
            />
            {errors.duration && (
              <p className="text-sm text-destructive mt-1">{errors.duration}</p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="waitForResponse"
              checked={waitForResponse}
              onCheckedChange={(checked) => setWaitForResponse(checked === true)}
              data-testid="checkbox-wait-for-response"
            />
            <Label htmlFor="waitForResponse" className="text-sm font-normal cursor-pointer">
              Wait for response before proceeding
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2 ml-6">
            When ON (default), agent waits for appointment booking to complete
          </p>

          <GoogleSheetsPicker
            sheetId={googleSheetId}
            sheetName={googleSheetName}
            sheetTitle={googleSheetTitle}
            expanded={sheetsExpanded}
            onToggleExpanded={() => setSheetsExpanded((v) => !v)}
            onSheetChange={(id, title) => { setGoogleSheetId(id); setGoogleSheetTitle(title); }}
            onTabChange={setGoogleSheetName}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// FORM NODE CONFIG MODAL
// ============================================
interface FormNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function FormNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: FormNodeConfigProps) {
  const [formId, setFormId] = useState(initialConfig?.formId || "");
  const [waitForResponse, setWaitForResponse] = useState(
    initialConfig?.waitForResponse ?? true
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sheetsExpanded, setSheetsExpanded] = useState(
    !!(initialConfig?.googleSheetId)
  );
  const [googleSheetId, setGoogleSheetId] = useState(initialConfig?.googleSheetId || "");
  const [googleSheetName, setGoogleSheetName] = useState(initialConfig?.googleSheetName || "Sheet1");
  const [googleSheetTitle, setGoogleSheetTitle] = useState(initialConfig?.googleSheetTitle || "");

  // Fetch available forms from backend (returns array directly)
  const { data: forms = [], isLoading } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/flow-automation/forms"],
    enabled: isOpen,
  });

  useEffect(() => {
    if (initialConfig) {
      setFormId(initialConfig.formId || "");
      setWaitForResponse(initialConfig.waitForResponse ?? true);
      setGoogleSheetId(initialConfig.googleSheetId || "");
      setGoogleSheetName(initialConfig.googleSheetName || "Sheet1");
      setGoogleSheetTitle(initialConfig.googleSheetTitle || "");
      setSheetsExpanded(!!(initialConfig.googleSheetId));
    }
  }, [initialConfig]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formId) {
      newErrors.formId = "Please select a form";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    onSave({
      type: "form",
      formId,
      waitForResponse,
      // Explicitly clear all three fields so deselecting "None" removes stale data from merged config
      googleSheetId: googleSheetId || "",
      googleSheetName: googleSheetId ? googleSheetName : "",
      googleSheetTitle: googleSheetId ? googleSheetTitle : "",
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-form-config">
        <DialogHeader>
          <DialogTitle>Configure Form Node</DialogTitle>
          <DialogDescription>
            Collect structured data via a form during the call
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="formId">
              Select Form <span className="text-destructive">*</span>
            </Label>
            <Select
              value={formId}
              onValueChange={(value) => {
                setFormId(value);
                if (errors.formId) {
                  setErrors((prev) => ({ ...prev, formId: "" }));
                }
              }}
            >
              <SelectTrigger data-testid="select-form">
                <SelectValue placeholder={isLoading ? "Loading forms..." : "Select a form..."} />
              </SelectTrigger>
              <SelectContent>
                {forms && forms.length > 0 ? (
                  forms.map((form) => (
                    <SelectItem
                      key={form.id}
                      value={form.id}
                      data-testid={`option-form-${form.id}`}
                    >
                      {form.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-forms" disabled data-testid="option-no-forms">
                    No forms available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {errors.formId && (
              <p className="text-sm text-destructive mt-1">{errors.formId}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Create forms in the Forms section before using them in flows
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="waitForResponse"
              checked={waitForResponse}
              onCheckedChange={(checked) => setWaitForResponse(checked === true)}
              data-testid="checkbox-wait-for-response"
            />
            <Label htmlFor="waitForResponse" className="text-sm font-normal cursor-pointer">
              Wait for response before proceeding
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2 ml-6">
            When ON (default), agent waits for form data collection to complete
          </p>

          <GoogleSheetsPicker
            sheetId={googleSheetId}
            sheetName={googleSheetName}
            sheetTitle={googleSheetTitle}
            expanded={sheetsExpanded}
            onToggleExpanded={() => setSheetsExpanded((v) => !v)}
            onSheetChange={(id, title) => { setGoogleSheetId(id); setGoogleSheetTitle(title); }}
            onTabChange={setGoogleSheetName}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            data-testid="button-save"
            disabled={isLoading || !formId}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// WEBHOOK NODE CONFIG MODAL
// ============================================
interface WebhookNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function WebhookNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: WebhookNodeConfigProps) {
  const [url, setUrl] = useState(initialConfig?.url || "");
  const [method, setMethod] = useState<"POST" | "PUT" | "PATCH">(
    initialConfig?.method || "POST"
  );
  const [headersJson, setHeadersJson] = useState(() => {
    try {
      return JSON.stringify(initialConfig?.headers || {}, null, 2);
    } catch {
      return "{}";
    }
  });
  const [payloadJson, setPayloadJson] = useState(() => {
    try {
      return JSON.stringify(initialConfig?.payload || {}, null, 2);
    } catch {
      return "{}";
    }
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialConfig) {
      setUrl(initialConfig.url || "");
      setMethod(initialConfig.method || "POST");
      try {
        setHeadersJson(JSON.stringify(initialConfig.headers || {}, null, 2));
      } catch {
        setHeadersJson("{}");
      }
      try {
        setPayloadJson(JSON.stringify(initialConfig.payload || {}, null, 2));
      } catch {
        setPayloadJson("{}");
      }
    }
  }, [initialConfig]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    // Validate URL
    if (!url.trim()) {
      newErrors.url = "Webhook URL is required";
    } else {
      try {
        new URL(url);
      } catch {
        newErrors.url = "Please enter a valid URL";
      }
    }

    // Validate method is selected
    if (!method) {
      newErrors.method = "Please select an HTTP method";
    }

    // Validate headers JSON
    let parsedHeaders: Record<string, string> = {};
    try {
      parsedHeaders = JSON.parse(headersJson);
      if (typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
        newErrors.headers = "Headers must be a JSON object";
      }
    } catch {
      newErrors.headers = "Invalid JSON format";
    }

    // Validate payload JSON
    let parsedPayload: Record<string, any> = {};
    try {
      parsedPayload = JSON.parse(payloadJson);
      if (typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
        newErrors.payload = "Payload must be a JSON object";
      }
    } catch {
      newErrors.payload = "Invalid JSON format";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    // Parse with confidence since validation passed
    let parsedHeaders = {};
    let parsedPayload = {};
    
    try {
      parsedHeaders = JSON.parse(headersJson);
      parsedPayload = JSON.parse(payloadJson);
    } catch {
      // Should not happen since validation passed, but safety guard
      return;
    }

    onSave({
      type: "webhook",
      url: url.trim(),
      method,
      headers: parsedHeaders,
      payload: parsedPayload,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-webhook-config">
        <DialogHeader>
          <DialogTitle>Configure Webhook Node</DialogTitle>
          <DialogDescription>
            Trigger a webhook during the conversation. Use template variables like
            {"{"}
            {"{"}contact_name{"}}"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div>
            <Label htmlFor="url">
              Webhook URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (errors.url) {
                  setErrors((prev) => ({ ...prev, url: "" }));
                }
              }}
              placeholder="https://example.com/webhook"
              type="url"
              data-testid="input-webhook-url"
            />
            {errors.url && (
              <p className="text-sm text-destructive mt-1">{errors.url}</p>
            )}
          </div>

          <div>
            <Label htmlFor="method">HTTP Method</Label>
            <Select value={method} onValueChange={(value: any) => setMethod(value)}>
              <SelectTrigger data-testid="select-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="POST" data-testid="option-method-post">
                  POST
                </SelectItem>
                <SelectItem value="PUT" data-testid="option-method-put">
                  PUT
                </SelectItem>
                <SelectItem value="PATCH" data-testid="option-method-patch">
                  PATCH
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="headers">Headers (JSON)</Label>
            <Textarea
              id="headers"
              value={headersJson}
              onChange={(e) => {
                // Safe onChange - don't parse, just update state
                setHeadersJson(e.target.value);
                // Clear error optimistically
                if (errors.headers) {
                  setErrors((prev) => ({ ...prev, headers: "" }));
                }
              }}
              placeholder='{"Authorization": "Bearer token", "Content-Type": "application/json"}'
              rows={4}
              className="font-mono text-sm"
              data-testid="input-headers"
            />
            {errors.headers && (
              <p className="text-sm text-destructive mt-1">{errors.headers}</p>
            )}
          </div>

          <div>
            <Label htmlFor="payload">Payload (JSON)</Label>
            <Textarea
              id="payload"
              value={payloadJson}
              onChange={(e) => {
                // Safe onChange - don't parse, just update state
                setPayloadJson(e.target.value);
                // Clear error optimistically
                if (errors.payload) {
                  setErrors((prev) => ({ ...prev, payload: "" }));
                }
              }}
              placeholder='{"name": "{{contact_name}}", "phone": "{{contact_phone}}"}'
              rows={6}
              className="font-mono text-sm"
              data-testid="input-payload"
            />
            {errors.payload && (
              <p className="text-sm text-destructive mt-1">{errors.payload}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Use {"{"}
              {"{"}variable{"}"} syntax for dynamic values
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// END NODE CONFIG MODAL
// ============================================
interface EndNodeConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export function EndNodeConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}: EndNodeConfigProps) {
  const [message, setMessage] = useState(
    initialConfig?.message || "Thank you for your time. Goodbye!"
  );

  useEffect(() => {
    if (initialConfig) {
      setMessage(initialConfig.message || "Thank you for your time. Goodbye!");
    }
  }, [initialConfig]);

  const handleSave = () => {
    onSave({
      type: "end",
      message,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-end-config">
        <DialogHeader>
          <DialogTitle>Configure End Node</DialogTitle>
          <DialogDescription>
            Set the final message before ending the conversation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="message">Goodbye Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Final message before ending the call..."
              rows={3}
              data-testid="input-end-message"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
