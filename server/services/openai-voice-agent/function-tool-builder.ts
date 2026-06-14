'use strict';
/**
 * ============================================================
 * Function Tool Builder
 * 
 * Creates OpenAI function tool definitions following official format
 * https://platform.openai.com/docs/guides/tools?tool-type=function-calling
 * ============================================================
 */

import type {
  FlowNode,
  OpenAIFunctionTool,
  AgentCompilationConfig,
} from './types';

export class FunctionToolBuilder {
  /**
   * Get the actual node type from node.data.type or node.data.config.type
   * Flow builder uses type: "custom" at top level, real type is in data
   */
  private static getNodeType(node: FlowNode): string {
    const data = node.data || {};
    return (data.type as string) || (data.config as any)?.type || node.type || 'unknown';
  }

  /**
   * Get node config data
   */
  private static getNodeConfig(node: FlowNode): any {
    return (node.data?.config as any) || node.data || {};
  }

  /**
   * Build all function tools from flow nodes and agent config
   */
  static buildTools(
    nodes: FlowNode[],
    config: AgentCompilationConfig
  ): OpenAIFunctionTool[] {
    const tools: OpenAIFunctionTool[] = [];
    
    // Add knowledge base tool if configured
    if (config.knowledgeBaseIds && config.knowledgeBaseIds.length > 0) {
      tools.push(this.buildKnowledgeBaseTool());
    }
    
    // Add transfer tool if enabled
    if (config.transferEnabled && config.transferPhoneNumber) {
      tools.push(this.buildTransferTool(config.transferPhoneNumber));
    }
    
    // Add end call tool if enabled
    if (config.endConversationEnabled !== false) {
      tools.push(this.buildEndCallTool());
    }
    
    // Add tools from flow nodes
    for (const node of nodes) {
      const nodeTool = this.buildNodeTool(node);
      if (nodeTool) {
        tools.push(nodeTool);
      }
    }
    
    console.log(`[FunctionToolBuilder] Built ${tools.length} tools from ${nodes.length} nodes`);
    
    return tools;
  }

