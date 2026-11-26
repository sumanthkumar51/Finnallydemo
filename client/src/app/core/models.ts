export type Role = 'admin' | 'manager' | 'employee';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  department: string;
  title: string;
  phone: string;
  salary: number | null;
  status: 'active' | 'inactive';
  manager_id: number | null;
  office_id: number | null;
  hire_date: string;
  created_at?: string;
}

export interface EmployeeRow extends User {
  manager_name: string | null;
  office_name: string | null;
  last_login: string | null;
}

export interface Paged<T> { total: number; page: number; limit: number; rows: T[]; }

export interface Transaction {
  id: number;
  user_id: number;
  employee_name: string;
  department: string;
  type: string;
  category: string;
  amount: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  date: string;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface LoginEvent {
  id: number;
  user_id: number | null;
  email: string;
  name: string | null;
  department: string | null;
  success: number;
  reason: string | null;
  ip: string;
  user_agent: string;
  created_at: string;
  logout_at: string | null;
  session_minutes: number | null;
}

export interface ActivityRow {
  id: number;
  user_id: number;
  name: string;
  action: string;
  entity: string | null;
  entity_id: number | null;
  details: string | null;
  ip: string;
  created_at: string;
}

export interface Office {
  id: number; name: string; city: string; country: string; address: string; lat: number; lng: number; headcount: number;
}

export interface Meta {
  roles: Role[];
  txTypes: string[];
  txStatuses: string[];
  departments: string[];
  categories: string[];
  offices: { id: number; name: string; city: string; country: string }[];
}

export interface PublicConfig {
  gaMeasurementId: string;
  gtmContainerId: string;
  clarityProjectId: string;
  pendoApiKey: string;
  googleMapsApiKey: string;
}
