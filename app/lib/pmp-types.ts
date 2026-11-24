export type DepartmentKey =
  | 'Comunicare'
  | 'Comunitati'
  | 'Tehnic'
  | 'Coordonare Judeteana'
  | 'Board';

export type PriorityKey = 'low' | 'medium' | 'high' | 'urgent';

export const PRIORITY_META: Record<
  PriorityKey,
  { key: PriorityKey; label: string; badgeBg: string; badgeText: string; dot: string }
> = {
  low: {
    key: 'low',
    label: 'Low',
    badgeBg: 'bg-zinc-800',
    badgeText: 'text-zinc-400',
    dot: 'bg-zinc-500',
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    badgeBg: 'bg-sky-500/15',
    badgeText: 'text-sky-300',
    dot: 'bg-sky-400',
  },
  high: {
    key: 'high',
    label: 'High',
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-300',
    dot: 'bg-amber-400',
  },
  urgent: {
    key: 'urgent',
    label: 'Urgent',
    badgeBg: 'bg-rose-500/20',
    badgeText: 'text-rose-300',
    dot: 'bg-rose-500',
  },
};

export const DEPARTMENTS: Record<
  DepartmentKey,
  {
    key: DepartmentKey;
    label: string;
    badgeBg: string;
    badgeText: string;
    border: string;
    barBg: string;
    dotBg: string;
  }
> = {
  Comunicare: {
    key: 'Comunicare',
    label: 'Comunicare',
    badgeBg: 'bg-sky-500/15',
    badgeText: 'text-sky-300',
    border: 'border-sky-500/30',
    barBg: 'bg-sky-500',
    dotBg: 'bg-sky-400',
  },
  Comunitati: {
    key: 'Comunitati',
    label: 'Comunități',
    badgeBg: 'bg-violet-500/15',
    badgeText: 'text-violet-300',
    border: 'border-violet-500/30',
    barBg: 'bg-violet-500',
    dotBg: 'bg-violet-400',
  },
  Tehnic: {
    key: 'Tehnic',
    label: 'Tehnic',
    badgeBg: 'bg-emerald-500/15',
    badgeText: 'text-emerald-300',
    border: 'border-emerald-500/30',
    barBg: 'bg-emerald-500',
    dotBg: 'bg-emerald-400',
  },
  'Coordonare Judeteana': {
    key: 'Coordonare Judeteana',
    label: 'Coordonare Județeană',
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-300',
    border: 'border-amber-500/30',
    barBg: 'bg-amber-500',
    dotBg: 'bg-amber-400',
  },
  Board: {
    key: 'Board',
    label: 'Board / Management',
    badgeBg: 'bg-rose-500/15',
    badgeText: 'text-rose-300',
    border: 'border-rose-500/30',
    barBg: 'bg-rose-500',
    dotBg: 'bg-rose-400',
  },
};

export const HIERARCHICAL_ROLES = [
  'Manager',
  'Lider',
  'Vice-Lider',
  'Monitorizare',
  'Coordonator',
  'Vice-Coordonator',
  'Ambasador',
  'Membru Activ',
] as const;

export function normalizeDepartment(raw?: string | null): DepartmentKey {
  if (!raw) return 'Comunitati';
  const clean = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (clean.includes('comunicare')) return 'Comunicare';
  if (clean.includes('comunitat')) return 'Comunitati';
  if (clean.includes('tehnic')) return 'Tehnic';
  if (clean.includes('judet') || clean.includes('coordonare')) return 'Coordonare Judeteana';
  if (clean.includes('board') || clean.includes('management') || clean.includes('lider')) {
    return 'Board';
  }
  return 'Comunitati';
}

export interface Person {
  id: string;
  full_name: string;
  role: string;
  department: DepartmentKey;
  age: number | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  skills: string[];
  availability: string | null;
  notes: string | null;
}

export interface Project {
  id: string;
  title: string;
  description: string | null;
  department: DepartmentKey;
  owner_id: string | null;
  status: 'active' | 'planned' | 'completed' | 'on_hold';
  progress: number;
  is_core_team: boolean;
  needs_pm_sync?: boolean;
  blocked_by_project_id: string | null;
  start_date: string | null;
  deadline: string | null;
  updated_at: string;
}

export interface TaskItem {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  type: 'task' | 'milestone';
  status: 'todo' | 'in_progress' | 'waiting_review' | 'done';
  priority: PriorityKey;
  estimated_hours: number;
  blocked_by_id: string | null;
  outlook_event_id?: string | null;
  is_milestone_approved: boolean;
  is_my_task: boolean;
  needs_pm_sync?: boolean;
  assignee_id: string | null;
  department: DepartmentKey;
  start_date: string | null;
  deadline: string | null;
  completed_at: string | null;
}

export interface ResourceItem {
  id: string;
  title: string;
  type: string;
  url_or_ref: string | null;
  department: DepartmentKey;
  project_id: string | null;
}

export interface EventItem {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  status: string;
  department: DepartmentKey;
  project_id: string | null;
}

export interface PartnerItem {
  id: string;
  name: string;
  contact_person: string | null;
  contact_info: string | null;
  status: string;
  project_id: string | null;
}

export interface ProjectNote {
  id: string;
  project_id: string;
  content: string;
  is_ai_memory: boolean;
  created_at: string;
}

export interface GeneralNote {
  id: string;
  title: string;
  category: string;
  tags: string[];
  content: string;
  is_ai_memory: boolean;
  created_at: string;
}

export interface PostItNote {
  id: string;
  content: string;
  color: 'amber' | 'emerald' | 'violet' | 'sky';
  is_pinned: boolean;
  created_at: string;
}

export interface AppNotification {
  id: string;
  kind: 'overdue' | 'due_soon' | 'milestone_ready' | 'stale_project';
  title: string;
  detail: string;
  department: DepartmentKey;
}