  /**
   * Build knowledge base lookup tool
   */
  static buildKnowledgeBaseTool(): OpenAIFunctionTool {
    return {
      type: 'function',
      function: {
        name: 'lookup_knowledge_base',
        description: 'Search the knowledge base for relevant information to answer user questions. Use this when you need facts, policies, product details, pricing, or any specific information.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to find relevant information. Be specific and include key terms from the user\'s question.',
            },
          },
          required: ['query'],
        },
      },
    };
  }

  /**
   * Build transfer call tool
   */
  static buildTransferTool(defaultNumber?: string): OpenAIFunctionTool {
    const tool: OpenAIFunctionTool = {
      type: 'function',
      function: {
        name: 'transfer_call',
        description: `Transfer the caller to a human agent or specialist. ${defaultNumber ? `Default transfer number: ${defaultNumber}.` : ''} Let the caller know you're about to transfer them before calling this function.`,
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'The reason for the transfer, to provide context to the receiving agent.',
            },
            destination: {
              type: 'string',
              description: 'The destination to transfer to (optional, uses default if not specified).',
            },
          },
          required: ['reason'],
        },
      },
    };
    
    // Add transfer number metadata for serialization/deserialization
    if (defaultNumber) {
      (tool as unknown as Record<string, unknown>)._transferNumber = defaultNumber;
      (tool as unknown as Record<string, unknown>)._metadata = { phoneNumber: defaultNumber };
    }
    
    return tool;
  }

  /**
   * Build end call tool
   */
  static buildEndCallTool(): OpenAIFunctionTool {
    return {
      type: 'function',
      function: {
        name: 'end_call',
        description: 'End the phone call. Use this when the conversation is complete, the caller wants to hang up, or you have finished helping them. Always say goodbye before calling this function.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'The reason for ending the call (e.g., "conversation complete", "caller requested", "issue resolved").',
            },
          },
          required: ['reason'],
        },
      },
    };
  }

  /**
   * Build appointment booking tool (standalone, used when agent has appointment enabled)
   */
  static buildAppointmentTool(): OpenAIFunctionTool {
    return {
      type: 'function',
      function: {
        name: 'book_appointment',
        description: 'Book an appointment for the caller. Collect the necessary details (name, phone, date, time) before calling this function.',
        parameters: {
          type: 'object',
          properties: {
            contactName: {
              type: 'string',
              description: 'The name of the person booking the appointment.',
            },
            contactPhone: {
              type: 'string',
              description: 'The phone number of the person booking.',
            },
            contactEmail: {
              type: 'string',
              description: 'The email address of the person booking (optional).',
            },
            appointmentDate: {
              type: 'string',
              description: 'The appointment date in YYYY-MM-DD format.',
            },
            appointmentTime: {
              type: 'string',
              description: 'The appointment time in HH:MM format (24-hour).',
            },
            duration: {
              type: 'number',
              description: 'Duration of the appointment in minutes. Default is 30.',
            },
            serviceName: {
              type: 'string',
              description: 'The name of the service being booked (optional).',
            },
            notes: {
              type: 'string',
              description: 'Additional notes or purpose for the appointment.',
            },
          },
          required: ['contactName', 'contactPhone', 'appointmentDate', 'appointmentTime'],
        },
      },
    };
  }

  /**
   * Build tool from flow node (webhook, API call, appointment, etc.)
   */
  private static buildNodeTool(node: FlowNode): (OpenAIFunctionTool & { _metadata?: any }) | null {
    const nodeType = this.getNodeType(node);
    const config = this.getNodeConfig(node);
    
    switch (nodeType) {
      case 'webhook':
        return this.buildWebhookTool(node, config);
      
      case 'api_call':
        return this.buildApiCallTool(node, config);
      
      case 'appointment':
        return this.buildAppointmentNodeTool(node, config);
      
      case 'form':
        return this.buildFormTool(node, config);
      
      case 'tool':
        return this.buildCustomTool(node, config);
      
      case 'transfer':
        // Transfer nodes create their own transfer tool
        const transferNumber = config.phoneNumber || config.transferNumber;
        if (transferNumber) {
          return {
            type: 'function',
            function: {
              name: `transfer_${node.id.replace(/-/g, '_')}`,
              description: `Transfer to ${node.data?.label || config.label || 'designated department'}. ${config.description || ''}`,
              parameters: {
                type: 'object',
                properties: {
                  context: {
                    type: 'string',
                    description: 'Context about the caller\'s needs to pass to the receiving agent.',
                  },
                },
              },
            },
            _metadata: {
              phoneNumber: transferNumber,
              nodeId: node.id,
            },
          };
        }
        return null;
      
      case 'play_audio':
        // Play Audio nodes create a tool to trigger audio playback
        const audioUrl = config.audioUrl || '';
        const audioFileName = config.audioFileName || 'audio file';
        if (audioUrl) {
          return {
            type: 'function',
            function: {
              name: `play_audio_${node.id.replace(/-/g, '_').slice(-8)}`,
              description: `Play the audio file "${audioFileName}". Use this when instructed to play audio or as part of the conversation flow.`,
              parameters: {
                type: 'object',
                properties: {
                  reason: {
                    type: 'string',
                    description: 'Optional reason for playing the audio.',
                  },
                },
              },
            },
            _metadata: {
              audioUrl,
              audioFileName,
              interruptible: config.interruptible ?? false,
              waitForComplete: config.waitForComplete ?? true,
              nodeId: node.id,
            },
          };
        }
        return null;
      
      case 'send_email':
        return this.buildSendEmailTool(node, config);

      case 'send_whatsapp':
        return this.buildSendWhatsAppTool(node, config);

      // These node types don't create tools - they're handled as conversation states
      case 'message':
      case 'question':
      case 'condition':
      case 'delay':
      case 'end':
      case 'start':
        return null;
      
      default:
        console.log(`[FunctionToolBuilder] Unknown node type '${nodeType}' for node ${node.id} - skipping tool creation`);
        return null;
    }
  }

  /**
   * Build appointment booking tool from node
   * Includes _metadata for hydration
   */
  private static buildAppointmentNodeTool(node: FlowNode, config: any): OpenAIFunctionTool & { _metadata?: any } {
    const toolName = `book_appointment`;
    const description = config.description || node.data?.label || config.label || 'Book an appointment for the caller';
    
    return {
      type: 'function',
      function: {
        name: toolName,
        description: `${description}. Collect the necessary details (name, phone, date, time) before calling this function.`,
        parameters: {
          type: 'object',
          properties: {
            contactName: {
              type: 'string',
              description: 'The name of the person booking the appointment.',
            },
            contactPhone: {
              type: 'string',
              description: 'The phone number of the person booking.',
            },
            contactEmail: {
              type: 'string',
              description: 'The email address of the person booking (optional).',
            },
            appointmentDate: {
              type: 'string',
              description: 'The appointment date in YYYY-MM-DD format.',
            },
            appointmentTime: {
              type: 'string',
              description: 'The appointment time in HH:MM format (24-hour).',
            },
            duration: {
              type: 'number',
              description: 'Duration of the appointment in minutes. Default is 30.',
            },
            serviceName: {
              type: 'string',
              description: 'The name of the service being booked (optional).',
            },
            notes: {
              type: 'string',
              description: 'Additional notes or purpose for the appointment.',
            },
          },
          required: ['contactName', 'contactPhone', 'appointmentDate', 'appointmentTime'],
        },
      },
      _metadata: {
        nodeId: node.id,
        defaultDuration: config.duration || config.defaultDuration || 30,
        serviceName: config.serviceName || config.service,
        calendarId: config.calendarId,
        notifyEmail: config.notifyEmail,
        confirmationMessage: config.confirmationMessage,
        googleSheetId: config.googleSheetId,
        googleSheetName: config.googleSheetName,
      },
    };
  }

  private static buildSendEmailTool(node: FlowNode, config: any): OpenAIFunctionTool & { _metadata?: any } {
    const toolName = `send_email_${node.id.replace(/-/g, '_').slice(-8)}`;
    const templateName = config.templateName || config.template_name || 'default';
    const recipientEmail = config.recipientEmail || '';

    const properties: Record<string, { type: string; description: string }> = {
      recipient_email: {
        type: 'string',
        description: 'The email address of the recipient.',
      },
      template_name: {
        type: 'string',
        description: `The email template to use. Default: "${templateName}".`,
      },
    };
    const required: string[] = recipientEmail ? ['template_name'] : ['recipient_email', 'template_name'];

    return {
      type: 'function',
      function: {
        name: toolName,
        description: `Send an email using the "${templateName}" template.${recipientEmail ? ` The recipient email is pre-configured as "${recipientEmail}".` : ' Collect the recipient email from the caller before calling this function.'}`,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
      _metadata: {
        nodeId: node.id,
        templateName,
        recipientEmail,
      },
    };
  }

  private static buildSendWhatsAppTool(node: FlowNode, config: any): OpenAIFunctionTool & { _metadata?: any } {
    const toolName = `send_whatsapp_${node.id.replace(/-/g, '_').slice(-8)}`;
    const templateName = config.templateName || config.template_name || 'hello_world';
    const language = config.language || 'en_US';
    const templateVariables = config.templateVariables || [];

    const properties: Record<string, { type: string; description: string }> = {
      phone_number: {
        type: 'string',
        description: 'The phone number to send the WhatsApp message to (with country code).',
      },
      template_name: {
        type: 'string',
        description: `The WhatsApp template to use. Default: "${templateName}".`,
      },
    };

    if (templateVariables.length > 0) {
      for (const tv of templateVariables) {
        const varKey = `variable_${tv.position}`;
        properties[varKey] = {
          type: 'string',
          description: `Value for template variable {{${tv.position}}}${tv.source && tv.source !== 'custom' ? ` (maps to ${tv.source})` : ''}.`,
        };
      }
    }

    return {
      type: 'function',
      function: {
        name: toolName,
        description: `Send a WhatsApp message using the "${templateName}" template (${language}). The message will be sent to the caller's phone number.`,
        parameters: {
          type: 'object',
          properties,
          required: ['phone_number', 'template_name'],
        },
      },
      _metadata: {
        nodeId: node.id,
        templateName,
        language,
        templateVariables,
      },
    };
  }

  /**
   * Build form collection tool from node
   * Includes _metadata for hydration
   */
  private static buildFormTool(node: FlowNode, config: any): OpenAIFunctionTool & { _metadata?: any } {
    const toolName = `submit_form_${node.id.replace(/-/g, '_')}`;
    const fields = config.fields || [];
    const description = config.description || node.data?.label || config.label || 'Submit the collected form data';
    
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    
    // If no fields defined, add default contact fields
    // This ensures the AI model knows what data to collect and pass
    if (fields.length === 0) {
      properties['fullName'] = {
        type: 'string',
        description: 'The full name of the person (first and last name).',
      };
      properties['email'] = {
        type: 'string',
        description: 'The email address of the person.',
      };
      properties['phone'] = {
        type: 'string',
        description: 'The phone number of the person.',
      };
      required.push('fullName', 'email', 'phone');
      console.log(`[FunctionToolBuilder] Form node ${node.id} has no fields - using default contact fields`);
    } else {
      for (const field of fields) {
        properties[field.name || field.id] = {
          type: field.type || 'string',
          description: field.description || field.label || `Field: ${field.name || field.id}`,
        };
        if (field.required) {
          required.push(field.name || field.id);
        }
      }
    }
    
    // Validate that formId is present — missing formId means submissions will silently fail at runtime
    if (!config.formId) {
      console.error(`[FunctionToolBuilder] CRITICAL: Form node ${node.id} is missing config.formId. ` +
        `The compiled tool "${toolName}" will fail when the agent tries to submit form data. ` +
        `Check that the form node's formId is set correctly in the flow configuration.`);
    }
    
    return {
      type: 'function',
      function: {
        name: toolName,
        description: `${description}. IMPORTANT: You MUST call this function after collecting the user's name, email, and phone number to save their information. Do not skip this step.`,
        parameters: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
      // Spread into a new object literal to ensure each node gets its own _metadata copy
      // (no reference sharing between different form nodes in the same flow)
      _metadata: {
        nodeId: String(node.id),
        formId: config.formId ? String(config.formId) : undefined,
        fields: fields.length > 0 ? [...fields] : [
          { name: 'fullName', type: 'string', required: true },
          { name: 'email', type: 'string', required: true },
          { name: 'phone', type: 'string', required: true },
        ],
        webhookUrl: config.webhookUrl,
        submitAction: config.submitAction,
        googleSheetId: config.googleSheetId,
        googleSheetName: config.googleSheetName,
      },
    };
  }

  /**
   * Build custom tool from node
   * Includes _metadata for hydration
   */
  private static buildCustomTool(node: FlowNode, config: any): OpenAIFunctionTool & { _metadata?: any } {
    const toolName = config.name || config.toolName || `custom_tool_${node.id.replace(/-/g, '_')}`;
    const description = config.description || node.data?.label || 'Execute custom tool action';
    const params = config.parameters || [];
    
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    
    for (const param of params) {
      properties[param.name] = {
        type: param.type || 'string',
        description: param.description || `Parameter: ${param.name}`,
      };
      if (param.required) {
        required.push(param.name);
      }
    }
    
    return {
      type: 'function',
      function: {
        name: toolName,
        description: `${description}. Call this function when instructed.`,
        parameters: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
      _metadata: {
        nodeId: node.id,
        toolType: config.toolType,
        action: config.action,
        handler: config.handler,
      },
    };
  }

  /**
   * Build webhook tool from node
   * Includes _metadata for hydration with webhook URL, method, and payload template
   */
  private static buildWebhookTool(node: FlowNode, config: any): OpenAIFunctionTool & { _metadata?: any } {
    const toolName = `webhook_${node.id.replace(/-/g, '_')}`;
    
    // Extract parameters from payload keys if not explicitly defined
    const params = config.parameters || [];
    const payload = config.payload || {};
    
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    
    // Add explicit parameters
    for (const param of params) {
      properties[param.name] = {
        type: param.type || 'string',
        description: param.description || `Parameter: ${param.name}`,
      };
      if (param.required) {
        required.push(param.name);
      }
    }
    
    // Extract variables from payload ({{variable}}) as parameters
    const payloadStr = JSON.stringify(payload);
    const variableMatches = payloadStr.match(/\{\{(\w+)\}\}/g) || [];
    const uniqueVars = Array.from(new Set(variableMatches.map(m => m.replace(/[{}]/g, ''))));
    
    for (const varName of uniqueVars) {
      if (!properties[varName]) {
        properties[varName] = {
          type: 'string',
          description: `The ${varName.replace(/_/g, ' ')} to include in the request.`,
        };
      }
    }
    
    const description = config.description || node.data?.label || config.label || 'Execute webhook and process the result';
    
    return {
      type: 'function',
      function: {
        name: toolName,
        description: `${description}. Call this function when instructed by the conversation flow.`,
        parameters: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
      // Store metadata for hydration - this allows hydrateCompiledTools to make actual HTTP calls
      _metadata: {
        webhookUrl: config.url,
        webhookMethod: config.method || 'POST',
        payloadTemplate: Object.keys(payload).length > 0 ? payload : undefined,
      },
    };
  }

  /**
   * Build API call tool from node
   */
  private static buildApiCallTool(node: FlowNode, config: any): OpenAIFunctionTool {
    const toolName = `api_call_${node.id.replace(/-/g, '_')}`;
    const params = config.parameters || [];
    
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    
    for (const param of params) {
      properties[param.name] = {
        type: param.type || 'string',
        description: param.description || `Parameter: ${param.name}`,
      };
      if (param.required) {
        required.push(param.name);
      }
    }
    
    const description = config.description || node.data?.label || config.label || 'Make API call and use the result';
    
    return {
      type: 'function',
      function: {
        name: toolName,
        description: `${description}. Call this function when instructed by the conversation flow.`,
        parameters: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
    };
  }
}
