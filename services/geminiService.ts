
import { StudyPlanItem, SummaryResult, ReflectionPrompt, QuizQuestion } from "../types";

export const geminiService = {
  async generateStudyPlan(courseName: string, topics: string, duration: string): Promise<StudyPlanItem[]> {
    try {
      const response = await fetch('/api/ai/study-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: courseName, topics, duration }),
      });
      if (!response.ok) throw new Error('Study plan generation failed');
      return await response.json();
    } catch (e) {
      console.error("Failed to generate study plan", e);
      return [];
    }
  },

  async getLearnInsights(title: string, content: string, _depth: 'quick' | 'standard' | 'deep' = 'standard'): Promise<SummaryResult> {
    try {
      const response = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!response.ok) throw new Error('Insights fetch failed');
      const data = await response.json();
      return {
        ...data,
        soWhat: `Understanding "${title}" is essential for applying these concepts in real-world scenarios and building a strong academic foundation.`,
        keyConcepts: (data.keyTakeaways || []).slice(0, 5).map((t: string) => ({
          title: t.split(':')[0]?.trim().slice(0, 60) || t.slice(0, 60),
          description: t.includes(':') ? t.split(':').slice(1).join(':').trim() : t,
        })),
      };
    } catch (e) {
      console.error("Failed to get insights", e);
      return { title, summary: '', keyTakeaways: [], furtherReading: [] };
    }
  },

  async chatWithContent(_content: string, _message: string, _history: {role: 'user' | 'model', parts: {text: string}[]}[] = []): Promise<string> {
    return "The AI assistant isn't available right now. You can still review the insights on the right panel.";
  },

  async summarizeContent(title: string, content: string, detailLevel: 'Brief' | 'Standard' | 'Detailed' = 'Standard', focusPrompt: string = ''): Promise<SummaryResult> {
    try {
      const response = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, detailLevel, focusPrompt }),
      });
      if (!response.ok) throw new Error('Summarization failed');
      return await response.json();
    } catch (e) {
      console.error("Failed to summarize", e);
      return { title, summary: '', keyTakeaways: [], furtherReading: [] };
    }
  },

  async generateReflectionPrompts(topic: string): Promise<ReflectionPrompt[]> {
    try {
      const response = await fetch('/api/ai/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      if (!response.ok) throw new Error('Reflection prompts generation failed');
      return await response.json();
    } catch (e) {
      console.error("Failed to generate reflection prompts", e);
      return [];
    }
  },

  async generateQuiz(content: string): Promise<QuizQuestion[]> {
    try {
      const response = await fetch('/api/ai/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error('Quiz generation failed');
      return await response.json();
    } catch (e) {
      console.error("Failed to generate quiz", e);
      return [];
    }
  },
};
