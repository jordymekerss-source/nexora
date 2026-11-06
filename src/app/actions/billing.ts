"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEmployerSession } from "@/lib/auth/require-user";
import { nextInvoiceNumber, nextQuoteNumber } from "@/lib/billing-numbers";
import { computeVatTotals, lineTotal, parseMoneyInput, roundMoney } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeWorkedMinutes } from "@/lib/time-entry";
import { isNonEmptyString, isUuid } from "@/lib/validation";
import type {
  InvoiceRow,
  ProjectRow,
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

export type CreateQuoteInput = {
  clientName: string;
  clientEmail: string;
  clientId?: string | null;
  vatPercentage?: number;
  validUntil?: string | null;
  status?: Extract<QuoteStatus, "draft" | "sent">;
  items: QuoteLineInput[];
};

function revalidateBillingPaths(paths: readonly string[] = []): void {
  revalidatePath("/employer/quotes");
  revalidatePath("/employer/invoices");
  revalidatePath("/dashboard");
  for (const path of paths) {
    revalidatePath(path);
  }
}

export async function createQuote(data: CreateQuoteInput): Promise<{ quoteId: string }> {
  const { tenantId } = await requireEmployerSession();
  const supabase = createSupabaseServerClient();

  if (!isNonEmptyString(data.clientName) || !isNonEmptyString(data.clientEmail)) {
    throw new Error("Client name and email are required.");
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("At least one quote line item is required.");
  }

  const vatPercentage =
    typeof data.vatPercentage === "number" && Number.isFinite(data.vatPercentage)
      ? Math.trunc(data.vatPercentage)
      : 21;

  if (vatPercentage < 0 || vatPercentage > 100) {
    throw new Error("VAT percentage must be between 0 and 100.");
  }

  const status: Extract<QuoteStatus, "draft" | "sent"> =
    data.status === "sent" ? "sent" : "draft";

  const normalizedItems = data.items.map((item, index) => {
    if (!isNonEmptyString(item.description)) {
      throw new Error(`Line ${index + 1} is missing a description.`);
    }
    const quantity = parseMoneyInput(item.quantity);
    const unitPrice = parseMoneyInput(item.unitPrice);
    if (quantity === null || quantity <= 0) {
      throw new Error(`Line ${index + 1} has an invalid quantity.`);
    }
    if (unitPrice === null || unitPrice < 0) {
      throw new Error(`Line ${index + 1} has an invalid unit price.`);
    }
    const totalPrice = lineTotal(quantity, unitPrice);
    return {
      description: item.description.trim(),
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
    };
  });

  const exclVat = roundMoney(
    normalizedItems.reduce((sum, item) => sum + item.total_price, 0),
  );
  const totals = computeVatTotals({ exclVat, vatPercentage });

  const clientId =
    typeof data.clientId === "string" && isUuid(data.clientId) ? data.clientId : null;

  const validUntil =
    typeof data.validUntil === "string" && data.validUntil.trim().length > 0
      ? data.validUntil.trim()
      : null;

  const { data: existingQuotes, error: existingError } = await supabase
    .from("quotes")
    .select("quote_number")
    .eq("tenant_id", tenantId);

  if (existingError !== null) {
    throw new Error(`Could not allocate quote number: ${existingError.message}`);
  }

  const quoteNumber = nextQuoteNumber(
    (existingQuotes ?? []).map((row) => row.quote_number),
  );

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenantId,
      quote_number: quoteNumber,
      client_id: clientId,
      client_name: data.clientName.trim(),
      client_email: data.clientEmail.trim().toLowerCase(),
      status,
      total_amount_excl_vat: totals.exclVat,
      vat_percentage: vatPercentage,
      total_amount_incl_vat: totals.inclVat,
      valid_until: validUntil,
    })
    .select("id")
    .single();

  if (quoteError !== null || quote === null) {
    throw new Error(quoteError?.message ?? "Failed to create quote.");
  }

  const { error: itemsError } = await supabase.from("quote_items").insert(
    normalizedItems.map((item) => ({
      quote_id: quote.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
    })),
  );

  if (itemsError !== null) {
    await supabase.from("quotes").delete().eq("id", quote.id).eq("tenant_id", tenantId);
    throw new Error(`Failed to create quote items: ${itemsError.message}`);
  }

  revalidateBillingPaths();
  return { quoteId: quote.id };
}

