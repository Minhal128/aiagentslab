'use strict';
import { storage } from '../storage';
import type { ContentViolation } from '@shared/schema';

export interface DetectedViolation {
  word: string;
  severity: string;
  context: string;
  position: number;
  autoBlock: boolean;
}

export async function detectViolations(
  callId: string,
  userId: string,
  transcript: string
): Promise<ContentViolation[]> {
  const bannedWords = await storage.getActiveBannedWords();
  
  if (bannedWords.length === 0) {
    return [];
  }
  
  const violations: ContentViolation[] = [];
  const transcriptLower = transcript.toLowerCase();
  
  for (const bannedWord of bannedWords) {
    const wordLower = bannedWord.word.toLowerCase();
    let position = transcriptLower.indexOf(wordLower);
    
    while (position !== -1) {
      const contextStart = Math.max(0, position - 50);
      const contextEnd = Math.min(transcript.length, position + wordLower.length + 50);
      const context = transcript.substring(contextStart, contextEnd);
      
      const violation = await storage.createContentViolation({
        callId,
        userId,
        bannedWordId: bannedWord.id,
        detectedWord: bannedWord.word,
        severity: bannedWord.severity,
        context: context,
        status: 'pending',
      });
      
      violations.push(violation);
      
      if (bannedWord.autoBlock) {
        const user = await storage.getUserById(userId);
        if (user && user.role !== 'admin' && user.isActive) {
          await storage.updateUser(userId, {
            isActive: false,
            blockedReason: `Auto-blocked: Content violation detected (${bannedWord.category}: "${bannedWord.word}")`,
            blockedAt: new Date(),
            blockedBy: 'system',
          });
          console.log(`⚠️ [ViolationDetection] Auto-blocked user ${userId} for violation: ${bannedWord.word}`);
        }
      }
      
      position = transcriptLower.indexOf(wordLower, position + 1);
    }
  }
  
  if (violations.length > 0) {
    console.log(`🔍 [ViolationDetection] Found ${violations.length} violation(s) in call ${callId}`);
  }
  
  return violations;
}

export async function scanCallForViolations(callId: string): Promise<ContentViolation[]> {
  const call = await storage.getAdminCallById(callId);
  
  if (!call || !call.transcript || !call.userId) {
    return [];
  }
  
  return detectViolations(callId, call.userId, call.transcript);
}
