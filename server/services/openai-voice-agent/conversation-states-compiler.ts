'use strict';
/**
 * ============================================================
 * Conversation States Compiler
 * 
 * Converts flow builder nodes to OpenAI's Conversation States format
 * Following: https://platform.openai.com/docs/guides/voice-agents
 * ============================================================
 */

import type {
  FlowNode,
  FlowEdge,
  ConversationState,
  ConversationTransition,
  CompiledConversationStates,
  AgentCompilationConfig,
} from './types';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  fil: 'Filipino',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  cs: 'Czech',
  sk: 'Slovak',
  hu: 'Hungarian',
  ro: 'Romanian',
  bg: 'Bulgarian',
  uk: 'Ukrainian',
  he: 'Hebrew',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
};

export class ConversationStatesCompiler {
  /**
   * Get the actual node type from node.data.type or node.data.config.type
   * Flow builder uses type: "custom" at top level, real type is in data
   */
  private static getNodeType(node: FlowNode): string {
    const data = node.data || {};
    // Check data.type first, then data.config.type, then fall back to node.type
    return (data.type as string) || (data.config as any)?.type || node.type || 'unknown';
  }

  /**
   * Get node content (message, question, etc.) from the correct location
   * Content can be in node.data.message, node.data.config.message, etc.
   */
  private static getNodeContent(node: FlowNode, field: string): string {
    const data = node.data || {};
    const config = (data.config as any) || {};
    // Check config first (more specific), then data directly
    return config[field] || (data as any)[field] || '';
  }

  /**
   * Get node label for description
   */
  private static getNodeLabel(node: FlowNode): string {
    const data = node.data || {};
    return (data.label as string) || (data.config as any)?.label || '';
  }

  /**
   * Compile flow nodes to OpenAI Conversation States format
   */
  static compile(
    nodes: FlowNode[],
    edges: FlowEdge[],
    config: AgentCompilationConfig
  ): CompiledConversationStates {
    const languageName = LANGUAGE_NAMES[config.language] || 'English';
    
    // Build adjacency map for transitions
    const adjacencyMap = this.buildAdjacencyMap(edges);
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    
    // Find start node - first node in the list or one with 'start' type
    const startNode = nodes.find(n => this.getNodeType(n) === 'start') || nodes[0];
    
    // Convert nodes to conversation states
    const states: ConversationState[] = [];
    const visited = new Set<string>();
    
    // Process nodes in order starting from start
    if (startNode) {
      this.processNodeChain(startNode.id, nodeMap, adjacencyMap, states, visited);
    }
    
    // Get first message from start node
    let firstMessage: string | undefined;
    if (startNode) {
      const message = this.getNodeContent(startNode, 'message');
      if (message) {
        firstMessage = this.substituteVariables(message);
      }
    }
    
    // Build system prompt header
    const systemPromptHeader = this.buildSystemPromptHeader(config, languageName);
    
    console.log(`[ConversationStatesCompiler] Compiled ${states.length} states from ${nodes.length} nodes`);
    
    return {
      states,
      systemPromptHeader,
      firstMessage,
    };
  }

