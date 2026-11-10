"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEmployerSession } from "@/lib/auth/require-user";
import { nextInvoiceNumber, nextQuoteNumber } from "@/lib/billing-numbers";
import { assertModuleEnabled } from "@/lib/entitlements/check";
import { isDemoMode } from "@/lib/demo/mode";
import {
  getDemoClientHistory,
  readDemoStore,
  seedDemoStoreIfEmpty,
  updateDemoStore,
  type ClientHistory,
} from "@/lib/demo/store";
import { computeVatTotals, lineTotal, parseMoneyInput, roundMoney } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeWorkedMinutes } from "@/lib/time-entry";
import { isNonEmptyString, isUuid } from "@/lib/validation";
import type {
  ClientRow,
  InvoiceItemRow,
  InvoiceRow,
  InvoiceStatus,
  ProfileRow,
  ProjectRow,
  ProjectScheduleRow,
  QuoteItemRow,
  QuoteRow,
  QuoteStatus,
  TimeEntryRow,
} from "@/types/database";

export type QuoteLineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type CreateClientInput = {
  companyName: string;
  contactPerson?: string | null;
  email: string;
  phone?: string | null;
  address: string;
  notes?: string | null;
};

export type CreateQuoteWithItemsInput = {
  clientId: string;
  validUntil?: string | null;
  status?: Extract<QuoteStatus, "draft" | "sent">;
  items: QuoteLineInput[];
};

function revalidateCrmPaths(extra: readonly string[] = []): void {
  const paths = [
    "/employer/clients",
    "/employer/quotes",
    "/employer/invoices",
    "/employer/planning",
    "/dashboard",
    "/dashboard/projects",
    ...extra,
  ];
  for (const path of paths) {
    revalidatePath(path);
  }
}

function isNextRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function seedDemoData(force = false): Promise<{ seeded: boolean; mode: "demo" | "live" }> {
  await requireEmployerSession();

  if (isDemoMode()) {
    const result = await seedDemoStoreIfEmpty(force);
    revalidateCrmPaths();
    return { seeded: result.seeded, mode: "demo" };
  }

  // Live mode: create a minimal sample set via the employer session when empty.
  const { tenantId } = await requireEmployerSession();
  const supabase = createSupabaseServerClient();
  const { count } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (!force && (count ?? 0) > 0) {
    return { seeded: false, mode: "live" };
  }

  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      tenant_id: tenantId,
      company_name: "Demo Klant BV",
      contact_person: "Demo Contact",
      email: "demo.klant@example.com",
      phone: "+31 20 000 0000",
      address: "Demoweg 1, 1000 AA Amsterdam",
      notes: "Automatisch gegenereerde demoklant",
    })
    .select("*")
    .single();

  if (error !== null || client === null) {
    throw new Error(error?.message ?? "Could not seed live client.");
  }

  await createQuoteWithItems({
    clientId: client.id,
    status: "sent",
    items: [
      { description: "Installatiepakket demo", quantity: 1, unitPrice: 1250 },
      { description: "Arbeidsuren", quantity: 8, unitPrice: 75 },
    ],
  });

  revalidateCrmPaths();
  return { seeded: true, mode: "live" };
}

export async function seedDemoDataFormAction(formData: FormData): Promise<void> {
  const force = formData.get("force") === "1";
  try {
    await seedDemoData(force);
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    redirect("/employer/clients?error=seed");
  }
  redirect("/employer/clients?seeded=1");
}

