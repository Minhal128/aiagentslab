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
 * Play Audio ElevenLabs Tool Configuration
 * 
 * Configures the play_audio webhook tool for ElevenLabs agents.
 * When a Flow Agent needs to play audio during a call, ElevenLabs calls
 * our webhook with the audio details, which triggers audio playback.
 * 
 * Tool Type: "webhook" (server-side) - ElevenLabs calls our endpoint directly
 */

import { getDomain } from '../utils/domain';

export interface PlayAudioNodeInfo {
  nodeId: string;
  audioUrl: string;
  audioFileName: string;
  interruptible: boolean;
  waitForComplete: boolean;
}

export interface PlayAudioWebhookToolConfig {
  type: "webhook";
  name: string;
  description: string;
  api_schema: {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    request_body_schema: Record<string, any>;
  };
}

/**
 * Build ElevenLabs webhook tool for play_audio node
 * Called after agent is created so we have the agentId for the webhook URL
 * 
 * @param nodeId - The flow node ID for unique tool naming
 * @param audioUrl - The URL of the audio file to play
 * @param audioFileName - The display name of the audio file
 * @param interruptible - Whether the audio can be interrupted
 * @param waitForComplete - Whether to wait for audio to complete
 * @param elevenLabsAgentId - The ElevenLabs agent ID for the webhook URL
 */
export function getPlayAudioWebhookTool(
  nodeId: string,
  audioUrl: string,
  audioFileName: string,
  interruptible: boolean,
  waitForComplete: boolean,
  elevenLabsAgentId: string
): PlayAudioWebhookToolConfig {
  const domain = getDomain();
  const webhookUrl = `${domain}/api/elevenlabs/tools/play-audio/${elevenLabsAgentId}`;
  
  const toolName = `play_audio_${nodeId.slice(-8)}`;
  
  console.log(`🔊 [PlayAudio Tool] Creating webhook tool for agent ${elevenLabsAgentId}`);
  console.log(`   Tool name: ${toolName}`);
  console.log(`   Audio URL: ${audioUrl}`);
  console.log(`   Webhook URL: ${webhookUrl}`);
  
  return {
    type: "webhook",
    name: toolName,
    description: `Play the audio file "${audioFileName}". Call this tool to play the audio during the conversation.`,
    api_schema: {
      url: webhookUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      request_body_schema: {
        type: "object",
        properties: {
          audioUrl: {
            type: "string",
            description: "The URL of the audio file to play",
            const: audioUrl
          },
          interruptible: {
            type: "boolean",
            description: "Whether the audio can be interrupted",
            const: interruptible
          },
          waitForComplete: {
            type: "boolean",
            description: "Whether to wait for audio to complete",
            const: waitForComplete
          }
        },
        required: ["audioUrl"]
      }
    }
  };
}
