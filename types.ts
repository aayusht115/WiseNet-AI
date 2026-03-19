
export interface Course {
  id: number;
  name: string;
  code: string;
  progress: number;
  instructor: string;
  created_by?: number;
  credits?: number;
  is_enrolled?: boolean;
  session_preview?: CourseSession[];
  nextDeadline?: string;
  category_id?: number;
  description?: string;
  image_url?: string;
  start_date?: string;
  end_date?: string;
  visibility?: 'show' | 'hide';
}

export interface CourseSection {
  id: number;
  course_id: number;
  title: string;
  order: number;
}

export interface CourseActivity {
  id: number;
  section_id: number;
  course_id: number;
  title: string;
  type: string;
  due_date?: string;
  description?: string;
  content?: string;
}

export interface CourseMaterial {
  id: number;
  course_id: number;
  section_id: number;
  title: string;
  source_type: "pdf" | "link";
  source_url?: string;
  source_file_name?: string;
  content: string;
  summary?: string;
  key_takeaways?: string[];
  section_title?: string;
  quiz_count?: number;
  latest_score?: number;
  latest_total?: number;
  is_assigned?: boolean;
  assigned_at?: string;
  due_at?: string;
}

export interface CourseSession {
  id: number;
  course_id: number;
  session_number: number;
  title: string;
  session_date: string;
  start_time?: string;
  end_time?: string;
  mode?: string;
}

export interface FeedbackQuestion {
  id: number;
  question_order: number;
  question_text: string;
  question_type: "mcq" | "text";
  options?: string[];
  required?: boolean;
}

export interface ActiveFeedbackForm {
  form_id: number;
  due_at: string;
  already_submitted: boolean;
  questions: FeedbackQuestion[];
}

export interface EvaluationComponent {
  sr_no: number;
  component: string;
  code: string;
  weightage_percent: number;
  timeline: string;
  scheduled_date: string;
  clos_mapped: string;
}

export interface CourseDetail {
  faculty_info?: string;
  teaching_assistant?: string;
  credits?: number;
  feedback_trigger_session?: number;
  learning_outcomes?: string[];
  evaluation_components?: EvaluationComponent[];
}

export interface StudyPlanItem {
  day: string;
  topic: string;
  activities: string[];
  estimatedTime: string;
  isWeakTopic?: boolean;
}

export interface SummaryResult {
  title: string;
  summary: string;
  keyTakeaways: string[];
  keyTakeawayLabels?: string[];
  furtherReading: string[];
  soWhat?: string;
  keyConcepts?: { title: string; description: string }[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface PreReadSession {
  id: string;
  title: string;
  date: string;
  estimatedTime: string;
  progress: number;
  status: 'not_started' | 'in_progress' | 'completed';
  items: { id: string; title: string; type: 'pdf' | 'video' | 'article'; content: string; summary?: string; keyTakeaways?: string[] }[];
}

export interface ReflectionPrompt {
  question: string;
  category: 'Critical Thinking' | 'Application' | 'Synthesis';
}

export enum NavigationTab {
  DASHBOARD = 'dashboard',
  PLANNER = 'planner',
  CALENDAR = 'calendar',
  BOOSTER = 'booster',
  LEARN_MODE = 'learn_mode',
  QUIZ = 'quiz',
  REPORTS = 'reports',
  FACULTY_SETUP = 'faculty_setup',
  FACULTY_ANALYTICS = 'faculty_analytics',
  COURSE_MANAGEMENT = 'course_management',
  COURSE_EDITOR = 'course_editor',
  SUMMARIZER = 'summarizer',
  REFLECTIONS = 'reflections',
  LOGIN = 'login'
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface Activity {
  id: number;
  course_id: number;
  title: string;
  type: string;
  due_date: string;
  course_name: string;
  course_code: string;
}

export type UserRole = 'student' | 'faculty';
