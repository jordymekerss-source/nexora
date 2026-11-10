export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProfileRole = "super_admin" | "employer" | "employee" | "accountant";
export type ProjectStatus = "planning" | "active" | "completed";
export type TimeEntryStatus = "pending" | "approved";
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export type TenantRow = {
  id: string;
  name: string;
  created_at: string;
  storage_quota_bytes: number | null;
  subscription_tier: "basic" | "professional" | "enterprise" | "custom";
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

export type ProjectAssignmentRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  user_id: string;
  assigned_at: string;
};

export type VehicleRow = {
  id: string;
  tenant_id: string;
  license_plate: string;
  brand_model: string;
  apk_expiry_date: string | null;
  km_status: number;
  assigned_user_id: string | null;
  created_at: string;
};

export type ToolStatus = "active" | "maintenance" | "broken";

export type ToolRow = {
  id: string;
  tenant_id: string;
  name: string;
  serial_number: string | null;
  status: ToolStatus;
  checked_out_to_user_id: string | null;
  created_at: string;
};

export type EmployeeCertificateRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  certificate_name: string;
  expiry_date: string;
  document_url: string | null;
  created_at: string;
};

export type WorkOrderRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  client_signature_url: string | null;
  work_summary: string;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
};

export type AuditEventRow = {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type BreakEntryRow = {
  id: string;
  tenant_id: string;
  time_entry_id: string;
  user_id: string;
  break_start: string;
  break_end: string | null;
  notes: string | null;
  created_at: string;
};

export type TimeEntryCorrectionRow = {
  id: string;
  tenant_id: string;
  time_entry_id: string;
  corrected_by: string;
  reason: string;
  old_clock_in: string;
  old_clock_out: string | null;
  old_break_minutes: number;
  new_clock_in: string;
  new_clock_out: string | null;
  new_break_minutes: number;
  created_at: string;
};

export type ModuleConfigRow = {
  id: string;
  tenant_id: string;
  module_key: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  updated_at: string;
};

export type TenantInviteRow = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  invited_by: string;
  consumed_at: string | null;
  created_at: string;
};