  /**
   * Build full system prompt with Conversation States JSON
   */
  static buildSystemPrompt(compiled: CompiledConversationStates): string {
    const statesJson = JSON.stringify(compiled.states, null, 2);
    
    return `${compiled.systemPromptHeader}

# Conversation States
${statesJson}

# Instructions
- Follow the conversation states in order, respecting the transitions and conditions.
- When asking for information (name, phone, address, etc.), always repeat it back to verify.
- If the caller corrects any detail, acknowledge the correction and confirm the new value.
- Stay in character and maintain the conversation flow as defined in the states.
- When a state instructs you to call a function/tool, you MUST call it.
- IGNORE background noise, music, or ambient sounds. Do NOT respond to or acknowledge any sounds that are not direct speech from the caller.
- Do NOT change the conversation topic or flow based on background speech, TV, radio, or other people talking nearby. Only respond to the primary caller's direct speech.

# CRITICAL TOOL USAGE REQUIREMENTS
- FORM SUBMISSIONS: After collecting all required information from the caller, you MUST call the submit_form tool with the collected data. Do NOT just say you have saved the information - you MUST actually call the submit_form function to save it.
- ENDING CALLS: When the conversation is complete and you say goodbye, you MUST call the end_call function to disconnect the call. Do NOT just say goodbye and wait - you MUST call end_call to hang up the phone.
- TRANSFERS: When transferring to a human agent, you MUST call the transfer_call function. Do NOT just say you are transferring - actually call the function.
- APPOINTMENTS: When booking appointments, you MUST call the book_appointment function with all collected details.
- SEND EMAIL: When instructed to send an email, you MUST call the appropriate send_email_* function with the recipient email and template name. If no recipient email is pre-configured, ask the caller for it first.
- SEND WHATSAPP: When instructed to send a WhatsApp message, you MUST call the appropriate send_whatsapp_* function with the caller's phone number and template name.
- KNOWLEDGE BASE: When you need information to answer a question, use the lookup_knowledge_base or query_knowledge_base function.

Remember: Saying you will do something is NOT the same as actually calling the tool. You MUST call the appropriate function to perform any action.`;
  }

  /**
   * Process nodes recursively to build conversation states
   */
  private static processNodeChain(
    nodeId: string,
    nodeMap: Map<string, FlowNode>,
    adjacencyMap: Map<string, Array<{ targetId: string; condition?: string; label?: string }>>,
    states: ConversationState[],
    visited: Set<string>
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    
    const node = nodeMap.get(nodeId);
    if (!node) return;
    
    // Convert node to conversation state
    const state = this.nodeToState(node, adjacencyMap, nodeMap);
    if (state) {
      states.push(state);
    }
    
    // Process connected nodes
    const targets = adjacencyMap.get(nodeId) || [];
    for (const target of targets) {
      this.processNodeChain(target.targetId, nodeMap, adjacencyMap, states, visited);
    }
  }

