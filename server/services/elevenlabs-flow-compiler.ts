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
/**
 * ElevenLabsFlowCompiler - Translates visual flow nodes into ElevenLabs workflow format
 * 
 * ElevenLabs workflow format uses:
 * - nodes: Object keyed by node ID
 * - edges: Object keyed by edge ID  
 * - Node types: start, override_agent, end, phone_number, standalone_agent, tool
 * - Edge forward_condition types: unconditional, llm, result, expression
 */

import { FlowNode, FlowEdge } from '@shared/schema';

// ElevenLabs node types
interface ElevenLabsBaseNode {
  type: string;
  position: { x: number; y: number };
  edge_order: string[];
}

interface ElevenLabsStartNode extends ElevenLabsBaseNode {
  type: 'start';
}

interface ElevenLabsOverrideAgentNode extends ElevenLabsBaseNode {
  type: 'override_agent';
  label: string;
  additional_prompt: string;
  additional_tool_ids: string[];
  additional_knowledge_base: any[];
  conversation_config: Record<string, any>;
}

interface ElevenLabsEndNode extends ElevenLabsBaseNode {
  type: 'end';
}

interface ElevenLabsPhoneNumberNode extends ElevenLabsBaseNode {
  type: 'phone_number';
  transfer_destination: {
    type: 'phone';
    phone_number: string;
  };
  transfer_type: 'conference' | 'blind';
}

interface ElevenLabsToolNode extends ElevenLabsBaseNode {
  type: 'tool';
  tools: { tool_id: string }[];
}

type ElevenLabsNode = 
  | ElevenLabsStartNode 
  | ElevenLabsOverrideAgentNode 
  | ElevenLabsEndNode 
  | ElevenLabsPhoneNumberNode 
  | ElevenLabsToolNode;

// ElevenLabs edge types
interface ElevenLabsEdge {
  source: string;
  target: string;
  forward_condition: 
    | { type: 'unconditional' }
    | { type: 'llm'; condition: string }
    | { type: 'result'; successful: boolean }
    | { type: 'expression'; expression: any };
}

// Output workflow format matching ElevenLabs API
interface ElevenLabsWorkflow {
  nodes: Record<string, ElevenLabsNode>;
  edges: Record<string, ElevenLabsEdge>;
}

// Extended output including extracted first message and detected features
interface ElevenLabsWorkflowResult {
  workflow: ElevenLabsWorkflow;
  firstMessage?: string;
  hasAppointmentNodes?: boolean;
}

export class ElevenLabsFlowCompiler {
  private nodes: FlowNode[];
  private edges: FlowEdge[];
  private compiledNodes: Record<string, ElevenLabsNode> = {};
  private compiledEdges: Record<string, ElevenLabsEdge> = {};
  private edgeIdCounter = 0;
  private entryNodeId: string | null = null;

  constructor(nodes: FlowNode[], edges: FlowEdge[]) {
    this.nodes = nodes;
    this.edges = edges;
  }

  compile(): ElevenLabsWorkflowResult {
    const startNode = this.findStartNode();
    this.entryNodeId = startNode?.id || null;
    
    let firstMessage: string | undefined;
    if (startNode) {
      const nodeType = this.getNodeType(startNode);
      const config = (startNode.data?.config || {}) as any;
      
      if (nodeType === 'message' && config.message) {
        const message: string = config.message;
        firstMessage = message;
        const preview = message.length > 50 ? message.substring(0, 50) + '...' : message;
        console.log(`📝 Extracted first_message from entry node: "${preview}"`);
      }
    }
    
    // Detect appointment nodes for webhook tool registration
    const hasAppointmentNodes = this.nodes.some(node => {
      const nodeType = this.getNodeType(node);
      return nodeType === 'appointment';
    });
    
    if (hasAppointmentNodes) {
      console.log(`📅 Flow contains appointment nodes - will register webhook tool`);
    }
    
    const startNodeId = 'start_node';
    this.compiledNodes[startNodeId] = {
      type: 'start',
      position: { x: 0, y: 0 },
      edge_order: []
    };

    this.nodes.forEach(node => {
      const compiledNode = this.compileNode(node);
      if (compiledNode) {
        this.compiledNodes[node.id] = compiledNode;
      }
    });

    this.processEdges();

    if (startNode) {
      const entryEdgeId = 'start_to_entry';
      this.compiledEdges[entryEdgeId] = {
        source: startNodeId,
        target: startNode.id,
        forward_condition: { type: 'unconditional' }
      };
      (this.compiledNodes[startNodeId] as ElevenLabsStartNode).edge_order.push(entryEdgeId);
    }

    return {
      workflow: {
        nodes: this.compiledNodes,
        edges: this.compiledEdges
      },
      firstMessage,
      hasAppointmentNodes
    };
  }