export async function createClient(input: CreateClientInput): Promise<{ clientId: string }> {
  const { tenantId } = await requireEmployerSession();
  await assertModuleEnabled(tenantId, "crm");

  if (!isNonEmptyString(input.companyName) || !isNonEmptyString(input.email) || !isNonEmptyString(input.address)) {
    throw new Error("Company name, email and address are required.");
  }

  if (isDemoMode()) {
    const id = randomUUID();
    await updateDemoStore((store) => {
      store.clients.unshift({
        id,
        tenant_id: tenantId,
        company_name: input.companyName.trim(),
        contact_person: input.contactPerson?.trim() || null,
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
        address: input.address.trim(),
        notes: input.notes?.trim() || null,
        created_at: new Date().toISOString(),
      });
    });
    revalidateCrmPaths();
    return { clientId: id };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      tenant_id: tenantId,
      company_name: input.companyName.trim(),
      contact_person: input.contactPerson?.trim() || null,
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      address: input.address.trim(),
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();

  if (error !== null || data === null) {
    throw new Error(error?.message ?? "Failed to create client.");
  }

  revalidateCrmPaths();
  return { clientId: data.id };
}

export async function getClients(): Promise<ClientRow[]> {
  const { tenantId } = await requireEmployerSession();

  if (isDemoMode()) {
    const store = await readDemoStore();
    if (store.clients.length === 0) {
      await seedDemoStoreIfEmpty(false);
      return (await readDemoStore()).clients;
    }
    return store.clients;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("company_name", { ascending: true });

  if (error !== null) {
    throw new Error(error.message);
  }

  return (data ?? []) as ClientRow[];
}

export async function getClientHistory(clientId: string): Promise<ClientHistory | null> {
  await requireEmployerSession();
  if (!isUuid(clientId)) {
    return null;
  }

  if (isDemoMode()) {
    return getDemoClientHistory(clientId);
  }

  const supabase = createSupabaseServerClient();
  const { data: client } = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (client === null) {
    return null;
  }
  const typed = client as ClientRow;
  const [{ data: quotes }, { data: invoices }, { data: projects }] = await Promise.all([
    supabase.from("quotes").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("invoices").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase
      .from("projects")
      .select("*")
      .eq("client_name", typed.company_name)
      .order("created_at", { ascending: false }),
  ]);

  return {
    client: typed,
    quotes: (quotes ?? []) as QuoteRow[],
    invoices: (invoices ?? []) as InvoiceRow[],
    projects: (projects ?? []) as ProjectRow[],
  };
}

export async function createQuoteWithItems(
  input: CreateQuoteWithItemsInput,
): Promise<{ quoteId: string }> {
  const { tenantId } = await requireEmployerSession();
  await assertModuleEnabled(tenantId, "billing");

  if (!isUuid(input.clientId) || !Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Client and at least one line item are required.");
  }

  const normalized = input.items.map((item, index) => {
    if (!isNonEmptyString(item.description)) {
      throw new Error(`Line ${index + 1} needs a description.`);
    }
    const quantity = parseMoneyInput(item.quantity);
    const unitPrice = parseMoneyInput(item.unitPrice);
    if (quantity === null || quantity <= 0 || unitPrice === null || unitPrice < 0) {
      throw new Error(`Line ${index + 1} has invalid amounts.`);
    }
    return {
      description: item.description.trim(),
      quantity,
      unit_price: unitPrice,
      total_price: lineTotal(quantity, unitPrice),
    };
  });

  const excl = roundMoney(normalized.reduce((sum, item) => sum + item.total_price, 0));
  const totals = computeVatTotals({ exclVat: excl, vatPercentage: 21 });
  const status: Extract<QuoteStatus, "draft" | "sent"> = input.status === "sent" ? "sent" : "draft";

  if (isDemoMode()) {
    let quoteId = "";
    await updateDemoStore((store) => {
      const client = store.clients.find((row) => row.id === input.clientId);
      if (client === undefined) {
        throw new Error("Client not found.");
      }
      quoteId = randomUUID();
      const quoteNumber = nextQuoteNumber(store.quotes.map((row) => row.quote_number));
      store.quotes.unshift({
        id: quoteId,
        tenant_id: tenantId,
        quote_number: quoteNumber,
        client_id: client.id,
        client_name: client.company_name,
        status,
        subtotal: totals.exclVat,
        vat_amount: totals.vatAmount,
        total_amount: totals.inclVat,
        valid_until: input.validUntil?.trim() || null,
        created_at: new Date().toISOString(),
      });
      for (const item of normalized) {
        store.quoteItems.push({
          id: randomUUID(),
          quote_id: quoteId,
          ...item,
        });
      }
    });
    revalidateCrmPaths();
    return { quoteId };
  }

  const supabase = createSupabaseServerClient();
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", input.clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (clientError !== null || client === null) {
    throw new Error(clientError?.message ?? "Client not found.");
  }

  const typedClient = client as ClientRow;
  const { data: quoteId, error: rpcError } = await supabase.rpc("create_quote_with_items", {
    p_client_id: typedClient.id,
    p_status: status,
    p_valid_until: input.validUntil?.trim() || null,
    p_items: normalized.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
    })),
  });

  if (rpcError !== null || quoteId === null || typeof quoteId !== "string") {
    throw new Error(rpcError?.message ?? "Failed to create quote atomically.");
  }

  revalidateCrmPaths();
  return { quoteId };
}

