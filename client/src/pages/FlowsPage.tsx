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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Edit, Trash2, GitBranch, Play, FileText, LayoutTemplate, AlertTriangle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { nanoid } from "nanoid";
import { TestFlowDialog } from "@/components/TestFlowDialog";
import { DataPagination, usePagination } from "@/components/ui/data-pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FlowTemplatesPage from "@/pages/FlowTemplatesPage";
import FlowExecutionLogsPage from "@/pages/FlowExecutionLogsPage";

export default function FlowsPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [flowToDelete, setFlowToDelete] = useState<any>(null);
  const [flowToTest, setFlowToTest] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("flows");

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const tab = params.get("tab");
    if (tab === "templates") {
      setActiveTab("templates");
    } else if (tab === "execution") {
      setActiveTab("execution");
    }
  }, [searchString]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === "flows") {
      setLocation("/app/flows");
    } else {
      setLocation(`/app/flows?tab=${value}`);
    }
  };

  // Fetch all flows
  const { data: flows, isLoading } = useQuery<any[]>({
    queryKey: ["/api/flow-automation/flows"],
  });

  // Fetch flow usage limits
  const { data: usage } = useQuery<any>({
    queryKey: ["/api/usage"],
  });
  const flowUsage = usage?.flows;
  const isAtLimit = flowUsage && flowUsage.max !== 999 && flowUsage.max !== -1 && flowUsage.current >= flowUsage.max;
  const isNearLimit = flowUsage && flowUsage.max !== 999 && flowUsage.max !== -1 && !isAtLimit && flowUsage.remaining <= 1;

  // Pagination
  const {
    currentPage,
    totalPages,
    totalItems,
    itemsPerPage,
    paginatedItems: paginatedFlows,
    handlePageChange,
    handleItemsPerPageChange,
  } = usePagination(flows || [], 9);

  // Delete flow mutation
  const deleteMutation = useMutation({
    mutationFn: async (flowId: string) => {
      return apiRequest("DELETE", `/api/flow-automation/flows/${flowId}`);
    },
    onSuccess: () => {
      toast({
        title: "Flow deleted",
        description: "The flow has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/flows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usage"] });
      setFlowToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting flow",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Toggle active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ flowId, isActive }: { flowId: string; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/flow-automation/flows/${flowId}`, { isActive });
    },
    onSuccess: () => {
      toast({
        title: "Flow updated",
        description: "Flow status has been updated",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/flows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usage"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating flow",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create new flow mutation
  const createNewFlowMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/flow-automation/flows", {
        name: "Untitled Flow",
        description: "",
        nodes: [],
        edges: [],
        isActive: false,
      });
      return await response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/flows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usage"] });
      if (data?.id) {
        setLocation(`/app/flows/${data.id}`);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error creating flow",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create template flow mutation
  const createTemplateFlowMutation = useMutation({
    mutationFn: async () => {
      // Generate unique IDs for each node to avoid collisions
      const nodeIds = {
        start: `node-${nanoid()}`,
        question: `node-${nanoid()}`,
        condition: `node-${nanoid()}`,
        transfer: `node-${nanoid()}`,
        end: `node-${nanoid()}`,
      };
      
      // Pre-configured Call Transfer Flow template
      // Node type must match data.type for React Flow to render correctly
      const templateNodes = [
        {
          id: nodeIds.start,
          type: "message",
          position: { x: 250, y: 50 },
          data: {
            type: "message",
            label: "Greeting",
            config: {
              type: "message",
              message: "Hello! Thank you for calling. How can I help you today?",
            },
          },
        },
        {
          id: nodeIds.question,
          type: "question",
          position: { x: 250, y: 180 },
          data: {
            type: "question",
            label: "Ask Transfer",
            config: {
              type: "question",
              question: "Would you like me to transfer your call to a specialist?",
              variableName: "transfer_consent",
            },
          },
        },
        {
          id: nodeIds.condition,
          type: "condition",
          position: { x: 250, y: 310 },
          data: {
            type: "condition",
            label: "Check Response",
            config: {
              type: "condition",
              condition: 'The caller wants to be transferred or said yes',
            },
          },
        },
        {
          id: nodeIds.transfer,
          type: "transfer",
          position: { x: 100, y: 440 },
          data: {
            type: "transfer",
            label: "Transfer Call",
            config: {
              type: "transfer",
              transferNumber: "+1234567890",
              message: "I'll transfer you now. Please hold.",
            },
          },
        },
        {
          id: nodeIds.end,
          type: "end",
          position: { x: 400, y: 440 },
          data: {
            type: "end",
            label: "End Call",
            config: {
              type: "end",
              endMessage: "Thank you for calling. Have a great day!",
            },
          },
        },
      ];

      const templateEdges = [
        {
          id: `edge-${nanoid()}`,
          source: nodeIds.start,
          target: nodeIds.question,
          animated: true,
        },
        {
          id: `edge-${nanoid()}`,
          source: nodeIds.question,
          target: nodeIds.condition,
          animated: true,
        },
        {
          id: `edge-${nanoid()}`,
          source: nodeIds.condition,
          sourceHandle: "true",
          target: nodeIds.transfer,
          animated: true,
        },
        {
          id: `edge-${nanoid()}`,
          source: nodeIds.condition,
          sourceHandle: "false",
          target: nodeIds.end,
          animated: true,
        },
      ];

      const response = await apiRequest("POST", "/api/flow-automation/flows", {
        name: "Call Transfer Flow (Template)",
        description: "Example flow showing how to ask permission and transfer calls based on user response",
        nodes: templateNodes,
        edges: templateEdges,
        isActive: false,
      });
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Template created",
        description: "Call Transfer Flow template has been created",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/flow-automation/flows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usage"] });
      if (data?.id) {
        setLocation(`/app/flows/${data.id}`);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error creating template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">Flow Builder</h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Create and manage conversation flows with drag-and-drop visual builder
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <TabsList data-testid="tabs-flows">
              <TabsTrigger value="flows" data-testid="tab-flows">
                <GitBranch className="w-4 h-4 mr-2" />
                My Flows ({flows?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="templates" data-testid="tab-templates">
                <LayoutTemplate className="w-4 h-4 mr-2" />
                Templates
              </TabsTrigger>
              <TabsTrigger value="execution" data-testid="tab-execution-logs">
                <Play className="w-4 h-4 mr-2" />
                Execution Logs
              </TabsTrigger>
            </TabsList>
            {activeTab === "flows" && flowUsage && flowUsage.max !== 999 && flowUsage.max !== -1 && (
              <div className="flex flex-col gap-0.5" data-testid="text-flow-usage">
                <div
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border ${
                    isAtLimit || isNearLimit
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {(isAtLimit || isNearLimit) && <AlertTriangle className="w-3 h-3" />}
                  <span>{flowUsage.current} / {flowUsage.max} flows</span>
                </div>
                {isAtLimit && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Delete a flow or upgrade to create more
                  </span>
                )}
                {isNearLimit && !isAtLimit && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Almost at your flow limit
                  </span>
                )}
              </div>
            )}
          </div>

          {activeTab === "flows" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={createNewFlowMutation.isPending || createTemplateFlowMutation.isPending}
                  data-testid="button-create-flow"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {createNewFlowMutation.isPending || createTemplateFlowMutation.isPending ? "Creating..." : "Create Flow"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => createNewFlowMutation.mutate()} data-testid="menu-item-blank-flow">
                  <Plus className="w-4 h-4 mr-2" />
                  Blank Flow
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => createTemplateFlowMutation.mutate()} data-testid="menu-item-template-flow">
                  <FileText className="w-4 h-4 mr-2" />
                  Call Transfer Template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <TabsContent value="flows" className="space-y-4">

      {!flows || flows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <GitBranch className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No flows yet</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              Create your first visual conversation flow to build complex multi-step conversations
            </p>
            <div className="space-y-3">
              <Button 
                onClick={() => createNewFlowMutation.mutate()} 
                disabled={createNewFlowMutation.isPending}
                data-testid="button-create-first-flow"
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                {createNewFlowMutation.isPending ? "Creating..." : "Create Blank Flow"}
              </Button>
              <Button 
                onClick={() => createTemplateFlowMutation.mutate()} 
                disabled={createTemplateFlowMutation.isPending}
                variant="outline"
                data-testid="button-create-template-flow"
                className="w-full"
              >
                <FileText className="w-4 h-4 mr-2" />
                {createTemplateFlowMutation.isPending ? "Creating..." : "Use Call Transfer Template"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {paginatedFlows.map((flow) => (
              <Card key={flow.id} className="hover-elevate" data-testid={`card-flow-${flow.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-primary" />
                      <Badge variant={flow.isActive ? "default" : "secondary"} className="text-xs">
                        {flow.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={flow.isActive}
                        onCheckedChange={(checked) =>
                          toggleActiveMutation.mutate({ flowId: flow.id, isActive: checked })
                        }
                        data-testid={`switch-flow-active-${flow.id}`}
                      />
                    </div>
                  </div>
                  <CardTitle className="text-xl" data-testid={`text-flow-name-${flow.id}`}>
                    {flow.name}
                  </CardTitle>
                  {flow.description && (
                    <CardDescription className="text-sm mt-2">{flow.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {flow.nodes?.length || 0} nodes
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {flow.edges?.length || 0} connections
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last updated: {new Date(flow.updatedAt).toLocaleDateString()}
                  </div>
                </CardContent>
                <CardFooter className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setLocation(`/app/flows/${flow.id}`)}
                    data-testid={`button-edit-flow-${flow.id}`}
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setFlowToTest(flow)}
                    data-testid={`button-test-flow-${flow.id}`}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setFlowToDelete(flow)}
                    data-testid={`button-delete-flow-${flow.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
          <DataPagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            onItemsPerPageChange={handleItemsPerPageChange}
            itemsPerPageOptions={[6, 9, 12, 24]}
          />
        </>
      )}

      {/* Test Flow Dialog */}
      {flowToTest && (
        <TestFlowDialog
          open={!!flowToTest}
          onOpenChange={(open) => !open && setFlowToTest(null)}
          flowId={flowToTest.id}
          flowName={flowToTest.name}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!flowToDelete} onOpenChange={(open) => !open && setFlowToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Flow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{flowToDelete?.name}"? This action cannot be undone.
              Any campaigns using this flow will need to be updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => flowToDelete && deleteMutation.mutate(flowToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Flow"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <FlowTemplatesPage />
        </TabsContent>

        <TabsContent value="execution" className="space-y-4">
          <FlowExecutionLogsPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
