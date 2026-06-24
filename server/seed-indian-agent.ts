/**
 * Seed script: Create Indian English + Hindi bilingual agent (OpenAI + Plivo)
 *
 * Run: npx tsx server/seed-indian-agent.ts
 */
import "dotenv/config";
import { db } from "./db";
import { agents, users } from "@shared/schema";
import { desc } from "drizzle-orm";

const SYSTEM_PROMPT = `ACCENT & LANGUAGE:
You speak with a natural Indian English accent. Your pronunciation, rhythm, and intonation follow standard Indian English patterns. Keep this accent consistent throughout the call.

BILINGUAL CAPABILITY:
Listen carefully to the language the caller uses. If the caller speaks Hindi, respond in Hindi. If they speak English, respond in English. You may seamlessly switch between Hindi and English (Hinglish) if the caller does so. Never force a language on the caller.

ROLE:
You are a professional, friendly AI voice assistant. Your goal is to help the caller efficiently and warmly — whether they communicate in English or Hindi.

KEY BEHAVIOURS:
- Greet in Indian English: "Namaste! How may I assist you today?"
- Switch to Hindi naturally if the caller speaks Hindi
- Stay concise and clear — this is a phone call
- Be polite, patient, and professional at all times
- If you don't understand, ask the caller to repeat in a friendly way`;

async function seedIndianAgent() {
  const [firstUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(1);

  if (!firstUser) {
    console.error("❌ No users found in the database. Please create a user account first.");
    process.exit(1);
  }

  console.log(`👤 Creating agent for user: ${firstUser.email} (${firstUser.id})`);

  const [agent] = await db
    .insert(agents)
    .values({
      userId: firstUser.id,
      type: "incoming",
      name: "Indian Voice Agent (EN + HI)",
      telephonyProvider: "plivo",
      openaiVoice: "coral",
      language: "en",
      systemPrompt: SYSTEM_PROMPT,
      firstMessage: "Namaste! How may I assist you today?",
      voiceTone: "professional",
      personality: "helpful",
      temperature: 0.7,
      detectLanguageEnabled: true,
      endConversationEnabled: true,
      isActive: true,
    })
    .returning();

  console.log(`✅ Agent created successfully!`);
  console.log(`   Name    : ${agent.name}`);
  console.log(`   ID      : ${agent.id}`);
  console.log(`   Provider: ${agent.telephonyProvider}`);
  console.log(`   Voice   : ${agent.openaiVoice} (female, clear & friendly)`);
  console.log(`   Language: English + Hindi (auto-detect enabled)`);

  process.exit(0);
}

seedIndianAgent().catch((err) => {
  console.error("❌ Failed to create agent:", err.message);
  process.exit(1);
});