export async function convertQuoteToProjectAndInvoice(
  quoteId: string,
): Promise<{ projectId: string; invoiceId: string }> {
  const { tenantId } = await requireEmployerSession();
  if (!isUuid(quoteId)) {
    throw new Error("Invalid quote id.");
  }

  if (isDemoMode()) {
    let projectId = "";
    let invoiceId = "";
    await updateDemoStore((store) => {
      const quote = store.quotes.find((row) => row.id === quoteId);
      if (quote === undefined) {
        throw new Error("Quote not found.");
      }
      const items = store.quoteItems.filter((row) => row.quote_id === quoteId);
      quote.status = "accepted";

      projectId = randomUUID();
      store.projects.unshift({
        id: projectId,
        tenant_id: tenantId,
        title: `${quote.quote_number} — ${quote.client_name}`,
        client_name: quote.client_name,
        address: `Offerte ${quote.quote_number}`,
        status: "active",
        created_at: new Date().toISOString(),
      });

      invoiceId = randomUUID();
      const invoiceNumber = nextInvoiceNumber(store.invoices.map((row) => row.invoice_number));
      const due = new Date();
      due.setDate(due.getDate() + 30);
      store.invoices.unshift({
        id: invoiceId,
        tenant_id: tenantId,
        invoice_number: invoiceNumber,
        project_id: projectId,
        quote_id: quote.id,
        client_id: quote.client_id,
        client_name: quote.client_name,
        status: "draft",
        subtotal: quote.subtotal,
        vat_amount: quote.vat_amount,
        total_amount: quote.total_amount,
        due_date: due.toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
      });
      for (const item of items) {
        store.invoiceItems.push({
          id: randomUUID(),
          invoice_id: invoiceId,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
        });
      }
    });
    revalidateCrmPaths([`/employer/invoices/${invoiceId}`, `/dashboard/projects/${projectId}`]);
    return { projectId, invoiceId };
  }

  const supabase = createSupabaseServerClient();
  const { data: converted, error: rpcError } = await supabase.rpc(
    "convert_quote_to_project_invoice",
    { p_quote_id: quoteId },
  );

  if (rpcError !== null || converted === null || !Array.isArray(converted) || converted.length === 0) {
    throw new Error(rpcError?.message ?? "Failed to convert quote atomically.");
  }

  const row = converted[0] as { project_id: string; invoice_id: string };
  if (!isUuid(row.project_id) || !isUuid(row.invoice_id)) {
    throw new Error("Invalid conversion result.");
  }

  // tenantId is already authorized via requireEmployerSession + RPC current_tenant_id()
  void tenantId;

  revalidateCrmPaths([
    `/employer/invoices/${row.invoice_id}`,
    `/dashboard/projects/${row.project_id}`,
  ]);
  return { projectId: row.project_id, invoiceId: row.invoice_id };
}