export type FeatureEntitlementRow = {
  id: string;
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  trial_ends_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentCategory =
  | "photo"
  | "document"
  | "spreadsheet"
  | "video"
  | "audio"
  | "zip"
  | "other";

export type DocumentRow = {
  id: string;
  tenant_id: string;
  module_key: string;
  category: DocumentCategory;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  current_version_id: string | null;
  byte_size: number;
  content_type: string | null;
  soft_deleted_at: string | null;
  purge_after: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentVersionRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  version_number: number;
  storage_bucket: string;
  storage_path: string;
  content_type: string;
  byte_size: number;
  sha256: string | null;
  original_filename: string;
  uploaded_by: string | null;
  created_at: string;
};

export type UploadSessionRow = {
  id: string;
  tenant_id: string;
  document_id: string | null;
  module_key: string;
  category: DocumentCategory;
  declared_content_type: string;
  declared_byte_size: number;
  original_filename: string;
  status: "pending" | "uploaded" | "verified" | "rejected" | "expired";
  storage_path: string | null;
  created_by: string;
  expires_at: string;
  completed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export type StorageUsageRow = {
  tenant_id: string;
  used_bytes: number;
  photo_bytes: number;
  document_bytes: number;
  spreadsheet_bytes: number;
  video_bytes: number;
  audio_bytes: number;
  zip_bytes: number;
  other_bytes: number;
  updated_at: string;
};

export type AccountantAccessGrantRow = {
  id: string;
  client_tenant_id: string;
  accountant_user_id: string;
  invited_by: string;
  scopes: string[];
  period_from: string | null;
  period_to: string | null;
  status: "pending" | "active" | "revoked" | "expired";
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountingPeriodStatus =
  | "in_progress"
  | "awaiting_missing_info"
  | "ready_for_review"
  | "approved_by_owner"
  | "handed_over"
  | "in_review_by_accountant"
  | "returned_for_correction"
  | "processed_by_accountant";

export type AccountingPeriodRow = {
  id: string;
  tenant_id: string;
  label: string;
  period_type: "month" | "quarter" | "year" | "custom";
  starts_on: string;
  ends_on: string;
  status: AccountingPeriodStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountingPeriodPackRow = {
  id: string;
  tenant_id: string;
  period_id: string;
  version_number: number;
  status: "draft" | "sealed" | "handed_over" | "superseded";
  manifest: Json;
  checklist: Json;
  export_document_id: string | null;
  sealed_at: string | null;
  handed_over_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type DomainOutboxRow = {
  id: string;
  tenant_id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Json;
  idempotency_key: string;
  status: "pending" | "processing" | "processed" | "failed" | "dead";
  attempts: number;
  available_at: string;
  processed_at: string | null;
  last_error: string | null;
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
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          storage_quota_bytes?: number | null;
          subscription_tier?: TenantRow["subscription_tier"];
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
          storage_quota_bytes?: number | null;
          subscription_tier?: TenantRow["subscription_tier"];
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
      project_assignments: {
        Row: ProjectAssignmentRow;
        Insert: {
          id?: string;
          tenant_id: string;
          project_id: string;
          user_id: string;
          assigned_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          project_id?: string;
          user_id?: string;
          assigned_at?: string;
        };
        Relationships: Rel[];
      };
      vehicles: {
        Row: VehicleRow;
        Insert: {
          id?: string;
          tenant_id: string;
          license_plate: string;
          brand_model: string;
          apk_expiry_date?: string | null;
          km_status?: number;
          assigned_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          license_plate?: string;
          brand_model?: string;
          apk_expiry_date?: string | null;
          km_status?: number;
          assigned_user_id?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      tools: {
        Row: ToolRow;
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          serial_number?: string | null;
          status?: ToolStatus;
          checked_out_to_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          serial_number?: string | null;
          status?: ToolStatus;
          checked_out_to_user_id?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      employee_certificates: {
        Row: EmployeeCertificateRow;
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          certificate_name: string;
          expiry_date: string;
          document_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          certificate_name?: string;
          expiry_date?: string;
          document_url?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      work_orders: {
        Row: WorkOrderRow;
        Insert: {
          id?: string;
          tenant_id: string;
          project_id: string;
          client_signature_url?: string | null;
          work_summary?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          project_id?: string;
          client_signature_url?: string | null;
          work_summary?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: Rel[];
      };
      audit_events: {
        Row: AuditEventRow;
        Insert: {
          id?: string;
          tenant_id?: string | null;
          actor_user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          actor_user_id?: string | null;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      break_entries: {
        Row: BreakEntryRow;
        Insert: {
          id?: string;
          tenant_id: string;
          time_entry_id: string;
          user_id: string;
          break_start: string;
          break_end?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          time_entry_id?: string;
          user_id?: string;
          break_start?: string;
          break_end?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      time_entry_corrections: {
        Row: TimeEntryCorrectionRow;
        Insert: {
          id?: string;
          tenant_id: string;
          time_entry_id: string;
          corrected_by: string;
          reason: string;
          old_clock_in: string;
          old_clock_out?: string | null;
          old_break_minutes: number;
          new_clock_in: string;
          new_clock_out?: string | null;
          new_break_minutes: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          time_entry_id?: string;
          corrected_by?: string;
          reason?: string;
          old_clock_in?: string;
          old_clock_out?: string | null;
          old_break_minutes?: number;
          new_clock_in?: string;
          new_clock_out?: string | null;
          new_break_minutes?: number;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      module_configs: {
        Row: ModuleConfigRow;
        Insert: {
          id?: string;
          tenant_id: string;
          module_key: string;
          enabled?: boolean;
          settings?: Record<string, unknown>;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          module_key?: string;
          enabled?: boolean;
          settings?: Record<string, unknown>;
          updated_at?: string;
        };
        Relationships: Rel[];
      };
      tenant_invites: {
        Row: TenantInviteRow;
        Insert: {
          id?: string;
          tenant_id: string;
          email: string;
          full_name: string;
          invited_by: string;
          consumed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          full_name?: string;
          invited_by?: string;
          consumed_at?: string | null;
          created_at?: string;
        };
        Relationships: Rel[];
      };
      feature_entitlements: {
        Row: FeatureEntitlementRow;
        Insert: {
          id?: string;
          tenant_id: string;
          feature_key: string;
          enabled?: boolean;
          trial_ends_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          feature_key?: string;
          enabled?: boolean;
          trial_ends_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: Rel[];
      };
      documents: {
        Row: DocumentRow;
        Insert: {
          id?: string;
          tenant_id: string;
          module_key: string;
          category: DocumentCategory;
          title: string;
          description?: string | null;
          entity_type?: string | null;
          entity_id?: string | null;
          current_version_id?: string | null;
          byte_size?: number;
          content_type?: string | null;
          soft_deleted_at?: string | null;
          purge_after?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<DocumentRow>;
        Relationships: Rel[];
      };
      document_versions: {
        Row: DocumentVersionRow;
        Insert: {
          id?: string;
          tenant_id: string;
          document_id: string;
          version_number: number;
          storage_bucket?: string;
          storage_path: string;
          content_type: string;
          byte_size: number;
          sha256?: string | null;
          original_filename: string;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: Partial<DocumentVersionRow>;
        Relationships: Rel[];
      };
      upload_sessions: {
        Row: UploadSessionRow;
        Insert: {
          id?: string;
          tenant_id: string;
          document_id?: string | null;
          module_key: string;
          category: DocumentCategory;
          declared_content_type: string;
          declared_byte_size: number;
          original_filename: string;
          status?: UploadSessionRow["status"];
          storage_path?: string | null;
          created_by: string;
          expires_at: string;
          completed_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
        };
        Update: Partial<UploadSessionRow>;
        Relationships: Rel[];
      };
      storage_usage: {
        Row: StorageUsageRow;
        Insert: {
          tenant_id: string;
          used_bytes?: number;
          photo_bytes?: number;
          document_bytes?: number;
          spreadsheet_bytes?: number;
          video_bytes?: number;
          audio_bytes?: number;
          zip_bytes?: number;
          other_bytes?: number;
          updated_at?: string;
        };
        Update: Partial<StorageUsageRow>;
        Relationships: Rel[];
      };
      accountant_access_grants: {
        Row: AccountantAccessGrantRow;
        Insert: {
          id?: string;
          client_tenant_id: string;
          accountant_user_id: string;
          invited_by: string;
          scopes?: string[];
          period_from?: string | null;
          period_to?: string | null;
          status?: AccountantAccessGrantRow["status"];
          accepted_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<AccountantAccessGrantRow>;
        Relationships: Rel[];
      };
      accounting_periods: {
        Row: AccountingPeriodRow;
        Insert: {
          id?: string;
          tenant_id: string;
          label: string;
          period_type: AccountingPeriodRow["period_type"];
          starts_on: string;
          ends_on: string;
          status?: AccountingPeriodStatus;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<AccountingPeriodRow>;
        Relationships: Rel[];
      };
      accounting_period_packs: {
        Row: AccountingPeriodPackRow;
        Insert: {
          id?: string;
          tenant_id: string;
          period_id: string;
          version_number: number;
          status?: AccountingPeriodPackRow["status"];
          manifest?: Json;
          checklist?: Json;
          export_document_id?: string | null;
          sealed_at?: string | null;
          handed_over_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<AccountingPeriodPackRow>;
        Relationships: Rel[];
      };
      domain_outbox: {
        Row: DomainOutboxRow;
        Insert: {
          id?: string;
          tenant_id: string;
          event_type: string;
          event_version?: number;
          aggregate_type: string;
          aggregate_id?: string | null;
          payload?: Json;
          idempotency_key: string;
          status?: DomainOutboxRow["status"];
          attempts?: number;
          available_at?: string;
          processed_at?: string | null;
          last_error?: string | null;
          created_at?: string;
        };
        Update: Partial<DomainOutboxRow>;
        Relationships: Rel[];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      next_document_number: {
        Args: { p_tenant_id: string; p_prefix: string; p_year?: number };
        Returns: string;
      };
      create_quote_with_items: {
        Args: {
          p_client_id: string;
          p_status: string;
          p_valid_until: string | null;
          p_items: Json;
        };
        Returns: string;
      };
      convert_quote_to_project_invoice: {
        Args: { p_quote_id: string };
        Returns: Array<{ project_id: string; invoice_id: string }>;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
