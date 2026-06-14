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
import { useLocation } from "wouter";
import { AlertTriangle, Phone, ShoppingCart, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

export interface PhoneConflictDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  conflictType?: "incoming_connection" | "active_campaign";
  connectedAgentName?: string;
  campaignName?: string;
}

export function PhoneConflictDialog({
  open,
  onClose,
  title,
  message,
  conflictType,
  connectedAgentName,
  campaignName,
}: PhoneConflictDialogProps) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  const handleBuyNewNumber = () => {
    onClose();
    setLocation("/app/phone-numbers");
  };

  const dialogTitle = title || t("phoneConflict.title", "Phone Number Conflict");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-phone-conflict">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <DialogTitle className="text-xl" data-testid="text-conflict-title">
              {dialogTitle}
            </DialogTitle>
          </div>
        </DialogHeader>
        
        <div className="py-4">
          <DialogDescription className="text-base leading-relaxed" data-testid="text-conflict-message">
            {message}
          </DialogDescription>
          
          {conflictType === "incoming_connection" && connectedAgentName && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-muted p-3">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {t("phoneConflict.connectedTo", "Currently connected to:")}
              </span>
              <span className="text-sm font-medium" data-testid="text-connected-agent">
                {connectedAgentName}
              </span>
            </div>
          )}
          
          {conflictType === "active_campaign" && campaignName && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-muted p-3">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {t("phoneConflict.usedByCampaign", "Used by campaign:")}
              </span>
              <span className="text-sm font-medium" data-testid="text-campaign-name">
                {campaignName}
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-conflict-close"
          >
            <X className="mr-2 h-4 w-4" />
            {t("common.close", "Close")}
          </Button>
          <Button
            onClick={handleBuyNewNumber}
            data-testid="button-buy-new-number"
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {t("phoneConflict.buyNewNumber", "Buy New Number")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface PhoneConflictState {
  isOpen: boolean;
  title?: string;
  message: string;
  conflictType?: "incoming_connection" | "active_campaign";
  connectedAgentName?: string;
  campaignName?: string;
}

export const initialPhoneConflictState: PhoneConflictState = {
  isOpen: false,
  message: "",
};

export function parsePhoneConflictFromError(error: any): PhoneConflictState | null {
  if (!error) return null;
  
  const status = error.status || error.response?.status;
  const data = error.data || error.response?.data || error;
  
  if (status === 409 && data.conflictType) {
    return {
      isOpen: true,
      title: data.error || "Phone Number Conflict",
      message: data.message || data.error || "This phone number has a conflict.",
      conflictType: data.conflictType,
      connectedAgentName: data.connectedAgentName,
      campaignName: data.campaignName,
    };
  }
  
  return null;
}
