
import { GoogleGenAI, Type } from "@google/genai";
import { StudyPlanItem, SummaryResult, ReflectionPrompt, QuizQuestion } from "../types";

let aiClient: GoogleGenAI | null = null;

const getAiClient = () => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is missing. Set GEMINI_API_KEY to use this feature.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
};

export const geminiService = {
  async generateStudyPlan(courseName: string, topics: string, duration: string): Promise<StudyPlanItem[]> {
    const response = await getAiClient().models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Generate a detailed study plan for the course "${courseName}" covering these topics: ${topics}. The duration is ${duration}. Format as a JSON array of objects with keys: day, topic, activities (array of strings), estimatedTime.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              day: { type: Type.STRING },
              topic: { type: Type.STRING },
              activities: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              },
              estimatedTime: { type: Type.STRING }
            },
            required: ["day", "topic", "activities", "estimatedTime"]
          }
        }
      }
    });

    try {
      return JSON.parse(response.text || '[]');
    } catch (e) {
      console.error("Failed to parse study plan", e);
      return [];
    }
  },

  async getLearnInsights(title: string, content: string, depth: 'quick' | 'standard' | 'deep' = 'standard'): Promise<SummaryResult> {
    const depthInstructions = {
      quick: "Provide a very high-level overview. Keep it concise.",
      standard: "Provide a balanced analysis with key concepts.",
      deep: "Provide a rigorous academic analysis with nuanced details and complex implications."
    };

    const response = await getAiClient().models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analyze this educational content titled "${title}" at a ${depth} level of detail: ${depthInstructions[depth]}\n\nContent:\n${content}\n\nProvide: 1. A 60-second summary (TL;DR). 2. 5 Key Concepts with titles and brief descriptions. 3. A "So What?" section explaining why this matters. 4. 3 further reading suggestions. Return as JSON.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            soWhat: { type: Type.STRING },
            keyConcepts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING }
                }
              }
            },
            furtherReading: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            }
          },
          required: ["title", "summary", "soWhat", "keyConcepts", "furtherReading"]
        }
      }
    });

    try {
      const data = JSON.parse(response.text || '{}');
      return {
        ...data,
        keyTakeaways: data.keyConcepts?.map((c: any) => `${c.title}: ${c.description}`) || []
      };
    } catch (e) {
      console.error("Failed to parse insights", e);
      return { title, summary: '', keyTakeaways: [], furtherReading: [] };
    }
  },

  async chatWithContent(content: string, message: string, history: {role: 'user' | 'model', parts: {text: string}[]}[] = []): Promise<string> {
    // Correctly using generateContent with system instruction and history
    const response = await getAiClient().models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        { role: 'user', parts: [{ text: `Context:\n${content}` }] },
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: "You are an academic assistant. Help the student understand the material based on the provided context."
      }
    });
    return response.text || "I'm sorry, I couldn't process that.";
  },

  async summarizeContent(title: string, content: string): Promise<SummaryResult> {
    try {
      const response = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!response.ok) throw new Error('Summarization failed');
      return await response.json();
    } catch (e) {
      console.error("Failed to parse summary", e);
      return { title, summary: '', keyTakeaways: [], furtherReading: [] };
    }
  },

  async generateReflectionPrompts(topic: string): Promise<ReflectionPrompt[]> {
    const response = await getAiClient().models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Create 3 meta-learning reflection prompts for the topic: "${topic}". Include one prompt for each category: Critical Thinking, Application, and Synthesis. Format as JSON array.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              category: { 
                type: Type.STRING,
                enum: ["Critical Thinking", "Application", "Synthesis"]
              }
            },
            required: ["question", "category"]
          }
        }
      }
    });

    try {
      return JSON.parse(response.text || '[]');
    } catch (e) {
      console.error("Failed to parse reflection prompts", e);
      return [];
    }
  },

  async generateQuiz(content: string): Promise<QuizQuestion[]> {
    const response = await getAiClient().models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Create a 5-question adaptive flash quiz based on this content:\n\n${content}\n\nQuestions should vary in difficulty. Format as JSON array of objects with keys: id, question, options (array of 4), correctAnswer (index 0-3), explanation.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.INTEGER },
              explanation: { type: Type.STRING }
            },
            required: ["id", "question", "options", "correctAnswer", "explanation"]
          }
        }
      }
    });

    try {
      return JSON.parse(response.text || '[]');
    } catch (e) {
      console.error("Failed to parse quiz JSON", e);
      return [];
    }
  }
};
