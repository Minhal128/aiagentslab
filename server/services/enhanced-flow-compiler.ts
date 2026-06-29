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
 * EnhancedFlowCompiler - Compiles visual flow nodes into ElevenLabs workflow format
 * 
 * Per ElevenLabs API documentation (https://elevenlabs.io/docs/agents-platform/api-reference/agents/update):
 * Valid workflow node types: start, end, phone_number, override_agent, standalone_agent, tool
 * 
 * Subagent nodes (override_agent in API) modify agent behavior at specific workflow points.
 * They can change: System Prompt, LLM, Voice, Tools, Knowledge Base
 * When the workflow transitions to a Subagent node, the agent uses the new prompt
 * to continue the conversation.
 * 
 * ElevenLabs Workflow Format:
 * - workflow.nodes: Record<string, Node>
 * - workflow.edges: Record<string, Edge>
 * 
 * Node Types (per API):
 * - start: Entry point
 * - override_agent: Subagent node - modifies agent config/prompt for this step
 * - end: End the call
 * - phone_number: Transfer to phone number
 * - standalone_agent: Transfer to another agent
 * - tool: Execute a tool
 * 
 * Edge Forward Conditions:
 * - unconditional: Always transition (use for start -> first node)
 * - llm: LLM evaluates condition text (use for user response detection)
 * - result: Based on tool success/failure
 * - expression: Complex boolean expressions
 */

import { FlowNode, FlowEdge } from '@shared/schema';
import { generateFormCollectionPrompt, FormFieldDefinition } from './form-elevenlabs-tool';

// ============================================================================
// LLM Condition Templates - Natural Language Conditions for ElevenLabs
// These descriptive conditions work better with LLM evaluation than short phrases
// ============================================================================

export const LLM_CONDITIONS = {
  // Generic response - use when any response should proceed
  GENERIC_RESPONSE: "The user has verbally responded with any answer. Continue to the next step in the workflow.",

  // Question answered - wait for user to provide an answer before proceeding
  QUESTION_ANSWERED: "The user has provided an answer or response to the question. They have given information, a number, a name, an address, or any substantive reply. Proceed to the next step.",

  // Yes/acceptance branch
  YES_ACCEPTANCE: "The user agreed, said yes, confirmed positively, or expressed interest.",

  // No/rejection branch
  NO_REJECTION: "The user declined, said no, refused, or expressed disinterest.",

  // User asked a question (for KB/natural mode handling)
  ASKED_QUESTION: "The user asked a question instead of directly answering. Switch to natural conversation mode and respond helpfully before continuing.",

  // User is confused
  CONFUSION: "The user sounded confused or asked for clarification. Ask again politely.",

  // No response / silence
  SILENCE: "The user did not respond or remained silent. Ask again or prompt gently.",

  // Interruption
  INTERRUPTING: "The user interrupted the message. Stop speaking and listen, then continue based on their intent.",

  // Form collection complete - agent has said the explicit completion phrase
  FORM_COMPLETE: "The agent has said 'Your information has been saved successfully' or a very similar confirmation phrase indicating the form submission is complete. Do not transition until this phrase is spoken.",

  // Appointment booking complete - agent has confirmed the booking
  APPOINTMENT_COMPLETE: "The agent has said 'Your appointment has been booked successfully' or a very similar confirmation phrase indicating the appointment is confirmed. Do not transition until this phrase is spoken.",

  // WhatsApp sent - agent has confirmed delivery
  WHATSAPP_COMPLETE: "Transition ONLY after the WhatsApp tool has been called and has returned a successful response, AND the agent has confirmed this to the user. Do not transition if the tool was not called or if it failed.",

  // Email sent - agent has confirmed delivery
  EMAIL_COMPLETE: "The agent has confirmed that the email has been sent or said 'The email has been sent successfully'. Do not transition until this confirmation is spoken.",

  // Transfer intent
  TRANSFER_INTENT: "The user requested to speak with a human, transfer the call, or be connected to support.",

  // Appointment specific
  APPOINTMENT_INFO: "The user provided a date, time, or scheduling information for the appointment.",

  // Form/data collection
  INFO_PROVIDED: "The user provided the requested information or data."
} as const;

// ============================================================================
// ElevenLabs Node Types
// ============================================================================

interface ElevenLabsPosition {
  x: number;
  y: number;
}

interface ElevenLabsBaseNode {
  type: string;
  position: ElevenLabsPosition;
  edge_order: string[];
}

interface ElevenLabsStartNode extends ElevenLabsBaseNode {
  type: 'start';
}

interface ElevenLabsEndNode extends ElevenLabsBaseNode {
  type: 'end';
}

// OVERRIDE_AGENT NODE - Subagent in ElevenLabs UI
// Per API docs: This is the correct type for Subagent nodes
// Modifies agent config/prompt at specific workflow points
// IMPORTANT: ElevenLabs ignores conversation_config.first_message on workflow nodes
// The actual spoken message must be embedded in additional_prompt as an instruction
interface ElevenLabsOverrideAgentNode extends ElevenLabsBaseNode {
  type: 'override_agent';
  label: string;
  override_prompt: true;  // CRITICAL: Locks the agent to node script, prevents improvisation
  additional_prompt: string;  // Contains "Say exactly: '[message]'" + behavior instructions
  additional_tool_ids: string[];
  additional_knowledge_base: any[];
  conversation_config: {};  // Must be empty {} per ElevenLabs API
}

interface ElevenLabsPhoneNumberNode extends ElevenLabsBaseNode {
  type: 'phone_number';
  transfer_destination: {
    type: 'phone';
    phone_number: string;
  };
  transfer_type: 'conference' | 'blind';
}

interface ElevenLabsStandaloneAgentNode extends ElevenLabsBaseNode {
  type: 'standalone_agent';
  agent_id: string;
  delay_ms: number;
  enable_transferred_agent_first_message: boolean;
}

interface ElevenLabsToolNode extends ElevenLabsBaseNode {
  type: 'tool';
  tools: { tool_id: string }[];
}

// Per ElevenLabs API: Valid node types are start, end, phone_number, override_agent, standalone_agent, tool
type ElevenLabsNode =
  | ElevenLabsStartNode
  | ElevenLabsOverrideAgentNode  // Subagent node - modifies agent config/prompt
  | ElevenLabsEndNode
  | ElevenLabsPhoneNumberNode
  | ElevenLabsStandaloneAgentNode
  | ElevenLabsToolNode;

// ============================================================================
// ElevenLabs Edge Types
// ============================================================================

interface UnconditionalCondition {
  type: 'unconditional';
}

interface LLMCondition {
  type: 'llm';
  condition: string;
}

interface ResultCondition {
  type: 'result';
  successful: boolean;
}

interface ExpressionCondition {
  type: 'expression';
  expression: any;
}

type ForwardCondition = UnconditionalCondition | LLMCondition | ResultCondition | ExpressionCondition;

interface ElevenLabsEdge {
  source: string;
  target: string;
  forward_condition: ForwardCondition;
}

// ============================================================================
// Output Types
// ============================================================================

export interface ElevenLabsWorkflow {
  nodes: Record<string, ElevenLabsNode>;
  edges: Record<string, ElevenLabsEdge>;
}

export interface FormNodeInfo {
  nodeId?: string;
  formId: string;
  formName: string;
  fields: FormFieldDefinition[];
  googleSheetId?: string;
  googleSheetName?: string;
}

export interface WebhookNodeInfo {
  toolId: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  payload?: Record<string, any>;
}

export interface PlayAudioNodeInfo {
  nodeId: string;
  audioUrl: string;
  audioFileName: string;
  interruptible: boolean;
  waitForComplete: boolean;
}

export interface EnhancedCompileResult {
  workflow: ElevenLabsWorkflow;
  firstMessage?: string;
  hasTransferNodes: boolean;
  hasAppointmentNodes?: boolean;
  hasFormNodes?: boolean;
  formNodes?: FormNodeInfo[];
  hasWebhookNodes?: boolean;
  webhookNodes?: WebhookNodeInfo[];
  hasPlayAudioNodes?: boolean;
  playAudioNodes?: PlayAudioNodeInfo[];
  toolIds: string[];
}

// ============================================================================
// Enhanced Flow Compiler
// ============================================================================

export class EnhancedFlowCompiler {
  private nodes: FlowNode[];
  private edges: FlowEdge[];
  private compiledNodes: Record<string, ElevenLabsNode> = {};
  private compiledEdges: Record<string, ElevenLabsEdge> = {};
  private edgeIdCounter = 0;
  private entryNodeId: string | null = null;
  private hasTransferNodes = false;
  private hasAppointmentNodes = false;
  private hasFormNodes = false;
  private hasWebhookNodes = false;
  private hasPlayAudioNodes = false;
  private mergedNodeIds: Set<string> = new Set();
  private formNodes: FormNodeInfo[] = [];
  private webhookNodes: WebhookNodeInfo[] = [];
  private playAudioNodes: PlayAudioNodeInfo[] = [];
  private toolIds: string[] = [];

  constructor(nodes: FlowNode[], edges: FlowEdge[]) {
    this.nodes = nodes;
    this.edges = edges;
  }

  /**
   * Returns a map of node IDs to their merged child node IDs
   */
  private getMergeMap(): Record<string, string[]> {
    const map: Record<string, string[]> = {};

    for (const node of this.nodes) {
      const nodeType = this.getNodeType(node);
      if (nodeType === 'message') {
        const outgoingEdge = this.edges.find(e => e.source === node.id);
        const nextNode = outgoingEdge ? this.nodes.find(n => n.id === outgoingEdge.target) : null;
        const nextNodeType = nextNode ? this.getNodeType(nextNode) : null;

        if (nextNode && (nextNodeType === 'send_whatsapp' || nextNodeType === 'send_email')) {
          map[node.id] = [nextNode.id];
        }
      }
    }

    return map;
  }

  /**
   * Compile the visual flow into ElevenLabs workflow format
   */
  compile(): EnhancedCompileResult {
    console.log(`🔧 [EnhancedFlowCompiler] Starting compilation...`);
    console.log(`   Input: ${this.nodes.length} nodes, ${this.edges.length} edges`);

    // Find the entry node (first node after start or first actionable node)
    const entryNode = this.findEntryNode();
    this.entryNodeId = entryNode?.id || null;

    // Extract first message from entry node if it's a Message type
    // NOTE: In scripted workflow mode (ignore_default_personality: true), 
    // ElevenLabs does NOT speak first_message. The entry node must speak it.
    // We extract it for logging only, but the entry node MUST handle the greeting.
    let firstMessage: string | undefined;

    if (entryNode) {
      const nodeType = this.getNodeType(entryNode);
      const config = this.getNodeConfig(entryNode);

      if (nodeType === 'message' && config.message) {
        const msg: string = config.message;

        // If the message has variables, use a generic greeting for the initial API call 
        // to prevent ElevenLabs from rejecting the call due to missing dynamic variables.
        // The actual workflow node will handle the detailed script and data collection.
        firstMessage = msg.includes('{{') ? 'Hello!' : msg;

        console.log(`   📝 First message for API: "${firstMessage}"`);
        console.log(`   📢 Entry node will speak the greeting/script (scripted mode)`);
      }
    }

    // Create mandatory start node
    const startNodeId = 'start_node';
    this.compiledNodes[startNodeId] = {
      type: 'start',
      position: { x: 0, y: 0 },
      edge_order: []
    };

    // First pass: Compile all nodes (skipping already merged ones)
    for (const node of this.nodes) {
      if (this.mergedNodeIds.has(node.id)) continue;

      const compiledNode = this.compileNode(node);
      if (compiledNode) {
        this.compiledNodes[node.id] = compiledNode;
      }
    }

    // Second pass: Process edges (no special handling needed - workflow structure intact)
    this.processEdges();

    // Connect start node to entry node (workflow structure stays intact)
    if (this.entryNodeId && this.compiledNodes[this.entryNodeId]) {
      const startEdgeId = 'start_to_entry';
      this.compiledEdges[startEdgeId] = {
        source: startNodeId,
        target: this.entryNodeId,
        forward_condition: { type: 'unconditional' }
      };
      (this.compiledNodes[startNodeId] as ElevenLabsStartNode).edge_order.push(startEdgeId);
      console.log(`   🔗 Connected start -> ${this.entryNodeId}`);
    }

    console.log(`   ✅ Compiled: ${Object.keys(this.compiledNodes).length} nodes, ${Object.keys(this.compiledEdges).length} edges`);
    console.log(`   📞 Has transfer nodes: ${this.hasTransferNodes}`);
    console.log(`   🔧 Tool IDs: ${this.toolIds.length > 0 ? this.toolIds.join(', ') : 'none'}`);

    // Debug: Log compiled node types and structure
    console.log(`\n   📊 Compiled Workflow Structure:`);
    for (const [nodeId, node] of Object.entries(this.compiledNodes)) {
      const nodeType = (node as any).type;
      const edgeCount = node.edge_order.length;
      let detail = '';

      if (nodeType === 'override_agent') {
        const overrideNode = node as ElevenLabsOverrideAgentNode;
        const label = overrideNode.label || '';
        detail = ` - label: "${label}"`;
      }

      console.log(`      [${nodeId}] type: ${nodeType}, edges: ${edgeCount}${detail}`);
    }

    console.log(`\n   🔗 Compiled Edges:`);
    for (const [edgeId, edge] of Object.entries(this.compiledEdges)) {
      const condType = edge.forward_condition.type;
      const condDetail = condType === 'llm'
        ? ` "${(edge.forward_condition as LLMCondition).condition.substring(0, 30)}..."`
        : '';
      console.log(`      [${edgeId}] ${edge.source} -> ${edge.target} (${condType}${condDetail})`);
    }

    return {
      workflow: {
        nodes: this.compiledNodes,
        edges: this.compiledEdges
      },
      firstMessage,
      hasTransferNodes: this.hasTransferNodes,
      hasAppointmentNodes: this.hasAppointmentNodes,
      hasFormNodes: this.hasFormNodes,
      formNodes: this.formNodes,
      hasWebhookNodes: this.hasWebhookNodes,
      webhookNodes: this.webhookNodes,
      hasPlayAudioNodes: this.hasPlayAudioNodes,
      playAudioNodes: this.playAudioNodes,
      toolIds: this.toolIds
    };
  }

  /**
   * Find the entry node - first actionable node in the flow
   */
  private findEntryNode(): FlowNode | undefined {
    // Look for explicit start/trigger nodes
    const startNode = this.nodes.find(n => {
      const type = this.getNodeType(n);
      return type === 'start' || type === 'trigger';
    });

    if (startNode) {
      // Find the first node connected from start
      const outgoingEdge = this.edges.find(e => e.source === startNode.id);
      if (outgoingEdge) {
        return this.nodes.find(n => n.id === outgoingEdge.target);
      }
    }

    // Find nodes with no incoming edges (excluding condition nodes)
    const targetIds = new Set(this.edges.map(e => e.target));
    for (const node of this.nodes) {
      const type = this.getNodeType(node);
      if (!targetIds.has(node.id) && type !== 'condition' && type !== 'start' && type !== 'trigger') {
        return node;
      }
    }

    // Fall back to first non-utility node
    return this.nodes.find(n => {
      const type = this.getNodeType(n);
      return type !== 'condition' && type !== 'start' && type !== 'trigger';
    });
  }

  /**
   * Get node type from React Flow node
   */
  private getNodeType(node: FlowNode): string {
    const data = node.data || {};
    const config = data.config || {};
    return config.type || node.type || 'unknown';
  }

  /**
   * Get node config
   */
  private getNodeConfig(node: FlowNode): any {
    return node.data?.config || {};
  }

  /**
   * Generate unique edge ID
   */
  private generateEdgeId(source: string, target: string): string {
    this.edgeIdCounter++;
    return `edge_${this.edgeIdCounter}_${source.substring(0, 8)}_to_${target.substring(0, 8)}`;
  }

  /**
   * Create additional_prompt for message delivery nodes
   * STRICT FORMAT: Locks agent to exact script, prevents improvisation
   * NOTE: Message nodes have UNCONDITIONAL transitions - they speak and immediately proceed
   * Do NOT say "wait for response" as this conflicts with the unconditional edge
   */
  private createMessagePrompt(text: string, nodeLabel: string): string {
    if (text.includes('{{')) {
      return `YOUR ROLE: You are delivering a message that contains variables. 
      
SCRIPT: "${text}"

INSTRUCTIONS:
1. Review the script above. Identify variables like {{studentName}}, {{amountDueWords}}, etc.
2. If you do not know the value for any of these variables, have a natural conversation with the caller to collect them.
3. Once you have all the necessary information, say the FULL message exactly as scripted.
4. Once the message is delivered, you may proceed to follow any additional instructions provided below (such as calling a tool).`;
    }
    return `Deliver this message to the caller: "${text}"

After delivering the message:
- If the caller responds with a question or comment, answer it naturally and helpfully using your knowledge.
- After answering, gently guide the conversation back toward the next step in the sales flow.
- Do NOT ignore the caller. Do NOT go silent. Always respond to what they say.`;
  }

  /**
   * Create additional_prompt for question nodes
   * STRICT FORMAT: Locks agent to exact script, prevents improvisation
   */
  private createQuestionPrompt(question: string, variableName: string, nodeLabel: string): string {
    return `Ask the caller: "${question}" — then listen and wait for their response.

If they ask a question instead of answering, answer it naturally and helpfully, then ask again.
If they answer, acknowledge their response and proceed.`;
  }

  /**
   * Create additional_prompt for appointment scheduling nodes
   * CONVERSATIONAL FORMAT: Allows natural conversation to collect appointment details
   * NOTE: Do NOT use "Say exactly" pattern here - it traps the LLM in a repetition loop
   */
  private createAppointmentPrompt(introMessage: string, config: any, nodeLabel: string): string {
    const serviceName = config.serviceName || config.service || 'appointment';
    const duration = config.duration || 30;

    return `YOUR ROLE: You are an appointment booking assistant. Your goal is to collect appointment details and book the appointment using the book_appointment tool.

INITIAL GREETING (say this ONCE at the start):
"${introMessage}"

CONVERSATION FLOW:
1. After your greeting, LISTEN to what the caller says. They may already provide their preferred date and time.
2. If they provide date/time information, acknowledge it and ask for their name if you don't have it.
3. If they ask questions, answer them naturally, then guide them back to booking.

INFORMATION TO COLLECT (through natural conversation):
- Their name (required)
- Preferred date for the appointment (required) 
- Preferred time for the appointment (required)
- Phone number: Use their current calling number unless they specify a different one

BOOKING THE APPOINTMENT:
Once you have the name, date, and time, IMMEDIATELY call the book_appointment tool with:
- contactName: The caller's name
- contactPhone: "USE_CALLER_NUMBER" (unless they gave a different number)
- appointmentDate: The date they requested (can be relative like "tomorrow" or "next Monday")
- appointmentTime: The time in HH:MM format (convert "2pm" to "14:00", "9:30am" to "09:30")
- duration: ${duration}
- serviceName: "${serviceName}"

AFTER BOOKING:
When the tool returns success, say exactly: "Your appointment has been booked successfully."
This phrase signals that you should proceed to the next step.

If the tool fails, apologize and say you were unable to complete the booking at this moment. Offer to try again one more time. If it fails again, let the caller know you'll make sure someone follows up with them, then proceed to the next step.

IMPORTANT: Do NOT repeat your initial greeting. Have a natural conversation to collect the required information.`;
  }

  /**
   * Create additional_prompt for form/data collection nodes
   * Uses the generateFormCollectionPrompt from form-elevenlabs-tool for proper field collection
   */
  private createFormPrompt(introMessage: string, config: any, nodeLabel: string): string {
    const formName = config.formName || 'Data Collection';
    const fields: FormFieldDefinition[] = config.fields || [];

    // If we have fields defined, use the proper form collection prompt
    if (fields.length > 0) {
      return generateFormCollectionPrompt(introMessage, formName, fields);
    }

    // Fallback for forms without pre-loaded fields
    return `Say exactly: '${introMessage}'

FORM COLLECTION INSTRUCTIONS for "${formName}":
After speaking the introduction, collect the requested information from the caller.
Ask questions one at a time and wait for responses.
Once all information is collected, use the submit_form tool to save the responses.

Then stop speaking and wait for response.`;
  }

  /**
   * Create additional_prompt for WhatsApp delivery nodes
   */
  private createWhatsAppPrompt(templateName: string, language: string, toolId: string, config: any): string {
    let varInfo = '';
    if (config.templateVariables && config.templateVariables.length > 0) {
      // Clean up variables to ensure valid JSON representation for the prompt
      const cleanVars = config.templateVariables.map((v: any) => {
        const val = v.value.includes('{{') ? v.value : `{{${v.value}}}`;
        return `{"position":${v.position},"value":"${val}","componentType":"${v.componentType || 'body'}"}`;
      });
      varInfo += `\n   - template_variables: [${cleanVars.join(',')}]`;
    }

    if (config.headerVariable) {
      varInfo += `\n   - headerVariable: ${JSON.stringify(config.headerVariable)}`;
    }

    if (config.buttonVariables && config.buttonVariables.length > 0) {
      varInfo += `\n   - buttonVariables: ${JSON.stringify(config.buttonVariables)}`;
    }

    return `MANDATORY MISSION: Send a WhatsApp message to the caller.
    
1. YOU MUST ACTUALLY call the tool "${toolId}" right now with these exact parameters:
   - template_name: "${templateName}"
   - language: "${language}"
   - phone_number: "USE_CALLER_NUMBER"
   - conversationId: "{{conversation_id}}"${varInfo}
2. Only after you have CALLED the tool and it is processing, say exactly: 'I am sending the WhatsApp message now.'
3. It is FORBIDDEN to say the message has been sent until the tool returns success.
4. Once the tool returns success, say exactly: 'The WhatsApp message has been sent successfully.'
5. If it fails, say: 'I apologize, I was unable to send the WhatsApp message at this moment.' Then proceed anyway.

Do not transition until you have confirmed it is sent. This is a mandatory system requirement.`;
  }

  /**
   * Create additional_prompt for Email delivery nodes
   */
  private createEmailPrompt(templateName: string, toolId: string): string {
    return `CRITICAL INSTRUCTION: You must send an email to the caller right now.
    
1. Say exactly: 'I am sending that email now.'
2. IMMEDIATELY call the tool "${toolId}" with these exact parameters:
   - template_name: "${templateName}"
   - recipient_email: "{{contact_email}}"
3. Once the tool returns success, say exactly: 'The email has been sent successfully.'
4. If it fails, say: 'I apologize, I was unable to send the email at this moment.' Then proceed anyway.

Do not transition until you have confirmed it is sent.`;
  }

  /**
   * Create additional_prompt for delay/pause nodes
   * STRICT FORMAT: Locks agent to exact script, prevents improvisation
   * NOTE: Delay nodes typically have UNCONDITIONAL transitions - they speak and proceed
   */
  private createDelayPrompt(waitMessage: string, config: any, nodeLabel: string): string {
    return `Say exactly: '${waitMessage}' Do not add anything else. After speaking, proceed immediately to the next step.`;
  }

  /**
   * Compile a single node into ElevenLabs format
   */
  private compileNode(node: FlowNode): ElevenLabsNode | null {
    const nodeType = this.getNodeType(node);
    const config = this.getNodeConfig(node);
    const position = node.position || { x: 0, y: 0 };
    const label = config.label || config.name || nodeType || 'Node';
    const isEntryNode = node.id === this.entryNodeId;

    switch (nodeType) {
      case 'start':
      case 'trigger':
        // Skip - we create our own start node
        return null;

      case 'message': {
        const messageText = config.message || 'Hello';
        const mergeMap = this.getMergeMap();
        const mergedIds = mergeMap[node.id] || [];
        const additional_tool_ids: string[] = [];
        let toolPrompts = '';

        for (const childId of mergedIds) {
          const childNode = this.nodes.find(n => n.id === childId);
          if (childNode) {
            const childType = this.getNodeType(childNode);
            const childConfig = this.getNodeConfig(childNode);

            if (childType === 'send_whatsapp') {
              const childToolId = `send_whatsapp`;
              additional_tool_ids.push(childToolId);
              toolPrompts += `${this.createWhatsAppPrompt(childConfig.templateName || childConfig.template_name, childConfig.language || 'en', childToolId, childConfig)}\n\n`;
            } else if (childType === 'send_email') {
              const childToolId = `send_email_${childNode.id.slice(-8)}`;
              additional_tool_ids.push(childToolId);
              toolPrompts += `MANDATORY MISSION: Once the message below is delivered, you MUST call the tool "${childToolId}" to send the email.\n\n`;
            }
          }
        }

        const combinedPrompt = `${toolPrompts}${this.createMessagePrompt(messageText, label)}`;

        console.log(`   📢 Compiling Message node: "${messageText.substring(0, 50)}..." (${mergedIds.length} merged tools)`);

        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: label,
          override_prompt: true,  // CRITICAL: Locks agent to exact script
          additional_prompt: combinedPrompt,
          additional_tool_ids: additional_tool_ids,
          additional_knowledge_base: [],
          conversation_config: {
            turn_taking: {
              interruption_sensitivity: 0 // Prevent user from interrupting the message
            }
          }
        };
      }

      case 'question': {
        const questionText = config.question || config.message || 'How can I help you?';
        const variableName = config.variableName || config.variable || 'response';

        console.log(`   ❓ Compiling Question node: "${questionText.substring(0, 50)}..."`);

        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: label,
          override_prompt: true,  // CRITICAL: Locks agent to exact script
          additional_prompt: this.createQuestionPrompt(questionText, variableName, label),
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };
      }

      case 'appointment': {
        const introMessage = config.message || config.introMessage || "I can help you schedule an appointment.";

        // Mark that this flow has appointment nodes (for webhook tool registration)
        this.hasAppointmentNodes = true;

        console.log(`   📅 Compiling Appointment node: "${introMessage.substring(0, 50)}..."`);

        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: label || 'Appointment',
          override_prompt: true,  // CRITICAL: Locks agent to exact script
          additional_prompt: this.createAppointmentPrompt(introMessage, config, label),
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };
      }

      case 'form':
      case 'form_submission':
      case 'collect_info': {
        const introMessage = config.message || config.introMessage || "I need to collect some information from you.";
        const formId = config.formId;
        const formName = config.formName || 'Data Collection';
        const fields: FormFieldDefinition[] = config.fields || [];

        // Mark that this flow has form nodes (for webhook tool registration)
        this.hasFormNodes = true;

        // Track form info for tool registration
        if (formId) {
          this.formNodes.push({
            nodeId: node.id,
            formId,
            formName,
            fields,
            googleSheetId: config.googleSheetId || undefined,
            googleSheetName: config.googleSheetName || undefined,
          });
        }

        console.log(`   📋 Compiling Form node: "${introMessage.substring(0, 50)}..."`);
        console.log(`      Form ID: ${formId || 'none'}, Node ID: ${node.id}, Fields: ${fields.length}`);

        // Generate tool ID for submit_form webhook (must match what's registered with ElevenLabs)
        // Use node.id (not formId) so each form node in the flow gets its own unique tool,
        // even when two nodes reference the same formId (e.g. same form in different branches).
        const sanitizedNodeId = node.id.replace(/[^a-zA-Z0-9]/g, '_');
        const submitFormToolId = formId ? `submit_form_${sanitizedNodeId}` : '';

        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: label || 'Form',
          override_prompt: true,  // CRITICAL: Locks agent to exact script
          additional_prompt: this.createFormPrompt(introMessage, config, label),
          additional_tool_ids: formId ? [submitFormToolId] : [],
          additional_knowledge_base: [],
          conversation_config: {}
        };
      }

      case 'delay':
      case 'wait':
      case 'pause': {
        const waitMessage = config.message || config.waitMessage || "One moment please...";

        console.log(`   ⏳ Compiling Delay node: "${waitMessage.substring(0, 50)}..."`);

        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: label || 'Delay',
          override_prompt: true,  // CRITICAL: Locks agent to exact script
          additional_prompt: this.createDelayPrompt(waitMessage, config, label),
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };
      }

      case 'transfer':
      case 'transfer_call':
      case 'phone_transfer': {
        this.hasTransferNodes = true;
        const phoneNumber = config.phoneNumber || config.transferNumber || config.number || '';
        const transferType = config.transferType || 'conference';

        return {
          type: 'phone_number',
          position,
          edge_order: [],
          transfer_destination: {
            type: 'phone',
            phone_number: phoneNumber
          },
          transfer_type: transferType as 'conference' | 'blind'
        };
      }

      case 'agent_transfer':
      case 'transfer_agent': {
        const agentId = config.agentId || config.agent_id || '';

        return {
          type: 'standalone_agent',
          position,
          edge_order: [],
          agent_id: agentId,
          delay_ms: config.delay_ms || 0,
          enable_transferred_agent_first_message: config.enableFirstMessage ?? true
        };
      }

      case 'end':
      case 'end_call':
      case 'hangup': {
        return {
          type: 'end',
          position,
          edge_order: []
        };
      }

      case 'webhook':
      case 'api_call':
      case 'tool': {
        // Check both config (node.data.config) and node.data for webhook properties
        // Templates may store properties directly on node.data instead of node.data.config
        const nodeData = (node.data || {}) as any;

        const toolId = config.toolId || config.tool_id || config.name ||
          nodeData.toolId || nodeData.tool_id || nodeData.name || `webhook_${node.id}`;
        this.toolIds.push(toolId);

        // Capture webhook configuration for tool registration
        // Check multiple property names for URL (UI uses webhookUrl, templates use url)
        // Priority: config.url > config.webhookUrl > nodeData.url > nodeData.webhookUrl
        const webhookUrl = config.url || config.webhookUrl || nodeData.url || nodeData.webhookUrl || '';
        const webhookMethod = config.method || nodeData.method || 'POST';
        const webhookHeaders = config.headers || nodeData.headers;
        const webhookPayload = config.payload || nodeData.payload;

        if (webhookUrl) {
          this.hasWebhookNodes = true;
          this.webhookNodes.push({
            toolId,
            url: webhookUrl,
            method: webhookMethod as "GET" | "POST" | "PUT" | "PATCH",
            headers: webhookHeaders,
            payload: webhookPayload
          });
          console.log(`   🔗 Webhook node configured: ${toolId} -> ${webhookMethod} ${webhookUrl}`);
        } else {
          console.warn(`   ⚠️ Webhook node ${node.id} has no URL configured`);
        }

        return {
          type: 'tool',
          position,
          edge_order: [],
          tools: [{ tool_id: toolId }]
        };
      }

      case 'condition':
        // Condition nodes are processed as edge logic, not as workflow nodes
        return null;

      case 'play_audio': {
        const audioUrl = config.audioUrl || '';
        const audioFileName = config.audioFileName || 'audio';
        const interruptible = config.interruptible ?? false;
        const waitForComplete = config.waitForComplete ?? true;

        if (!audioUrl) {
          console.warn(`   ⚠️ Play Audio node ${node.id} has no audio URL configured`);
        }

        const toolId = `play_audio_${node.id.slice(-8)}`;
        this.toolIds.push(toolId);

        this.hasPlayAudioNodes = true;
        this.playAudioNodes.push({
          nodeId: node.id,
          audioUrl,
          audioFileName,
          interruptible,
          waitForComplete
        });

        console.log(`   🔊 Compiling Play Audio node: ${audioUrl}`);

        return {
          type: 'tool',
          position,
          edge_order: [],
          tools: [{ tool_id: toolId }]
        };
      }

      case 'send_email': {
        const templateName = config.templateName || config.template_name || 'default';
        const toolId = `send_email_${node.id.slice(-8)}`;
        console.log(`   📧 Compiling Send Email node: template="${templateName}" toolId="${toolId}"`);
        this.toolIds.push(toolId);
        this.hasWebhookNodes = true;
        this.webhookNodes.push({
          toolId,
          url: '',
          method: 'POST' as "POST",
          headers: { 'Content-Type': 'application/json' },
          payload: {
            template_name: templateName,
            recipient_email: config.recipientEmail || '',
            conversationId: '{{conversation_id}}'
          }
        });

        console.log(`   📧 Compiling Send Email node: template="${templateName}"`);

        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: label || 'Send Email',
          override_prompt: true,
          additional_prompt: this.createEmailPrompt(templateName, toolId),
          additional_tool_ids: [toolId],
          additional_knowledge_base: [],
          conversation_config: {}
        };
      }

      case 'send_whatsapp': {
        const templateName = config.templateName || config.template_name || 'hello_world';
        const language = config.language || 'en_US';
        const templateVariables = config.templateVariables || [];
        const headerVariable = config.headerVariable || null;
        const buttonVariables = config.buttonVariables || [];
        const toolId = `send_whatsapp`; // Use a simple name to ensure the LLM actually calls it reliably
        this.toolIds.push(toolId);
        this.hasWebhookNodes = true;
        const payload: Record<string, any> = {
          template_name: templateName,
          language,
          phone_number: 'USE_CALLER_NUMBER',
          conversationId: '{{conversation_id}}'
        };
        if (templateVariables.length > 0) {
          payload.template_variables = templateVariables;
        }
        if (headerVariable) {
          payload.headerVariable = headerVariable;
        }
        if (buttonVariables.length > 0) {
          payload.buttonVariables = buttonVariables;
        }
        this.webhookNodes.push({
          toolId,
          url: '',
          method: 'POST' as "POST",
          headers: { 'Content-Type': 'application/json' },
          payload
        });


        console.log(`   💬 Compiling Send WhatsApp node: template="${templateName}" lang="${language}"`);

        return {
          type: 'tool',
          position,
          edge_order: [],
          tools: [{ tool_id: toolId }]
        } as any;
      }

      default: {
        // Unknown node types become override_agent (Subagent) with their content
        const message = config.message || config.text || 'How may I assist you?';

        console.log(`   🔄 Compiling unknown node type '${nodeType}' as Subagent`);

        return {
          type: 'override_agent',
          position,
          edge_order: [],
          label: label || nodeType,
          override_prompt: true,  // CRITICAL: Locks agent to exact script
          additional_prompt: this.createMessagePrompt(message, label),
          additional_tool_ids: [],
          additional_knowledge_base: [],
          conversation_config: {}
        };
      }
    }
  }

  /**
   * Process all edges in the flow
   */
  private processEdges(): void {
    // Identify condition nodes for special handling
    const conditionNodeIds = new Set(
      this.nodes
        .filter(n => this.getNodeType(n) === 'condition')
        .map(n => n.id)
    );

    // Map edges entering condition nodes
    const edgesToConditions: Map<string, FlowEdge> = new Map();

    for (const edge of this.edges) {
      if (conditionNodeIds.has(edge.target)) {
        edgesToConditions.set(edge.target, edge);
      }
    }

    // Process each edge
    for (const edge of this.edges) {
      // Priority 1: Handle nodes that were merged into their source nodes
      // If the source of this edge was merged into ITS parent, we need to find the parent
      // and attach the edge there.
      let effectiveSourceId = edge.source;
      for (const [parentId, mergedIds] of Object.entries(this.getMergeMap())) {
        if (mergedIds.includes(edge.source)) {
          // Only re-route if the parent node actually exists in compiled output.
          // In NATIVE BYPASS mode, the parent message node is in mergedNodeIds and
          // was never compiled, so re-routing to it would cause addEdge to silently
          // drop the edge (compiledNodes[parentId] doesn't exist).
          if (this.compiledNodes[parentId]) {
            effectiveSourceId = parentId;
            console.log(`   🔗 Re-routing edge from merged node ${edge.source} to parent ${effectiveSourceId}`);
          } else {
            console.log(`   🔗 Keeping edge source ${edge.source} (parent ${parentId} was removed by NATIVE BYPASS)`);
          }
          break;
        }
      }

      const sourceNode = this.nodes.find(n => n.id === effectiveSourceId);
      const sourceType = sourceNode ? this.getNodeType(sourceNode) : 'unknown';

      // Skip edges from start/trigger nodes (we handle start->entry separately)
      if (sourceType === 'start' || sourceType === 'trigger') {
        continue;
      }

      if (conditionNodeIds.has(edge.source)) {
        // Edge coming FROM a condition node - process as conditional
        this.processConditionEdge(edge, edgesToConditions);
      } else if (!conditionNodeIds.has(edge.target)) {
        // Skip edges that were internally absorbed during merging
        // e.g. If Message is merged with WhatsApp, skip the Message -> WhatsApp edge
        const mergeMap = this.getMergeMap();
        const mergedChildren = mergeMap[effectiveSourceId] || [];
        if (mergedChildren.includes(edge.target)) {
          console.log(`   🔗 Skipping internal merged edge: ${effectiveSourceId} -> ${edge.target}`);
          continue;
        }

        if (this.mergedNodeIds.has(edge.target) && edge.source === effectiveSourceId) {
          console.log(`   🔗 Skipping absorbed edge: ${edge.source} -> ${edge.target}`);
          continue;
        }

        // Normal edge (not involving condition nodes)
        // For message/question nodes, use LLM condition to wait for user response
        const forwardCondition = this.buildForwardConditionForNodeType(sourceType, sourceNode, edge);
        this.addEdge(effectiveSourceId, edge.target, forwardCondition);
      }
      // Edges TO condition nodes are handled when processing FROM edges
    }
  }

  /**
   * Build appropriate forward condition based on source node type and waitForResponse config
   * 
   * Dynamic behavior based on user-configurable waitForResponse setting:
   * - waitForResponse = true  → LLM condition (waits for user response before proceeding)
   * - waitForResponse = false → unconditional (proceeds immediately after speaking)
   * 
   * Smart defaults when waitForResponse is not explicitly set:
   * - Message nodes: false (proceed immediately)
   * - Question nodes: true (wait for answer)
   * - Form/Appointment: true (wait for data collection)
   * - Delay nodes: false (proceed after delay)
   */
  private buildForwardConditionForNodeType(
    sourceType: string,
    sourceNode: FlowNode | undefined,
    edge: FlowEdge
  ): ForwardCondition {
    const config = sourceNode ? this.getNodeConfig(sourceNode) : {};
    const edgeData = (edge as any).data || {};

    // Priority 1: Custom condition from flow builder (edge.data.condition)
    if (edgeData.condition && typeof edgeData.condition === 'string') {
      return {
        type: 'llm',
        condition: edgeData.condition
      };
    }

    // Priority 2: Check if edge has explicit sourceHandle conditions (yes/no/transfer branching)
    if (edge.sourceHandle) {
      const handle = edge.sourceHandle.toLowerCase();

      // Yes/acceptance handles
      if (handle === 'yes' || handle === 'true' || handle === 'accept' || handle === 'agree') {
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.YES_ACCEPTANCE
        };
      }

      // No/rejection handles
      if (handle === 'no' || handle === 'false' || handle === 'reject' || handle === 'decline') {
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.NO_REJECTION
        };
      }

      // Transfer intent handles
      if (handle === 'transfer' || handle === 'human' || handle === 'agent') {
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.TRANSFER_INTENT
        };
      }

      // Question/confusion handles
      if (handle === 'question' || handle === 'confused' || handle === 'clarify') {
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.CONFUSION
        };
      }

      // Silence/no response handles
      if (handle === 'silence' || handle === 'noresponse' || handle === 'timeout') {
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.SILENCE
        };
      }
    }

    // Priority 3: Use waitForResponse setting from node config (user-configurable)
    // This provides dynamic control over when agent waits vs proceeds immediately
    const waitForResponse = this.getWaitForResponseSetting(sourceType, config);

    // If waitForResponse is false, use unconditional (proceed immediately)
    // This is the fastest way to move between nodes in ElevenLabs
    if (!waitForResponse) {
      return { type: 'unconditional' };
    }

    // waitForResponse is true - generate appropriate LLM condition based on node type
    return this.buildWaitConditionForNodeType(sourceType, config);
  }

  /**
   * Get the waitForResponse setting for a node, using smart defaults per type
   */
  private getWaitForResponseSetting(sourceType: string, config: Record<string, any>): boolean {
    // Message nodes should NEVER wait for a response in this engine, 
    // even if explicitly set, to ensure they proceed to tool nodes immediately.
    if (sourceType === 'message' || sourceType === 'greeting') {
      const messageText = config.message || config.text || '';
      // If message has variables, it MUST wait for response to collect them
      if (messageText.includes('{{')) {
        return true;
      }
      return false;
    }

    // If explicitly set in config, use that value for other node types
    if (typeof config.waitForResponse === 'boolean') {
      return config.waitForResponse;
    }

    // Smart defaults based on node type
    switch (sourceType) {
      case 'question':
        return true; // Questions should wait for answers by default

      case 'form':
      case 'form_submission':
      case 'collect_info':
        return true; // Forms need data collection to complete

      case 'appointment':
        return true; // Appointments need booking to complete

      case 'message':
      case 'greeting':
      case 'delay':
      case 'wait':
      case 'pause':
        return false; // Proceed immediately

      case 'send_email':
      case 'send_whatsapp':
        return true; // Must wait for the AI to call the webhook tool before transitioning

      default:
        return false; // Unknown types proceed immediately
    }
  }

  /**
   * Build the appropriate LLM wait condition for a node type
   * Called when waitForResponse is true
   */
  private buildWaitConditionForNodeType(sourceType: string, config: Record<string, any>): ForwardCondition {
    switch (sourceType) {
      case 'question':
        // Question nodes: LLM must wait for user to answer THIS SPECIFIC question
        const questionText = config.message || config.question || config.text || '';
        if (questionText) {
          const shortQuestion = questionText.substring(0, 100).replace(/['"]/g, '');
          return {
            type: 'llm',
            condition: `The agent just asked: "${shortQuestion}" and the user has now responded specifically to THIS question. The user's response directly addresses what was just asked. Proceed only after the user responds to this specific question.`
          };
        }
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.QUESTION_ANSWERED
        };

      case 'form':
      case 'form_submission':
      case 'collect_info':
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.FORM_COMPLETE
        };

      case 'appointment':
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.APPOINTMENT_COMPLETE
        };

      case 'send_whatsapp':
        return {
          type: 'result',
          successful: true
        };

      case 'send_email':
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.EMAIL_COMPLETE
        };

      case 'message':
      case 'greeting':
        // When message node has waitForResponse=true, wait for any response
        const messageText = config.message || config.text || '';
        if (messageText) {
          // If message has variables, use a collection-specific condition
          if (messageText.includes('{{')) {
            return {
              type: 'llm',
              condition: `The agent is currently having a conversation to collect missing information for the message. Proceed only after all required details are gathered, the agent has delivered the final scripted message, and any associated system tasks (like sending a WhatsApp or email) are confirmed complete.`
            };
          }

          const shortMessage = messageText.substring(0, 80).replace(/['"]/g, '');
          return {
            type: 'llm',
            condition: `The agent said: "${shortMessage}..." and is waiting for the user to respond before proceeding. Wait for the user to speak.`
          };
        }
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.GENERIC_RESPONSE
        };

      default:
        // For any other type with waitForResponse=true, wait for generic response
        return {
          type: 'llm',
          condition: LLM_CONDITIONS.GENERIC_RESPONSE
        };
    }
  }

  /**
   * Process an edge coming from a condition node
   */
  private processConditionEdge(edge: FlowEdge, edgesToConditions: Map<string, FlowEdge>): void {
    const conditionNode = this.nodes.find(n => n.id === edge.source);
    if (!conditionNode) return;

    const incomingEdge = edgesToConditions.get(conditionNode.id);
    if (!incomingEdge) return;

    // Skip if source node doesn't exist in compiled nodes
    if (!this.compiledNodes[incomingEdge.source]) return;

    const config = this.getNodeConfig(conditionNode);
    const conditions = config.conditions || [];

    // Build condition text for this edge
    let conditionText = '';

    if (conditions.length > 0) {
      // Try to match by targetNodeId
      const matchingCondition = conditions.find((c: any) => c.targetNodeId === edge.target);

      if (matchingCondition) {
        conditionText = this.buildConditionText(matchingCondition, config);
      } else {
        // Try matching by sourceHandle
        const handleCondition = conditions.find((c: any) =>
          c.id === edge.sourceHandle || c.label === edge.sourceHandle
        );
        if (handleCondition) {
          conditionText = this.buildConditionText(handleCondition, config);
        }
      }
    }

    // Fallback to sourceHandle-based conditions
    if (!conditionText && edge.sourceHandle) {
      conditionText = this.buildHandleCondition(edge.sourceHandle);
    }

    // Create edge from the node before condition to the target
    const forwardCondition: ForwardCondition = conditionText
      ? { type: 'llm', condition: conditionText }
      : { type: 'unconditional' };

    this.addEdge(incomingEdge.source, edge.target, forwardCondition);
  }

  /**
   * Build condition text from a condition config
   */
  private buildConditionText(condition: any, nodeConfig: any): string {
    const conditionType = condition.type || 'keyword';
    const value = condition.value || condition.label || '';
    const description = condition.description || '';

    // Use description if provided
    if (description) {
      return description;
    }

    // Yes/No conditions
    if (conditionType === 'yes_no' || conditionType === 'boolean') {
      if (value.toLowerCase() === 'yes' || value.toLowerCase() === 'true') {
        return 'User said yes or agreed';
      } else if (value.toLowerCase() === 'no' || value.toLowerCase() === 'false') {
        return 'User said no or declined';
      }
    }

    // Sentiment conditions
    if (conditionType === 'sentiment') {
      const sentiment = value.toLowerCase();
      if (sentiment === 'positive' || sentiment === 'interested') {
        return 'User sounds interested';
      } else if (sentiment === 'negative' || sentiment === 'not_interested') {
        return 'User sounds not interested';
      } else if (sentiment === 'neutral') {
        return 'User sounds neutral';
      }
    }

    // Keyword/value matching
    if (value) {
      return `User mentioned "${value}"`;
    }

    return '';
  }

  /**
   * Build condition from edge sourceHandle
   */
  private buildHandleCondition(handle: string): string {
    const h = handle.toLowerCase();

    if (h === 'true' || h === 'yes') {
      return 'User said yes or agreed';
    }
    if (h === 'false' || h === 'no') {
      return 'User said no or declined';
    }
    if (h === 'default' || h === 'else' || h === 'otherwise') {
      return 'Other cases';
    }

    return `User mentioned "${handle}"`;
  }

  /**
   * Add an edge to the compiled output
   * Includes condition-aware deduplication to prevent truly duplicate edges
   * while preserving legitimate multiple edges with different conditions
   */
  private addEdge(source: string, target: string, forwardCondition: ForwardCondition): void {
    // Skip if source or target doesn't exist
    if (!this.compiledNodes[source]) return;
    if (!this.compiledNodes[target] && target !== 'start_node') return;

    // Priority 1: Check for "Multiple unconditional outgoing edges" constraint (ElevenLabs requirement)
    if (forwardCondition.type === 'unconditional') {
      const existingUnconditional = Object.values(this.compiledEdges).find(edge =>
        edge.source === source && edge.forward_condition.type === 'unconditional'
      );
      if (existingUnconditional) {
        console.log(`   ⚠️ ElevenLabs Constraint: Skipping additional unconditional edge from ${source} to ${target}. A node can only have ONE unconditional edge.`);
        return;
      }
    }

    // Priority 2: Condition-aware deduplication: only skip if source, target, AND condition are identical
    const existingEdge = Object.entries(this.compiledEdges).find(([_, edge]) => {
      if (edge.source !== source || edge.target !== target) return false;

      // Compare forward conditions
      if (edge.forward_condition.type !== forwardCondition.type) return false;

      // For LLM conditions, also compare the condition text
      if (forwardCondition.type === 'llm') {
        const existingLlm = edge.forward_condition as LLMCondition;
        const newLlm = forwardCondition as LLMCondition;
        return existingLlm.condition === newLlm.condition;
      }

      // For unconditional, type match is sufficient
      return true;
    });

    if (existingEdge) {
      // Exact duplicate edge (same source, target, and condition) - skip to prevent ElevenLabs API rejection
      console.log(`   ⚠️ Skipping duplicate edge: ${source} -> ${target} (${forwardCondition.type}) - already exists as ${existingEdge[0]}`);
      return;
    }

    const edgeId = this.generateEdgeId(source, target);

    this.compiledEdges[edgeId] = {
      source,
      target,
      forward_condition: forwardCondition
    };

    // Add to source node's edge_order
    const sourceNode = this.compiledNodes[source];
    if (sourceNode && 'edge_order' in sourceNode) {
      sourceNode.edge_order.push(edgeId);
    }
  }

  /**
   * Validate the compiled workflow
   */
  validate(): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for at least one node besides start
    const nodeCount = Object.keys(this.compiledNodes).length;
    if (nodeCount <= 1) {
      errors.push('Workflow must have at least one node besides start');
    }

    // Check for start node
    if (!this.compiledNodes['start_node']) {
      errors.push('Workflow must have a start node');
    }

    // Check that all edge targets exist
    for (const [edgeId, edge] of Object.entries(this.compiledEdges)) {
      if (!this.compiledNodes[edge.target]) {
        errors.push(`Edge ${edgeId} targets non-existent node ${edge.target}`);
      }
      if (!this.compiledNodes[edge.source]) {
        errors.push(`Edge ${edgeId} has non-existent source ${edge.source}`);
      }
    }

    // Check for unreachable nodes (excluding start)
    const reachableNodes = new Set(['start_node']);
    for (const edge of Object.values(this.compiledEdges)) {
      reachableNodes.add(edge.target);
    }

    for (const nodeId of Object.keys(this.compiledNodes)) {
      if (nodeId !== 'start_node' && !reachableNodes.has(nodeId)) {
        warnings.push(`Node ${nodeId} is not reachable from any other node`);
      }
    }

    // Check for nodes with no outgoing edges (excluding end nodes)
    for (const [nodeId, node] of Object.entries(this.compiledNodes)) {
      if (node.type !== 'end' && node.type !== 'phone_number' && node.type !== 'standalone_agent') {
        if (node.edge_order.length === 0 && nodeId !== 'start_node') {
          warnings.push(`Node ${nodeId} has no outgoing edges`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}
