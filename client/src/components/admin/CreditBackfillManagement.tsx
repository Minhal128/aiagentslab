import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, RefreshCw, PlayCircle } from "lucide-react";

type Engine =
  | "elevenlabs-twilio"
  | "twilio-openai"
  | "plivo-openai"
  | "elevenlabs-sip"
  | "openai-sip";

interface EngineScanResult {
  engine: Engine;
  unbilled: number;
  estimatedCredits: number;
  uniqueUsers: number;
  sampleIds: string[];
}

interface ScanResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totals: { unbilled: number; estimatedCredits: number; uniqueUsers: number };
  engines: EngineScanResult[];
  error?: string;
}

interface EngineBackfillResult {
  engine: Engine;
  scanned: number;
  charged: number;
  alreadyDeducted: number;
  insufficientCredits: number;
  errors: number;
  totalCreditsDeducted: number;
}

interface BackfillResult {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  engines: EngineBackfillResult[];
  totals: { scanned: number; charged: number; totalCreditsDeducted: number; errors: number };
}

interface StatusResponse {
  success: boolean;
  data: {
    engines: Engine[];
    lastScan: ScanResult | null;
    lastBackfill: BackfillResult | null;
  };
}

function formatTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function CreditBackfillManagement() {
  const { toast } = useToast();
  const [sinceDays, setSinceDays] = useState<number>(30);
  const [dryRun, setDryRun] = useState<boolean>(true);

  const { data, isLoading } = useQuery<StatusResponse>({
    queryKey: ["/api/admin/credit-backfill/status"],
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/credit-backfill/scan", {
        sinceDays,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Scan complete", description: "Latest results loaded." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/credit-backfill/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Scan failed", description: err?.message || "Unknown error", variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/credit-backfill/run", {
        sinceDays,
        dryRun,
      });
      return res.json();
    },
    onSuccess: (json: any) => {
      const r: BackfillResult = json?.data;
      toast({
        title: dryRun ? "Dry run complete" : "Backfill complete",
        description: r
          ? `Scanned ${r.totals.scanned}, charged ${r.totals.charged} (${r.totals.totalCreditsDeducted} credits), ${r.totals.errors} error(s).`
          : "Done.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/credit-backfill/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Backfill failed", description: err?.message || "Unknown error", variant: "destructive" });
    },
  });

  const lastScan = data?.data?.lastScan;
  const lastBackfill = data?.data?.lastBackfill;
  const totalUnbilled = lastScan?.totals?.unbilled ?? 0;

  return (
    <div className="space-y-6" data-testid="page-credit-backfill">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Credit Backfill Monitor</h2>
        <p className="text-muted-foreground">
          Daily detection sweep that flags completed calls with no matching credit transaction.
          Read-only by default — trigger a backfill from here when something is found.
        </p>
      </div>

      {totalUnbilled > 0 && (
        <Alert variant="destructive" data-testid="alert-unbilled">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Un-billed calls detected</AlertTitle>
          <AlertDescription>
            {totalUnbilled} completed call(s) ({lastScan?.totals.estimatedCredits ?? 0} credits across{" "}
            {lastScan?.totals.uniqueUsers ?? 0} user(s)) have no matching credit transaction.
            Review the per-engine breakdown below and run a backfill when ready.
          </AlertDescription>
        </Alert>
      )}

      {totalUnbilled === 0 && lastScan && !lastScan.error && (
        <Alert data-testid="alert-clean">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>All clear</AlertTitle>
          <AlertDescription>
            Last scan ({formatTime(lastScan.finishedAt)}) found no un-billed calls.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Run a scan or backfill</CardTitle>
          <CardDescription>
            Detection is always read-only. Backfill will deduct credits using the same idempotent path
            as live calls — already-charged calls are skipped automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="since-days">Look back (days)</Label>
              <Input
                id="since-days"
                type="number"
                min={1}
                max={3650}
                value={sinceDays}
                onChange={(e) => setSinceDays(Math.max(1, Number(e.target.value) || 1))}
                className="w-32"
                data-testid="input-since-days"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="dry-run"
                checked={dryRun}
                onCheckedChange={setDryRun}
                data-testid="switch-dry-run"
              />
              <Label htmlFor="dry-run">Dry run (no credits deducted)</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending}
                data-testid="button-run-scan"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${scanMutation.isPending ? "animate-spin" : ""}`} />
                Run scan
              </Button>
              <Button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending}
                data-testid="button-run-backfill"
              >
                <PlayCircle className={`h-4 w-4 mr-2 ${runMutation.isPending ? "animate-pulse" : ""}`} />
                {dryRun ? "Run dry-run backfill" : "Run backfill"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest scan</CardTitle>
          <CardDescription>
            {lastScan
              ? `Finished ${formatTime(lastScan.finishedAt)} · took ${lastScan.durationMs}ms`
              : "No scan has run yet — scans run automatically once a day after startup."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : lastScan ? (
            <div className="space-y-3">
              {lastScan.error && (
                <Alert variant="destructive">
                  <AlertDescription>{lastScan.error}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {lastScan.engines.map((e) => (
                  <Card key={e.engine} data-testid={`card-engine-${e.engine}`}>
                    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                      <CardTitle className="text-base">{e.engine}</CardTitle>
                      <Badge variant={e.unbilled > 0 ? "destructive" : "secondary"}>
                        {e.unbilled} un-billed
                      </Badge>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Credits owed</span>
                        <span data-testid={`text-credits-${e.engine}`}>{e.estimatedCredits}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Users affected</span>
                        <span>{e.uniqueUsers}</span>
                      </div>
                      {e.sampleIds.length > 0 && (
                        <div className="text-xs text-muted-foreground break-all pt-2">
                          Sample: {e.sampleIds.join(", ")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          )}
        </CardContent>
      </Card>

      {lastBackfill && (
        <Card>
          <CardHeader>
            <CardTitle>Latest backfill run</CardTitle>
            <CardDescription>
              Finished {formatTime(lastBackfill.finishedAt)} · {lastBackfill.dryRun ? "dry run" : "live"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {lastBackfill.engines.map((e) => (
                <Card key={e.engine}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{e.engine}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Scanned</span>
                      <span>{e.scanned}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Charged</span>
                      <span>{e.charged}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Already deducted</span>
                      <span>{e.alreadyDeducted}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Insufficient credits</span>
                      <span>{e.insufficientCredits}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Credits deducted</span>
                      <span data-testid={`text-deducted-${e.engine}`}>{e.totalCreditsDeducted}</span>
                    </div>
                    {e.errors > 0 && (
                      <div className="flex justify-between gap-2 text-destructive">
                        <span>Errors</span>
                        <span>{e.errors}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