export async function generateInvoiceFromApprovedTimeEntries(
  projectId: string,
  hourlyRate: number,
): Promise<{ invoiceId: string }> {
  const { tenantId } = await requireEmployerSession();
  await assertModuleEnabled(tenantId, "billing");
  if (!isUuid(projectId)) {
    throw new Error("Invalid project id.");
  }
  const rate = parseMoneyInput(hourlyRate);
  if (rate === null || rate <= 0) {
    throw new Error("Hourly rate must be positive.");
  }

  if (isDemoMode()) {
    let invoiceId = "";
    await updateDemoStore((store) => {
      const project = store.projects.find((row) => row.id === projectId);
      if (project === undefined) {
        throw new Error("Project not found.");
      }
      const entries = store.timeEntries.filter(
        (row) => row.project_id === projectId && row.status === "approved",
      );
      const minutes = entries.reduce(
        (sum, entry) =>
          sum +
          computeWorkedMinutes({
            clockIn: entry.clock_in,
            clockOut: entry.clock_out,
            breakMinutes: entry.break_minutes,
          }),
        0,
      );
      const hours = roundMoney(minutes / 60);
      if (hours <= 0) {
        throw new Error("No approved billable hours.");
      }
      const line = lineTotal(hours, rate);
      const totals = computeVatTotals({ exclVat: line, vatPercentage: 21 });
      const client = store.clients.find((row) => row.company_name === project.client_name) ?? null;
      invoiceId = randomUUID();
      const due = new Date();
      due.setDate(due.getDate() + 30);
      store.invoices.unshift({
        id: invoiceId,
        tenant_id: tenantId,
        invoice_number: nextInvoiceNumber(store.invoices.map((row) => row.invoice_number)),
        project_id: project.id,
        quote_id: null,
        client_id: client?.id ?? null,
        client_name: project.client_name ?? "Klant",
        status: "draft",
        subtotal: totals.exclVat,
        vat_amount: totals.vatAmount,
        total_amount: totals.inclVat,
        due_date: due.toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
      });
      store.invoiceItems.push({
        id: randomUUID(),
        invoice_id: invoiceId,
        description: `Goedgekeurde uren — ${project.title}`,
        quantity: hours,
        unit_price: rate,
        total_price: line,
      });
    });
    revalidateCrmPaths([`/employer/invoices/${invoiceId}`]);
    return { invoiceId };
  }

  const supabase = createSupabaseServerClient();
  const { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (projectError !== null || projectData === null) {
    throw new Error(projectError?.message ?? "Project not found.");
  }
  const project = projectData as ProjectRow;
  const { data: entriesData, error: entriesError } = await supabase
    .from("time_entries")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "approved");
  if (entriesError !== null) {
    throw new Error(entriesError.message);
  }
  const entries = (entriesData ?? []) as TimeEntryRow[];
  const minutes = entries.reduce(
    (sum, entry) =>
      sum +
      computeWorkedMinutes({
        clockIn: entry.clock_in,
        clockOut: entry.clock_out,
        breakMinutes: entry.break_minutes,
      }),
    0,
  );
  const hours = roundMoney(minutes / 60);
  if (hours <= 0) {
    throw new Error("No approved billable hours.");
  }
  const idempotencyKey = `invoice-from-time:${projectId}:${hours}:${rate}`;
  const { data: invoiceId, error: rpcError } = await supabase.rpc(
    "create_invoice_from_approved_time",
    {
      p_project_id: project.id,
      p_hourly_rate: rate,
      p_vat_rate_bps: 2100,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (rpcError !== null || invoiceId === null || typeof invoiceId !== "string") {
    throw new Error(rpcError?.message ?? "Failed to create invoice atomically.");
  }
  revalidateCrmPaths([`/employer/invoices/${invoiceId}`]);
  return { invoiceId };
}

export async function markInvoiceStatus(
  invoiceId: string,
  status: Extract<InvoiceStatus, "sent" | "paid" | "overdue">,
): Promise<void> {
  const { tenantId } = await requireEmployerSession();
  if (!isUuid(invoiceId)) {
    throw new Error("Invalid invoice id.");
  }

  if (isDemoMode()) {
    await updateDemoStore((store) => {
      const invoice = store.invoices.find((row) => row.id === invoiceId && row.tenant_id === tenantId);
      if (invoice === undefined) {
        throw new Error("Invoice not found.");
      }
      invoice.status = status;
    });
    revalidateCrmPaths([`/employer/invoices/${invoiceId}`, `/employer/invoices/${invoiceId}/print`]);
    return;
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId);
  if (error !== null) {
    throw new Error(error.message);
  }
  revalidateCrmPaths([`/employer/invoices/${invoiceId}`, `/employer/invoices/${invoiceId}/print`]);
}

export async function assignProjectSchedule(input: {
  projectId: string;
  assignedUserId: string;
  scheduledDate: string;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}): Promise<{ scheduleId: string }> {
  const { tenantId } = await requireEmployerSession();
  await assertModuleEnabled(tenantId, "planning");
  if (!isUuid(input.projectId) || !isUuid(input.assignedUserId) || !isNonEmptyString(input.scheduledDate)) {
    throw new Error("Project, employee and date are required.");
  }

  if (isDemoMode()) {
    const scheduleId = randomUUID();
    await updateDemoStore((store) => {
      if (!store.projects.some((row) => row.id === input.projectId)) {
        throw new Error("Project not found.");
      }
      if (!store.profiles.some((row) => row.id === input.assignedUserId)) {
        throw new Error("Employee not found.");
      }
      store.schedules.push({
        id: scheduleId,
        tenant_id: tenantId,
        project_id: input.projectId,
        assigned_user_id: input.assignedUserId,
        scheduled_date: input.scheduledDate,
        start_time: input.startTime?.trim() || null,
        end_time: input.endTime?.trim() || null,
        notes: input.notes?.trim() || null,
        created_at: new Date().toISOString(),
      });
    });
    revalidateCrmPaths(["/employer/planning"]);
    return { scheduleId };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("project_schedules")
    .insert({
      tenant_id: tenantId,
      project_id: input.projectId,
      assigned_user_id: input.assignedUserId,
      scheduled_date: input.scheduledDate,
      start_time: input.startTime?.trim() || null,
      end_time: input.endTime?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error !== null || data === null) {
    throw new Error(error?.message ?? "Failed to assign schedule.");
  }
  revalidateCrmPaths(["/employer/planning"]);
  return { scheduleId: data.id };
}

export async function listQuotes(): Promise<Array<QuoteRow & { items: QuoteItemRow[] }>> {
  await requireEmployerSession();
  if (isDemoMode()) {
    const store = await readDemoStore();
    if (store.quotes.length === 0) {
      await seedDemoStoreIfEmpty(false);
    }
    const next = await readDemoStore();
    return next.quotes.map((quote) => ({
      ...quote,
      items: next.quoteItems.filter((item) => item.quote_id === quote.id),
    }));
  }

  const { tenantId } = await requireEmployerSession();
  const supabase = createSupabaseServerClient();
  const { data: quotes } = await supabase
    .from("quotes")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  const list = (quotes ?? []) as QuoteRow[];
  const { data: items } = await supabase.from("quote_items").select("*");
  const allItems = (items ?? []) as QuoteItemRow[];
  return list.map((quote) => ({
    ...quote,
    items: allItems.filter((item) => item.quote_id === quote.id),
  }));
}

export async function listInvoices(): Promise<Array<InvoiceRow & { items: InvoiceItemRow[] }>> {
  await requireEmployerSession();
  if (isDemoMode()) {
    const store = await readDemoStore();
    if (store.invoices.length === 0) {
      await seedDemoStoreIfEmpty(false);
    }
    const next = await readDemoStore();
    return next.invoices.map((invoice) => ({
      ...invoice,
      items: next.invoiceItems.filter((item) => item.invoice_id === invoice.id),
    }));
  }

  const { tenantId } = await requireEmployerSession();
  const supabase = createSupabaseServerClient();
  const { data: invoices } = await supabase
    .from("invoices")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  const list = (invoices ?? []) as InvoiceRow[];
  const { data: items } = await supabase.from("invoice_items").select("*");
  const allItems = (items ?? []) as InvoiceItemRow[];
  return list.map((invoice) => ({
    ...invoice,
    items: allItems.filter((item) => item.invoice_id === invoice.id),
  }));
}

export async function getInvoiceBundle(
  invoiceId: string,
): Promise<{ invoice: InvoiceRow; items: InvoiceItemRow[]; tenantName: string } | null> {
  const { tenantId } = await requireEmployerSession();
  if (!isUuid(invoiceId)) {
    return null;
  }

  if (isDemoMode()) {
    const store = await readDemoStore();
    const invoice = store.invoices.find((row) => row.id === invoiceId) ?? null;
    if (invoice === null) {
      return null;
    }
    return {
      invoice,
      items: store.invoiceItems.filter((item) => item.invoice_id === invoiceId),
      tenantName: store.tenantName,
    };
  }

  const supabase = createSupabaseServerClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (invoice === null) {
    return null;
  }
  const { data: items } = await supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId);
  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  return {
    invoice: invoice as InvoiceRow,
    items: (items ?? []) as InvoiceItemRow[],
    tenantName:
      tenant !== null && typeof tenant === "object" && "name" in tenant
        ? String((tenant as { name: string }).name)
        : "NEXORA",
  };
}

export async function listPlanningBundle(): Promise<{
  schedules: ProjectScheduleRow[];
  projects: ProjectRow[];
  employees: ProfileRow[];
}> {
  await requireEmployerSession();
  if (isDemoMode()) {
    const store = await readDemoStore();
    if (store.schedules.length === 0) {
      await seedDemoStoreIfEmpty(false);
    }
    const next = await readDemoStore();
    return {
      schedules: next.schedules,
      projects: next.projects,
      employees: next.profiles.filter((profile) => profile.role === "employee"),
    };
  }

  const { tenantId } = await requireEmployerSession();
  const supabase = createSupabaseServerClient();
  const [{ data: schedules }, { data: projects }, { data: employees }] = await Promise.all([
    supabase.from("project_schedules").select("*").eq("tenant_id", tenantId).order("scheduled_date"),
    supabase.from("projects").select("*").eq("tenant_id", tenantId),
    supabase.from("profiles").select("*").eq("tenant_id", tenantId).eq("role", "employee"),
  ]);
  return {
    schedules: (schedules ?? []) as ProjectScheduleRow[],
    projects: (projects ?? []) as ProjectRow[],
    employees: (employees ?? []) as ProfileRow[],
  };
}

export async function listProjectsForBilling(): Promise<ProjectRow[]> {
  await requireEmployerSession();
  if (isDemoMode()) {
    return (await readDemoStore()).projects;
  }
  const { tenantId } = await requireEmployerSession();
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("projects").select("*").eq("tenant_id", tenantId).order("title");
  return (data ?? []) as ProjectRow[];
}

/* -------------------- form wrappers -------------------- */

export async function createClientFormAction(formData: FormData): Promise<void> {
  try {
    await createClient({
      companyName: String(formData.get("company_name") ?? ""),
      contactPerson: String(formData.get("contact_person") ?? "") || null,
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? "") || null,
      address: String(formData.get("address") ?? ""),
      notes: String(formData.get("notes") ?? "") || null,
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect("/employer/clients?error=create");
  }
  redirect("/employer/clients?created=1");
}

export async function createQuoteFormAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "");
  const descriptions = formData.getAll("item_description");
  const quantities = formData.getAll("item_quantity");
  const unitPrices = formData.getAll("item_unit_price");
  const items: QuoteLineInput[] = [];
  for (let i = 0; i < descriptions.length; i += 1) {
    const description = descriptions[i];
    if (typeof description !== "string") continue;
    const quantity = parseMoneyInput(String(quantities[i] ?? "1"));
    const unitPrice = parseMoneyInput(String(unitPrices[i] ?? "0"));
    if (quantity === null || unitPrice === null) {
      redirect("/employer/quotes?error=items");
    }
    items.push({ description, quantity, unitPrice });
  }

  try {
    await createQuoteWithItems({
      clientId,
      validUntil: String(formData.get("valid_until") ?? "") || null,
      status: formData.get("status") === "sent" ? "sent" : "draft",
      items,
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect("/employer/quotes?error=create");
  }
  redirect("/employer/quotes?created=1");
}

export async function convertQuoteFormAction(formData: FormData): Promise<void> {
  const quoteId = String(formData.get("quote_id") ?? "");
  let invoiceId = "";
  try {
    ({ invoiceId } = await convertQuoteToProjectAndInvoice(quoteId));
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect("/employer/quotes?error=convert");
  }
  redirect(`/employer/invoices/${invoiceId}`);
}

export async function generateInvoiceFormAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  const rate = parseMoneyInput(String(formData.get("hourly_rate") ?? ""));
  if (rate === null) {
    redirect("/employer/invoices?error=rate");
  }
  let invoiceId = "";
  try {
    ({ invoiceId } = await generateInvoiceFromApprovedTimeEntries(projectId, rate));
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect("/employer/invoices?error=generate");
  }
  redirect(`/employer/invoices/${invoiceId}`);
}

export async function markInvoiceStatusFormAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const status = String(formData.get("status") ?? "") as Extract<
    InvoiceStatus,
    "sent" | "paid" | "overdue"
  >;
  try {
    await markInvoiceStatus(invoiceId, status);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect(`/employer/invoices/${invoiceId}?error=status`);
  }
  redirect(`/employer/invoices/${invoiceId}?updated=1`);
}

export async function assignScheduleFormAction(formData: FormData): Promise<void> {
  try {
    await assignProjectSchedule({
      projectId: String(formData.get("project_id") ?? ""),
      assignedUserId: String(formData.get("assigned_user_id") ?? ""),
      scheduledDate: String(formData.get("scheduled_date") ?? ""),
      startTime: String(formData.get("start_time") ?? "") || null,
      endTime: String(formData.get("end_time") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect("/employer/planning?error=assign");
  }
  redirect("/employer/planning?assigned=1");
}
