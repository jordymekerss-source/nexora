export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProfileRole = "super_admin" | "employer" | "employee";
export type ProjectStatus = "planning" | "active" | "completed";
export type TimeEntryStatus = "pending" | "approved";
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export type TenantRow = {
  id: string;
  name: string;
  created_at: string;
};

export type ProfileRow = {
  id: string;
  tenant_id: string | null;
  full_name: string;
  role: ProfileRole;
  phone: string | null;
  created_at: string;
};

export type ProjectRow = {
  id: string;
  tenant_id: string;
  title: string;
  client_name: string | null;
  address: string;
  status: ProjectStatus;
  created_at: string;
};

export type TimeEntryRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  project_id: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  notes: string | null;
  status: TimeEntryStatus;
};

export type ProjectPhotoRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  user_id: string;
  photo_url: string;
  caption: string | null;
  created_at: string;
};

export type ClientRow = {
  id: string;
  tenant_id: string;
  company_name: string;
  contact_person: string | null;
  email: string;
  phone: string | null;
  address: string;
  notes: string | null;
  created_at: string;
};

export type QuoteRow = {
  id: string;
  tenant_id: string;
  quote_number: string;
  client_id: string | null;
  client_name: string;
  status: QuoteStatus;
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  valid_until: string | null;
  created_at: string;
};

export type QuoteItemRow = {
  id: string;
  quote_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
};

export type InvoiceRow = {
  id: string;
  tenant_id: string;
  invoice_number: string;
  project_id: string | null;
  quote_id: string | null;
  client_id: string | null;
  client_name: string;
  status: InvoiceStatus;
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  due_date: string;
  created_at: string;
};

export type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
};

export type ProjectScheduleRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  assigned_user_id: string;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  created_at: string;
};

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: TenantRow;
        Insert: { id?: string; name: string; created_at?: string };
        Update: { id?: string; name?: string; created_at?: string };
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          tenant_id?: string | null;
          full_name: string;
          role: ProfileRole;
          phone?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          full_name?: string;
          role?: ProfileRole;
          phone?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      projects: {
        Row: ProjectRow;
        Insert: {
          id?: string;
          tenant_id: string;
          title: string;
          client_name?: string | null;
          address: string;
          status?: ProjectStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          title?: string;
          client_name?: string | null;
          address?: string;
          status?: ProjectStatus;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      time_entries: {
        Row: TimeEntryRow;
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          project_id: string;
          clock_in: string;
          clock_out?: string | null;
          break_minutes?: number;
          notes?: string | null;
          status?: TimeEntryStatus;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          project_id?: string;
          clock_in?: string;
          clock_out?: string | null;
          break_minutes?: number;
          notes?: string | null;
          status?: TimeEntryStatus;
        };
        Relationships: Rel[];
      };
      project_photos: {
        Row: ProjectPhotoRow;
        Insert: {
          id?: string;
          tenant_id: string;
          project_id: string;
          user_id: string;
          photo_url: string;
          caption?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          project_id?: string;
          user_id?: string;
          photo_url?: string;
          caption?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      clients: {
        Row: ClientRow;
        Insert: {
          id?: string;
          tenant_id: string;
          company_name: string;
          contact_person?: string | null;
          email: string;
          phone?: string | null;
          address: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          company_name?: string;
          contact_person?: string | null;
          email?: string;
          phone?: string | null;
          address?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      quotes: {
        Row: QuoteRow;
        Insert: {
          id?: string;
          tenant_id: string;
          quote_number: string;
          client_id?: string | null;
          client_name: string;
          status?: QuoteStatus;
          subtotal?: number;
          vat_amount?: number;
          total_amount?: number;
          valid_until?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          quote_number?: string;
          client_id?: string | null;
          client_name?: string;
          status?: QuoteStatus;
          subtotal?: number;
          vat_amount?: number;
          total_amount?: number;
          valid_until?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      quote_items: {
        Row: QuoteItemRow;
        Insert: {
          id?: string;
          quote_id: string;
          description: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
        };
        Update: {
          id?: string;
          quote_id?: string;
          description?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
        };
        Relationships: Rel[];
      };
      invoices: {
        Row: InvoiceRow;
        Insert: {
          id?: string;
          tenant_id: string;
          invoice_number: string;
          project_id?: string | null;
          quote_id?: string | null;
          client_id?: string | null;
          client_name: string;
          status?: InvoiceStatus;
          subtotal?: number;
          vat_amount?: number;
          total_amount?: number;
          due_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          invoice_number?: string;
          project_id?: string | null;
          quote_id?: string | null;
          client_id?: string | null;
          client_name?: string;
          status?: InvoiceStatus;
          subtotal?: number;
          vat_amount?: number;
          total_amount?: number;
          due_date?: string;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      invoice_items: {
        Row: InvoiceItemRow;
        Insert: {
          id?: string;
          invoice_id: string;
          description: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          description?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
        };
        Relationships: Rel[];
      };
      project_schedules: {
        Row: ProjectScheduleRow;
        Insert: {
          id?: string;
          tenant_id: string;
          project_id: string;
          assigned_user_id: string;
          scheduled_date: string;
          start_time?: string | null;
          end_time?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          project_id?: string;
          assigned_user_id?: string;
          scheduled_date?: string;
          start_time?: string | null;
          end_time?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
