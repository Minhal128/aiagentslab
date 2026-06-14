import { useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GoogleSheetItem {
  id: string;
  name: string;
}

interface GoogleSheetTab {
  title: string;
  sheetId: number;
}

interface GoogleSheetsPickerProps {
  sheetId: string;
  sheetName: string;
  sheetTitle: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSheetChange: (id: string, title: string) => void;
  onTabChange: (name: string) => void;
}

export function GoogleSheetsPicker({
  sheetId,
  sheetName,
  sheetTitle,
  expanded,
  onToggleExpanded,
  onSheetChange,
  onTabChange,
}: GoogleSheetsPickerProps) {
  const [, setLocation] = useLocation();
  const pendingAutoSelect = useRef(false);

  const { data: status } = useQuery<{ connected: boolean; email?: string }>({
    queryKey: ["/api/integrations/google/status"],
  });

  const { data: sheets = [], isLoading: sheetsLoading } = useQuery<GoogleSheetItem[]>({
    queryKey: ["/api/integrations/google/sheets"],
    enabled: status?.connected === true && expanded,
  });

  const { data: tabs = [], isLoading: tabsLoading } = useQuery<GoogleSheetTab[]>({
    queryKey: ["/api/integrations/google/sheets", sheetId, "tabs"],
    enabled: !!sheetId && status?.connected === true,
  });

  useEffect(() => {
    if (pendingAutoSelect.current && tabs.length > 0) {
      onTabChange(tabs[0].title);
      pendingAutoSelect.current = false;
    }
  }, [tabs]);

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover-elevate"
        onClick={onToggleExpanded}
        data-testid="button-toggle-google-sheets"
      >
        <span className="flex items-center gap-2">
          Send to Google Sheet
          {sheetId && (
            <span className="text-xs text-muted-foreground font-normal">
              ({sheetTitle || "Sheet configured"})
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="p-3 space-y-3 border-t">
          {!status?.connected ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>No Google account connected.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setLocation("/app/tools")}
              >
                Connect in Tools
                <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">Google Sheet</Label>
                <Select
                  value={sheetId || "__none__"}
                  onValueChange={(val) => {
                    if (val === "__none__") {
                      onSheetChange("", "");
                      onTabChange("");
                      return;
                    }
                    const found = sheets.find((s) => s.id === val);
                    onSheetChange(val, found?.name || "");
                    onTabChange("");
                    pendingAutoSelect.current = true;
                  }}
                >
                  <SelectTrigger data-testid="select-google-sheet" className="mt-1">
                    <SelectValue placeholder={sheetsLoading ? "Loading sheets..." : "Select a sheet..."} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" data-testid="option-sheet-none">
                      None (disabled)
                    </SelectItem>
                    {sheets.map((s) => (
                      <SelectItem key={s.id} value={s.id} data-testid={`option-sheet-${s.id}`}>
                        {s.name}
                      </SelectItem>
                    ))}
                    {sheets.length === 0 && !sheetsLoading && (
                      <SelectItem value="__empty__" disabled>
                        No sheets found
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {sheetId && (
                <div>
                  <Label className="text-xs">Worksheet Tab</Label>
                  <Select value={sheetName} onValueChange={onTabChange}>
                    <SelectTrigger data-testid="select-sheet-tab" className="mt-1">
                      <SelectValue placeholder={tabsLoading ? "Loading tabs..." : "Select a tab..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {tabs.length > 0 ? (
                        tabs.map((t) => (
                          <SelectItem key={t.title} value={t.title} data-testid={`option-tab-${t.title}`}>
                            {t.title}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="Sheet1">Sheet1</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