  /**
   * Convert a single flow node to a conversation state
   */
  private static nodeToState(
    node: FlowNode,
    adjacencyMap: Map<string, Array<{ targetId: string; condition?: string; label?: string }>>,
    nodeMap: Map<string, FlowNode>
  ): ConversationState | null {
    const nodeType = this.getNodeType(node);
    const targets = adjacencyMap.get(node.id) || [];
    
    // Build transitions with descriptive conditions
    const transitions: ConversationTransition[] = targets.map(t => {
      const targetNode = nodeMap.get(t.targetId);
      const targetType = targetNode ? this.getNodeType(targetNode) : 'next step';
      const targetLabel = targetNode ? this.getNodeLabel(targetNode) : '';
      
      return {
        next_step: t.targetId,
        condition: t.condition || t.label || `Once this step is complete, proceed to ${targetLabel || targetType}.`,
      };
    });

    const message = this.getNodeContent(node, 'message');
    const question = this.getNodeContent(node, 'question');
    const variableName = this.getNodeContent(node, 'variableName');
    const label = this.getNodeLabel(node);
    const config = (node.data?.config as any) || {};

    switch (nodeType) {
      case 'start':
        return {
          id: node.id,
          description: label || 'Start the conversation and greet the caller.',
          instructions: [
            message ? `Say: "${this.substituteVariables(message)}"` : 'Greet the caller warmly.',
          ],
          examples: message ? [this.substituteVariables(message)] : ['Hello! How can I help you today?'],
          transitions,
        };

      case 'message':
        return {
          id: node.id,
          description: label || 'Deliver a message to the caller.',
          instructions: [
            `Say: "${this.substituteVariables(message)}"`,
          ],
          examples: [this.substituteVariables(message)],
          transitions,
        };

      case 'question':
        const questionText = question || message;
        return {
          id: node.id,
          description: label || `Ask the caller: "${questionText}"`,
          instructions: [
            `Ask: "${this.substituteVariables(questionText)}"`,
            'Wait for the caller to respond.',
            variableName 
              ? `Store their response as "${variableName}" for later use.`
              : 'Remember their answer for the conversation.',
            'Confirm what you heard by repeating it back to them.',
          ],
          examples: [
            this.substituteVariables(questionText),
            variableName ? `So you said [their answer], is that correct?` : undefined,
          ].filter(Boolean) as string[],
          transitions,
        };

      case 'condition':
        const conditions = (config.conditions as Array<{ field: string; operator: string; value: string }>) || [];
        return {
          id: node.id,
          description: label || 'Evaluate conditions and route the conversation.',
          instructions: [
            ...conditions.map((c, i) => 
              `If ${c.field} ${c.operator} "${c.value}", proceed accordingly.`
            ),
            'Route the conversation based on the evaluation.',
          ],
          transitions,
        };

      case 'transfer':
        const transferNumber = config.phoneNumber || config.transferNumber || '';
        const transferMessage = message || config.transferMessage || '';
        return {
          id: node.id,
          description: label || 'Transfer the caller to a human agent.',
          instructions: [
            transferMessage 
              ? `Say: "${this.substituteVariables(transferMessage)}"` 
              : 'Inform the caller you are transferring them.',
            `Call the "transfer_call" function to transfer to ${transferNumber || 'the designated number'}.`,
          ],
          examples: [
            transferMessage || "I'll connect you with a specialist who can help you further. Please hold.",
          ],
          transitions,
        };

      case 'webhook':
      case 'api_call':
        const toolName = `webhook_${node.id.replace(/-/g, '_')}`;
        const webhookUrl = config.url || config.webhookUrl || '';
        const webhookDescription = config.description || label || 'execute the webhook';
        return {
          id: node.id,
          description: label || `Execute webhook to ${webhookDescription}.`,
          instructions: [
            message ? `Say: "${this.substituteVariables(message)}"` : undefined,
            `Call the "${toolName}" function to ${webhookDescription}.`,
            'Wait for the result and use it to continue the conversation.',
            'Inform the caller of the outcome.',
          ].filter(Boolean) as string[],
          examples: [
            'Processing your request now, please hold for a moment.',
            'Your request has been submitted successfully.',
          ],
          transitions,
        };

      case 'end_call':
      case 'end':
        return {
          id: node.id,
          description: label || 'End the conversation politely.',
          instructions: [
            message 
              ? `Say: "${this.substituteVariables(message)}"` 
              : 'Thank the caller and say goodbye.',
            'Call the "end_call" function to end the call.',
          ],
          examples: [
            message || 'Thank you for calling. Have a great day!',
          ],
          transitions: [],
        };

      case 'delay':
        const duration = config.duration || node.data?.duration || 1;
        return {
          id: node.id,
          description: label || 'Pause briefly.',
          instructions: [
            `Wait for ${duration} seconds.`,
            message ? `Then say: "${this.substituteVariables(message)}"` : undefined,
          ].filter(Boolean) as string[],
          transitions,
        };

      case 'tool':
        const toolCallName = config.toolName || node.data?.toolName || 'tool';
        return {
          id: node.id,
          description: label || `Use the ${toolCallName} tool.`,
          instructions: [
            `Call the "${toolCallName}" function.`,
            'Use the result to help the caller.',
          ],
          transitions,
        };

      case 'play_audio':
        const audioFileName = config.audioFileName || 'audio file';
        const playAudioToolName = `play_audio_${node.id.replace(/-/g, '_').slice(-8)}`;
        return {
          id: node.id,
          description: label || `Play the audio file "${audioFileName}".`,
          instructions: [
            message ? `Say: "${this.substituteVariables(message)}"` : undefined,
            `Call the "${playAudioToolName}" function to play the audio.`,
            config.waitForComplete !== false 
              ? 'Wait for the audio to finish playing before continuing.' 
              : 'Continue the conversation while the audio plays.',
          ].filter(Boolean) as string[],
          examples: [
            'Let me play that for you now.',
            'Here is the audio you requested.',
          ],
          transitions,
        };

      case 'send_email': {
        const emailTemplateName = config.templateName || config.template_name || 'default';
        const recipientEmail = config.recipientEmail || '';
        const sendEmailToolName = `send_email_${node.id.replace(/-/g, '_').slice(-8)}`;
        return {
          id: node.id,
          description: label || `Send an email using the "${emailTemplateName}" template.`,
          instructions: [
            message ? `Say: "${this.substituteVariables(message)}"` : undefined,
            recipientEmail
              ? `The recipient email is already configured as "${recipientEmail}".`
              : 'Ask the caller for their email address if you do not already have it.',
            `Call the "${sendEmailToolName}" function to send the email.`,
            'Confirm to the caller that the email has been sent.',
          ].filter(Boolean) as string[],
          examples: [
            'I will send you a confirmation email shortly.',
            'The email has been sent to your address.',
          ],
          transitions,
        };
      }

      case 'send_whatsapp': {
        const waTemplateName = config.templateName || config.template_name || 'hello_world';
        const sendWhatsappToolName = `send_whatsapp_${node.id.replace(/-/g, '_').slice(-8)}`;
        return {
          id: node.id,
          description: label || `Send a WhatsApp message using the "${waTemplateName}" template.`,
          instructions: [
            message ? `Say: "${this.substituteVariables(message)}"` : undefined,
            `Call the "${sendWhatsappToolName}" function to send the WhatsApp message to the caller.`,
            'Confirm to the caller that the WhatsApp message has been sent.',
          ].filter(Boolean) as string[],
          examples: [
            'I will send you a WhatsApp message with the details.',
            'The WhatsApp message has been sent.',
          ],
          transitions,
        };
      }

      default:
        // For unknown types, still create a state if there's content
        if (message) {
          console.log(`[ConversationStatesCompiler] Unknown node type "${nodeType}", creating generic state`);
          return {
            id: node.id,
            description: label || 'Continue the conversation.',
            instructions: [`Say: "${this.substituteVariables(message)}"`],
            examples: [this.substituteVariables(message)],
            transitions,
          };
        }
        console.log(`[ConversationStatesCompiler] Skipping node "${node.id}" with unknown type "${nodeType}"`);
        return null;
    }
  }