  private findStartNode(): FlowNode | undefined {
    const explicitStart = this.nodes.find(n => {
      const nodeType = this.getNodeType(n);
      return nodeType === 'start' || nodeType === 'trigger';
    });
    if (explicitStart) return explicitStart;

    const nodesWithIncoming = new Set(this.edges.map(e => e.target));
    
    for (const node of this.nodes) {
      if (!nodesWithIncoming.has(node.id) && this.getNodeType(node) !== 'condition') {
        return node;
      }
    }

    return this.nodes.find(n => this.getNodeType(n) !== 'condition');
  }

  private getNodeType(node: FlowNode): string {
    const data = node.data || {};
    const config = data.config || {};
    return (config as any).type || node.type || 'unknown';
  }

  private generateEdgeId(source: string, target: string): string {
    this.edgeIdCounter++;
    return `edge_${source}_to_${target}_${this.edgeIdCounter}`;
  }

  private compileNode(node: FlowNode): ElevenLabsNode | null {
    const nodeType = this.getNodeType(node);
    const config = (node.data?.config || {}) as any;
    const position = node.position || { x: 0, y: 0 };

    switch (nodeType) {
      case 'start':
      case 'trigger':
        return null;

      case 'message':
        const isEntryNode = node.id === this.entryNodeId;
        const messageText = config.message || 'Hello';
        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: config.label || 'Message',
          additional_prompt: isEntryNode 
            ? `CRITICAL: Your first message was already configured. After speaking it, wait for the user's response before proceeding.`
            : `CRITICAL INSTRUCTION - SAY THIS EXACT MESSAGE VERBATIM:
---
${messageText}
---
Do NOT paraphrase, summarize, add to, or modify this message in ANY way. Say it EXACTLY as written above, word for word.`,
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };

      case 'question':
        const questionText = config.question || 'How can I help you?';
        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: config.label || 'Question',
          additional_prompt: `CRITICAL INSTRUCTION - ASK THIS EXACT QUESTION VERBATIM:
---
${questionText}
---
Do NOT rephrase or modify this question. Ask it EXACTLY as written above.
After asking, listen carefully to their response and remember it for variable: ${config.variableName || 'response'}`,
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };

      case 'transfer':
        return {
          type: 'phone_number',
          position,
          edge_order: [],
          transfer_destination: {
            type: 'phone',
            phone_number: config.phoneNumber || config.transferNumber || ''
          },
          transfer_type: config.transferType || 'conference'
        };

      case 'end':
        return {
          type: 'end',
          position,
          edge_order: []
        };

