export type StudyWindow = {
  id: string;
  label: string;
  start: string; // HH:MM
  end: string;
};

export type Material = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
};

export type Task = {
  id: string;
  text: string;
  done: boolean;
  date: string; // YYYY-MM-DD
  minutesSpent?: number;
};

export type ChatRole = "user" | "xiaochen" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  /** Progress actions applied when this message was processed */
  progressNote?: string;
};

export type AppData = {
  userName: string;
  goals: string;
  studyPlan: string;
  routine: string;
  materials: Material[];
  windows: StudyWindow[];
  tasks: Task[];
  chatHistory: ChatMessage[];
  notificationsEnabled: boolean;
  lastReminderAt?: number;
  onboardingDone: boolean;
};

export const DEFAULT_DATA: AppData = {
  userName: "hui zhang",
  goals: "",
  studyPlan: "",
  routine: "",
  materials: [],
  windows: [
    { id: "w1", label: "上午专注", start: "09:00", end: "11:00" },
    { id: "w2", label: "晚间复习", start: "20:00", end: "22:00" },
  ],
  tasks: [],
  chatHistory: [],
  notificationsEnabled: false,
  onboardingDone: false,
};