  /**
   * Build adjacency map from edges
   */
  private static buildAdjacencyMap(
    edges: FlowEdge[]
  ): Map<string, Array<{ targetId: string; condition?: string; label?: string }>> {
    const map = new Map<string, Array<{ targetId: string; condition?: string; label?: string }>>();
    
    for (const edge of edges) {
      const targets = map.get(edge.source) || [];
      targets.push({
        targetId: edge.target,
        condition: edge.condition,
        label: edge.label,
      });
      map.set(edge.source, targets);
    }
    
    return map;
  }

  /**
   * Build system prompt header with personality and language
   */
  private static buildSystemPromptHeader(
    config: AgentCompilationConfig,
    languageName: string
  ): string {
    const parts: string[] = [];
    
    // Language requirement (critical for non-English)
    if (config.language !== 'en') {
      parts.push(`# CRITICAL LANGUAGE REQUIREMENT
You MUST speak ONLY in ${languageName}. From the very first word you say, speak in ${languageName}. Do NOT speak English. This is mandatory.
`);
    }
    
    // Personality and tone
    parts.push(`# Personality and Tone
## Identity
${config.agentName ? `You are ${config.agentName}.` : 'You are an AI voice assistant.'} ${config.agentPersonality || 'You are helpful, professional, and friendly.'}

## Task
Follow the conversation flow defined below. Guide the caller through each step while maintaining a natural conversational style. You MUST follow the states in order and call the specified functions when instructed.

## Demeanor
Professional yet warm and approachable.

## Tone
Conversational and clear.

## Level of Formality
Professional but not stiff.

## Pacing
Speak at a natural pace, pausing when appropriate to let the caller respond.`);

    // Noise resistance
    parts.push(`
## Background Noise Handling
- IGNORE background noise, music, TV, radio, or ambient sounds entirely.
- Only respond to the primary caller's direct speech addressed to you.
- Do NOT change topics or acknowledge background conversations.`);

    return parts.join('\n');
  }

  /**
   * Substitute variables in text (e.g., {{name}} -> caller's name)
   */
  private static substituteVariables(text: string): string {
    // Keep variable placeholders for runtime substitution
    return text;
  }
}