export async function convertQuoteToProject(quoteId: string): Promise<{ projectId: string }> {
  const { tenantId } = await requireEmployerSession();

  if (!isUuid(quoteId)) {
    throw new Error("Invalid quote id.");
  }

  const supabase = createSupabaseServerClient();

  const { data: quoteData, error: quoteError } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (quoteError !== null || quoteData === null) {
    throw new Error(quoteError?.message ?? "Quote not found.");
  }

  const quote = quoteData as QuoteRow;

  if (quote.status === "rejected") {
    throw new Error("Rejected quotes cannot be converted to projects.");
  }

  const { data: itemsData, error: itemsError } = await supabase
    .from("quote_items")
    .select("*")
    .eq("quote_id", quoteId);

  if (itemsError !== null) {
    throw new Error(itemsError.message);
  }

  const items = (itemsData ?? []) as QuoteItemRow[];
  const firstLine = items[0]?.description ?? "Werkzaamheden";
  const address = `Klant: ${quote.client_name} · Offerte ${quote.quote_number}`;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenantId,
      title: `${quote.quote_number} — ${firstLine}`.slice(0, 180),
      client_name: quote.client_name,
      address,
      status: "planning",
    })
    .select("id")
    .single();

  if (projectError !== null || project === null) {
    throw new Error(projectError?.message ?? "Failed to create project from quote.");
  }

  const { error: statusError } = await supabase
    .from("quotes")
    .update({ status: "accepted" })
    .eq("id", quoteId)
    .eq("tenant_id", tenantId);

  if (statusError !== null) {
    await supabase.from("projects").delete().eq("id", project.id).eq("tenant_id", tenantId);
    throw new Error(statusError.message);
  }

  revalidateBillingPaths([`/dashboard/projects/${project.id}`, "/dashboard/projects"]);
  return { projectId: project.id };
}

export async function generateInvoiceFromApprovedHours(
  projectId: string,
  hourlyRate: number,
  options?: { clientEmail?: string; clientName?: string },
): Promise<{ invoiceId: string }> {
  const { tenantId } = await requireEmployerSession();
  const supabase = createSupabaseServerClient();

  if (!isUuid(projectId)) {
    throw new Error("Invalid project id.");
  }

  const rate = parseMoneyInput(hourlyRate);
  if (rate === null || rate <= 0) {
    throw new Error("Hourly rate must be a positive amount.");
  }

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
    .eq("tenant_id", tenantId)
    .eq("status", "approved");

  if (entriesError !== null) {
    throw new Error(entriesError.message);
  }

  const entries = (entriesData ?? []) as TimeEntryRow[];
  if (entries.length === 0) {
    throw new Error("No approved time entries found for this project.");
  }

  const totalMinutes = entries.reduce(
    (sum, entry) =>
      sum +
      computeWorkedMinutes({
        clockIn: entry.clock_in,
        clockOut: entry.clock_out,
        breakMinutes: entry.break_minutes,
      }),
    0,
  );

  const hours = roundMoney(totalMinutes / 60);
  if (hours <= 0) {
    throw new Error("Approved time entries do not contain billable hours.");
  }

  const lineAmount = lineTotal(hours, rate);
  const vatPercentage = 21;
  const totals = computeVatTotals({ exclVat: lineAmount, vatPercentage });

  const { data: existingInvoices, error: existingError } = await supabase
    .from("invoices")
    .select("invoice_number")
    .eq("tenant_id", tenantId);

  if (existingError !== null) {
    throw new Error(`Could not allocate invoice number: ${existingError.message}`);
  }

  const invoiceNumber = nextInvoiceNumber(
    (existingInvoices ?? []).map((row) => row.invoice_number),
  );

  const due = new Date();
  due.setDate(due.getDate() + 30);
  const dueDate = due.toISOString().slice(0, 10);

  const clientNameFromOptions =
    typeof options?.clientName === "string" && options.clientName.trim().length > 0
      ? options.clientName.trim()
      : null;
  const clientName =
    clientNameFromOptions ??
    (project.client_name !== null && project.client_name.trim().length > 0
      ? project.client_name.trim()
      : "Klant");

  let clientEmail =
    typeof options?.clientEmail === "string" && options.clientEmail.trim().length > 0
      ? options.clientEmail.trim().toLowerCase()
      : null;

  if (clientEmail === null) {
    const { data: matchingQuote } = await supabase
      .from("quotes")
      .select("client_email")
      .eq("tenant_id", tenantId)
      .eq("client_name", clientName)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      matchingQuote !== null &&
      typeof matchingQuote === "object" &&
      "client_email" in matchingQuote &&
      typeof (matchingQuote as { client_email: string }).client_email === "string"
    ) {
      clientEmail = (matchingQuote as { client_email: string }).client_email;
    }
  }

  if (clientEmail === null) {
    clientEmail = `facturatie+${project.id.replace(/-/g, "").slice(0, 10)}@nexora.local`;
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      project_id: project.id,
      quote_id: null,
      client_name: clientName,
      client_email: clientEmail,
      status: "draft",
      subtotal: totals.exclVat,
      vat_amount: totals.vatAmount,
      total_amount: totals.inclVat,
      due_date: dueDate,
    })
    .select("id")
    .single();

  if (invoiceError !== null || invoice === null) {
    throw new Error(invoiceError?.message ?? "Failed to create invoice.");
  }

  const { error: itemError } = await supabase.from("invoice_items").insert({
    invoice_id: invoice.id,
    description: `Goedgekeurde uren — ${project.title} (${hours.toFixed(2)} u × ${rate.toFixed(2)} EUR)`,
    quantity: hours,
    unit_price: rate,
    total_price: lineAmount,
  });

  if (itemError !== null) {
    await supabase.from("invoices").delete().eq("id", invoice.id).eq("tenant_id", tenantId);
    throw new Error(`Failed to create invoice line: ${itemError.message}`);
  }

  revalidateBillingPaths([`/employer/invoices/${invoice.id}`, `/dashboard/projects/${projectId}`]);
  return { invoiceId: invoice.id };
}

