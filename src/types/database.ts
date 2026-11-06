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

export type QuoteRow = {
  id: string;
  tenant_id: string;
  quote_number: string;
  client_id: string | null;
  client_name: string;
  client_email: string;
  status: QuoteStatus;
  total_amount_excl_vat: number;
  vat_percentage: number;
  total_amount_incl_vat: number;
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
  client_name: string;
  client_email: string;
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

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: TenantRow;
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
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
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "projects_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "time_entries_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "project_photos_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_photos_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_photos_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: QuoteRow;
        Insert: {
          id?: string;
          tenant_id: string;
          quote_number: string;
          client_id?: string | null;
          client_name: string;
          client_email: string;
          status?: QuoteStatus;
          total_amount_excl_vat?: number;
          vat_percentage?: number;
          total_amount_incl_vat?: number;
          valid_until?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          quote_number?: string;
          client_id?: string | null;
          client_name?: string;
          client_email?: string;
          status?: QuoteStatus;
          total_amount_excl_vat?: number;
          vat_percentage?: number;
          total_amount_incl_vat?: number;
          valid_until?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: InvoiceRow;
        Insert: {
          id?: string;
          tenant_id: string;
          invoice_number: string;
          project_id?: string | null;
          quote_id?: string | null;
          client_name: string;
          client_email: string;
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
          client_name?: string;
          client_email?: string;
          status?: InvoiceStatus;
          subtotal?: number;
          vat_amount?: number;
          total_amount?: number;
          due_date?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
