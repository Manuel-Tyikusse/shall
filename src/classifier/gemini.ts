import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

const client = new GoogleGenAI({ apiKey: config.gemini.apiKey });

export async function generateText(systemInstruction: string, prompt: string, maxOutputTokens: number): Promise<string> {
  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: prompt,
    config: { systemInstruction, maxOutputTokens },
  });
  return response.text?.trim() ?? "";
}

export async function generateJson(systemInstruction: string, prompt: string, maxOutputTokens: number): Promise<string> {
  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: prompt,
    config: { systemInstruction, maxOutputTokens, responseMimeType: "application/json" },
  });
  return response.text?.trim() ?? "";
}