export async function markInvoiceAsPaid(invoiceId: string): Promise<void> {
  const { tenantId } = await requireEmployerSession();

  if (!isUuid(invoiceId)) {
    throw new Error("Invalid invoice id.");
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "paid" })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(error.message);
  }
  if (data === null) {
    throw new Error("Invoice not found.");
  }

  revalidateBillingPaths([`/employer/invoices/${invoiceId}`]);
}

export async function updateQuoteStatus(
  quoteId: string,
  status: QuoteStatus,
): Promise<void> {
  const { tenantId } = await requireEmployerSession();

  if (!isUuid(quoteId)) {
    throw new Error("Invalid quote id.");
  }
  if (!["draft", "sent", "accepted", "rejected"].includes(status)) {
    throw new Error("Invalid quote status.");
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("quotes")
    .update({ status })
    .eq("id", quoteId)
    .eq("tenant_id", tenantId);

  if (error !== null) {
    throw new Error(error.message);
  }

  revalidateBillingPaths();
}

export async function markInvoiceAsSent(invoiceId: string): Promise<void> {
  const { tenantId } = await requireEmployerSession();

  if (!isUuid(invoiceId)) {
    throw new Error("Invalid invoice id.");
  }

  const supabase = createSupabaseServerClient();
  const { data: invoiceData, error: fetchError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchError !== null || invoiceData === null) {
    throw new Error(fetchError?.message ?? "Invoice not found.");
  }

  const invoice = invoiceData as InvoiceRow;
  if (invoice.status === "paid") {
    throw new Error("Paid invoices cannot be marked as sent.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const nextStatus = invoice.due_date < today ? "overdue" : "sent";

  const { error } = await supabase
    .from("invoices")
    .update({ status: nextStatus })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId);

  if (error !== null) {
    throw new Error(error.message);
  }

  revalidateBillingPaths([`/employer/invoices/${invoiceId}`]);
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

export async function createQuoteFormAction(formData: FormData): Promise<void> {
  const clientName = formData.get("client_name");
  const clientEmail = formData.get("client_email");
  const validUntil = formData.get("valid_until");
  const vatRaw = formData.get("vat_percentage");
  const statusRaw = formData.get("status");
  const descriptions = formData.getAll("item_description");
  const quantities = formData.getAll("item_quantity");
  const unitPrices = formData.getAll("item_unit_price");

  if (
    typeof clientName !== "string" ||
    typeof clientEmail !== "string" ||
    descriptions.length === 0
  ) {
    redirect("/employer/quotes?error=form");
  }

  const items: QuoteLineInput[] = [];
  for (let i = 0; i < descriptions.length; i += 1) {
    const description = descriptions[i];
    const quantity = quantities[i];
    const unitPrice = unitPrices[i];
    if (typeof description !== "string") {
      continue;
    }
    const parsedQty = parseMoneyInput(typeof quantity === "string" ? quantity : "1");
    const parsedPrice = parseMoneyInput(typeof unitPrice === "string" ? unitPrice : "0");
    if (parsedQty === null || parsedPrice === null) {
      redirect("/employer/quotes?error=items");
    }
    items.push({
      description,
      quantity: parsedQty,
      unitPrice: parsedPrice,
    });
  }

  try {
    await createQuote({
      clientName,
      clientEmail,
      validUntil: typeof validUntil === "string" ? validUntil : null,
      vatPercentage:
        typeof vatRaw === "string" && vatRaw.trim().length > 0
          ? Number.parseInt(vatRaw, 10)
          : 21,
      status: statusRaw === "sent" ? "sent" : "draft",
      items,
    });
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    redirect("/employer/quotes?error=create");
  }

  redirect("/employer/quotes?created=1");
}

export async function convertQuoteToProjectFormAction(formData: FormData): Promise<void> {
  const quoteId = formData.get("quote_id");
  if (typeof quoteId !== "string" || !isUuid(quoteId)) {
    redirect("/employer/quotes?error=quote");
  }

  let projectId: string;
  try {
    ({ projectId } = await convertQuoteToProject(quoteId));
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    redirect("/employer/quotes?error=convert");
  }

  redirect(`/dashboard/projects/${projectId}`);
}

export async function generateInvoiceFromHoursFormAction(formData: FormData): Promise<void> {
  const projectId = formData.get("project_id");
  const hourlyRate = formData.get("hourly_rate");

  if (typeof projectId !== "string" || !isUuid(projectId)) {
    redirect("/employer/invoices?error=project");
  }

  const rate = parseMoneyInput(typeof hourlyRate === "string" ? hourlyRate : null);
  if (rate === null) {
    redirect("/employer/invoices?error=rate");
  }

  const clientEmail = formData.get("client_email");
  const clientName = formData.get("client_name");

  let invoiceId: string;
  try {
    ({ invoiceId } = await generateInvoiceFromApprovedHours(projectId, rate, {
      clientEmail: typeof clientEmail === "string" ? clientEmail : undefined,
      clientName: typeof clientName === "string" ? clientName : undefined,
    }));
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    redirect("/employer/invoices?error=generate");
  }

  redirect(`/employer/invoices/${invoiceId}`);
}

export async function markInvoiceAsPaidFormAction(formData: FormData): Promise<void> {
  const invoiceId = formData.get("invoice_id");
  if (typeof invoiceId !== "string" || !isUuid(invoiceId)) {
    redirect("/employer/invoices?error=invoice");
  }

  try {
    await markInvoiceAsPaid(invoiceId);
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    redirect(`/employer/invoices/${invoiceId}?error=paid`);
  }

  redirect(`/employer/invoices/${invoiceId}?paid=1`);
}

export async function updateQuoteStatusFormAction(formData: FormData): Promise<void> {
  const quoteId = formData.get("quote_id");
  const status = formData.get("status");
  if (typeof quoteId !== "string" || !isUuid(quoteId) || typeof status !== "string") {
    redirect("/employer/quotes?error=status");
  }

  try {
    await updateQuoteStatus(quoteId, status as QuoteStatus);
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    redirect("/employer/quotes?error=status");
  }

  redirect("/employer/quotes?updated=1");
}

export async function markInvoiceAsSentFormAction(formData: FormData): Promise<void> {
  const invoiceId = formData.get("invoice_id");
  if (typeof invoiceId !== "string" || !isUuid(invoiceId)) {
    redirect("/employer/invoices?error=invoice");
  }

  try {
    await markInvoiceAsSent(invoiceId);
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    redirect(`/employer/invoices/${invoiceId}?error=sent`);
  }

  redirect(`/employer/invoices/${invoiceId}?sent=1`);
}
