'use strict';
/**
 * ============================================================
 * Shared OpenAI Voice Agent Types
 * 
 * Types following OpenAI's official Voice Agents documentation
 * https://platform.openai.com/docs/guides/voice-agents
 * ============================================================
 */

/**
 * OpenAI Conversation State following official format
 * Each state represents a step in the conversation flow
 */
export interface ConversationState {
  id: string;
  description: string;
  instructions: string[];
  examples?: string[];
  transitions: ConversationTransition[];
}

/**
 * Transition between conversation states
 */
export interface ConversationTransition {
  next_step: string;
  condition: string;
}

/**
 * Compiled conversation states for OpenAI Voice Agent
 */
export interface CompiledConversationStates {
  states: ConversationState[];
  systemPromptHeader: string;
  firstMessage?: string;
}

/**
 * OpenAI Function Tool following official format
 * https://platform.openai.com/docs/guides/tools?tool-type=function-calling
 */
export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  userId: string;
  agentId: string;
  callId: string;
  fromNumber?: string;
  toNumber?: string;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Flow node types from the flow builder
 */
export type FlowNodeType = 
  | 'start'
  | 'message'
  | 'question'
  | 'condition'
  | 'transfer'
  | 'webhook'
  | 'api_call'
  | 'end_call'
  | 'delay'
  | 'tool';

/**
 * Flow node from flow builder
 */
export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

/**
 * Flow edge connecting nodes
 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  condition?: string;
  label?: string;
}

/**
 * Agent configuration for compilation
 */
export interface AgentCompilationConfig {
  language: string;
  voice: string;
  model: string;
  temperature?: number;
  agentName?: string;
  agentPersonality?: string;
  knowledgeBaseIds?: string[];
  transferPhoneNumber?: string;
  transferEnabled?: boolean;
  endConversationEnabled?: boolean;
}

/**
 * Complete compiled flow result
 */
export interface CompiledFlowResult {
  systemPrompt: string;
  firstMessage?: string;
  tools: OpenAIFunctionTool[];
  conversationStates: ConversationState[];
}