      case 'delay':
        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: config.label || 'Delay',
          additional_prompt: `Pause briefly. You can say "${config.message || 'One moment please...'}" while pausing.`,
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };

      case 'appointment':
        const apptServiceName = config.serviceName || config.service || 'appointment';
        const apptDuration = config.duration || 30;
        const apptIntroMessage = config.message || config.confirmMessage || 'I can help you schedule an appointment. What date and time works best for you?';
        
        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: config.label || 'Appointment',
          additional_prompt: `Say exactly: "${apptIntroMessage}"

APPOINTMENT BOOKING INSTRUCTIONS:
1. After the caller responds, collect the following information:
   - Their name (if not already known)
   - Preferred date for the appointment
   - Preferred time for the appointment
   - Phone number (use the caller's number if available)
   - Email address (optional)

2. Once you have collected the date, time, and caller name, IMMEDIATELY use the book_appointment tool to save the appointment.
   - Pass the caller's name as contactName
   - Pass the caller's phone number as contactPhone
   - Pass the date as appointmentDate (format: YYYY-MM-DD)
   - Pass the time as appointmentTime (format: HH:MM)
   - Pass ${apptDuration} as duration
   - Pass "${apptServiceName}" as serviceName
   - Pass any notes as notes

3. After successfully booking, confirm the appointment details to the caller.
4. If booking fails, apologize and offer to try again. If it fails a second time, let the caller know someone will follow up with them and proceed to the next step.

Then stop speaking and wait for response.`,
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };

      case 'form':
        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: config.label || 'Form',
          additional_prompt: `Collect information from the user.
Say: "${config.message || 'I need to collect some information from you.'}"`,
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };

      case 'webhook':
        const toolId = config.name || `webhook_${node.id}`;
        return {
          type: 'tool',
          position,
          edge_order: [],
          tools: [{ tool_id: toolId }]
        };

      case 'condition':
        return null;

      default:
        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: config.label || nodeType || 'Node',
          additional_prompt: config.message || 'Continue the conversation naturally.',
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };
    }
  }

  private processEdges(): void {
    const edgesToConditions: Map<string, FlowEdge> = new Map();
    
    const conditionNodeIds = new Set(
      this.nodes
        .filter(n => this.getNodeType(n) === 'condition')
        .map(n => n.id)
    );

    this.edges.forEach(edge => {
      if (conditionNodeIds.has(edge.target)) {
        edgesToConditions.set(edge.target, edge);
      } else if (conditionNodeIds.has(edge.source)) {
        this.processConditionEdge(edge, edgesToConditions);
      } else {
        this.addEdge(edge.source, edge.target, { type: 'unconditional' });
      }
    });
  }

  private processConditionEdge(
    edge: FlowEdge, 
    edgesToConditions: Map<string, FlowEdge>
  ): void {
    const conditionNode = this.nodes.find(n => n.id === edge.source);
    if (!conditionNode) return;

    const incomingEdge = edgesToConditions.get(conditionNode.id);
    if (!incomingEdge) return;

    const config = (conditionNode.data?.config || {}) as any;
    const conditions = config.conditions || [];

    let conditionText = '';
    
    if (conditions.length > 0) {
      const matchingCondition = conditions.find((c: any) => c.targetNodeId === edge.target);
      
      if (matchingCondition) {
        conditionText = this.buildConditionText(matchingCondition, config);
      } else {
        const handleCondition = conditions.find((c: any) => 
          c.id === edge.sourceHandle || c.label === edge.sourceHandle
        );
        if (handleCondition) {
          conditionText = this.buildConditionText(handleCondition, config);
        }
      }
    }

    if (!conditionText && edge.sourceHandle) {
      if (edge.sourceHandle === 'true' || edge.sourceHandle === 'yes') {
        conditionText = 'The user indicates agreement, affirmation, or "yes"';
      } else if (edge.sourceHandle === 'false' || edge.sourceHandle === 'no') {
        conditionText = 'The user indicates disagreement, refusal, or "no"';
      } else {
        conditionText = `The user response matches "${edge.sourceHandle}"`;
      }
    }

    const forwardCondition = conditionText 
      ? { type: 'llm' as const, condition: conditionText }
      : { type: 'unconditional' as const };

    this.addEdge(incomingEdge.source, edge.target, forwardCondition);
  }

  private buildConditionText(condition: any, nodeConfig: any): string {
    const conditionType = condition.type || 'keyword';
    const value = condition.value || condition.label || '';

    if (conditionType === 'yes_no') {
      if (value.toLowerCase() === 'yes') {
        return 'The user indicates agreement, affirmation, or "yes"';
      } else if (value.toLowerCase() === 'no') {
        return 'The user indicates disagreement, refusal, or "no"';
      }
    }

    if (conditionType === 'sentiment') {
      if (value.toLowerCase() === 'positive' || value.toLowerCase() === 'interested') {
        return 'The user response has a positive sentiment or shows interest';
      } else if (value.toLowerCase() === 'negative' || value.toLowerCase() === 'not_interested') {
        return 'The user response has a negative sentiment or shows disinterest';
      } else if (value.toLowerCase() === 'neutral') {
        return 'The user response has a neutral sentiment';
      }
    }

    if (value) {
      return `The user response contains or matches "${value}"`;
    }

    return '';
  }

  private addEdge(
    source: string, 
    target: string, 
    forwardCondition: ElevenLabsEdge['forward_condition']
  ): void {
    if (!this.compiledNodes[source]) return;

    const edgeId = this.generateEdgeId(source, target);
    
    this.compiledEdges[edgeId] = {
      source,
      target,
      forward_condition: forwardCondition
    };

    const sourceNode = this.compiledNodes[source];
    if (sourceNode && 'edge_order' in sourceNode) {
      sourceNode.edge_order.push(edgeId);
    }
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const nodeCount = Object.keys(this.compiledNodes).length;
    if (nodeCount <= 1) {
      errors.push('Workflow must have at least one node besides start');
    }

    if (!this.compiledNodes['start_node']) {
      errors.push('Workflow must have a start node');
    }

    Object.entries(this.compiledEdges).forEach(([edgeId, edge]) => {
      if (!this.compiledNodes[edge.target]) {
        errors.push(`Edge ${edgeId} targets non-existent node ${edge.target}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
