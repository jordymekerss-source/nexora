import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  DEMO_EMPLOYEE_IDS,
  DEMO_EMPLOYER_ID,
  DEMO_TENANT_ID,
} from "@/lib/demo/mode";
import { nextInvoiceNumber, nextQuoteNumber } from "@/lib/billing-numbers";
import { computeVatTotals, lineTotal, roundMoney } from "@/lib/money";
import type {
  AuditEventRow,
  BreakEntryRow,
  ClientRow,
  EmployeeCertificateRow,
  InvoiceItemRow,
  InvoiceRow,
  InvoiceStatus,
  ModuleConfigRow,
  ProfileRow,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectScheduleRow,
  QuoteItemRow,
  QuoteRow,
  QuoteStatus,
  TimeEntryCorrectionRow,
  TimeEntryRow,
  ToolRow,
  VehicleRow,
  WorkOrderRow,
} from "@/types/database";

export type DemoStore = {
  tenantName: string;
  profiles: ProfileRow[];
  clients: ClientRow[];
  projects: ProjectRow[];
  quotes: QuoteRow[];
  quoteItems: QuoteItemRow[];
  invoices: InvoiceRow[];
  invoiceItems: InvoiceItemRow[];
  schedules: ProjectScheduleRow[];
  timeEntries: TimeEntryRow[];
  breakEntries: BreakEntryRow[];
  timeEntryCorrections: TimeEntryCorrectionRow[];
  auditEvents: AuditEventRow[];
  moduleConfigs: ModuleConfigRow[];
  assignments: ProjectAssignmentRow[];
  vehicles: VehicleRow[];
  tools: ToolRow[];
  certificates: EmployeeCertificateRow[];
  workOrders: WorkOrderRow[];
  seededAt: string | null;
};

const STORE_PATH = path.join(process.cwd(), ".data", "demo-store.json");

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): DemoStore {
  return {
    tenantName: "Nexora Demo Installaties",
    profiles: [
      {
        id: DEMO_EMPLOYER_ID,
        tenant_id: DEMO_TENANT_ID,
        full_name: "Demo Werkgever",
        role: "employer",
        phone: "+31 6 1234 5678",
        created_at: nowIso(),
      },
      {
        id: DEMO_EMPLOYEE_IDS[0],
        tenant_id: DEMO_TENANT_ID,
        full_name: "Sam Jansen",
        role: "employee",
        phone: null,
        created_at: nowIso(),
      },
      {
        id: DEMO_EMPLOYEE_IDS[1],
        tenant_id: DEMO_TENANT_ID,
        full_name: "Lisa de Vries",
        role: "employee",
        phone: null,
        created_at: nowIso(),
      },
      {
        id: DEMO_EMPLOYEE_IDS[2],
        tenant_id: DEMO_TENANT_ID,
        full_name: "Omar Hassan",
        role: "employee",
        phone: null,
        created_at: nowIso(),
      },
    ],
    clients: [],
    projects: [],
    quotes: [],
    quoteItems: [],
    invoices: [],
    invoiceItems: [],
    schedules: [],
    timeEntries: [],
    breakEntries: [],
    timeEntryCorrections: [],
    auditEvents: [],
    moduleConfigs: [],
    assignments: [],
    vehicles: [],
    tools: [],
    certificates: [],
    workOrders: [],
    seededAt: null,
  };
}

function normalizeStore(raw: DemoStore): DemoStore {
  return {
    ...emptyStore(),
    ...raw,
    assignments: raw.assignments ?? [],
    vehicles: raw.vehicles ?? [],
    tools: raw.tools ?? [],
    certificates: raw.certificates ?? [],
    workOrders: raw.workOrders ?? [],
    breakEntries: raw.breakEntries ?? [],
    timeEntryCorrections: raw.timeEntryCorrections ?? [],
    auditEvents: raw.auditEvents ?? [],
    moduleConfigs: raw.moduleConfigs ?? [],
  };
}

let memoryCache: DemoStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
}

export async function readDemoStore(): Promise<DemoStore> {
  if (memoryCache !== null) {
    return structuredClone(memoryCache);
  }

  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    memoryCache = normalizeStore(JSON.parse(raw) as DemoStore);
    return structuredClone(memoryCache);
  } catch {
    memoryCache = emptyStore();
    await persistDemoStore(memoryCache);
    return structuredClone(memoryCache);
  }
}

export async function persistDemoStore(store: DemoStore): Promise<void> {
  memoryCache = structuredClone(store);
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    await fs.writeFile(STORE_PATH, JSON.stringify(memoryCache, null, 2), "utf8");
  });
  await writeQueue;
}

export async function updateDemoStore(
  mutator: (store: DemoStore) => void,
): Promise<DemoStore> {
  const store = await readDemoStore();
  mutator(store);
  await persistDemoStore(store);
  return structuredClone(store);
}

function mondayOfWeek(date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function seedDemoStoreIfEmpty(force = false): Promise<{ seeded: boolean }> {
  const current = await readDemoStore();
  const needsOpsSeed =
    current.assignments.length === 0 ||
    current.vehicles.length === 0 ||
    current.tools.length === 0 ||
    current.certificates.length === 0;
  if (!force && current.clients.length > 0 && current.seededAt !== null && !needsOpsSeed) {
    return { seeded: false };
  }

  const createdAt = nowIso();
  const weekStart = mondayOfWeek();

  const clients: ClientRow[] = [
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      company_name: "Van Dijk Bouw BV",
      contact_person: "Pieter van Dijk",
      email: "pieter@vandijkbouw.nl",
      phone: "+31 20 555 0101",
      address: "Amstelstraat 12, 1017 Amsterdam",
      notes: "Preferentie voor ochtendafspraken.",
      created_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      company_name: "Horizon Retail Group",
      contact_person: "Eva Bakker",
      email: "eva@horizonretail.nl",
      phone: "+31 30 555 0202",
      address: "Catharijnesingel 40, 3511 Utrecht",
      notes: "Meerdere vestigingen.",
      created_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      company_name: "Groene Daken BV",
      contact_person: "Tom Meijer",
      email: "tom@groenedaken.nl",
      phone: "+31 10 555 0303",
      address: "Coolsingel 5, 3011 Rotterdam",
      notes: null,
      created_at: createdAt,
    },
  ];

  const projectA: ProjectRow = {
    id: randomUUID(),
    tenant_id: DEMO_TENANT_ID,
    title: "Showroom verlichting — Van Dijk",
    client_name: clients[0]!.company_name,
    address: clients[0]!.address,
    status: "active",
    created_at: createdAt,
  };
  const projectB: ProjectRow = {
    id: randomUUID(),
    tenant_id: DEMO_TENANT_ID,
    title: "Winkelketen HVAC — Horizon",
    client_name: clients[1]!.company_name,
    address: clients[1]!.address,
    status: "planning",
    created_at: createdAt,
  };

  const quoteItemsA = [
    { description: "LED armaturen installatie", quantity: 12, unit_price: 145 },
    { description: "Kabeltraject + schakelmateriaal", quantity: 1, unit_price: 890 },
  ];
  const exclA = roundMoney(
    quoteItemsA.reduce((sum, item) => sum + lineTotal(item.quantity, item.unit_price), 0),
  );
  const totalsA = computeVatTotals({ exclVat: exclA, vatPercentage: 21 });
  const quoteA: QuoteRow = {
    id: randomUUID(),
    tenant_id: DEMO_TENANT_ID,
    quote_number: nextQuoteNumber([]),
    client_id: clients[0]!.id,
    client_name: clients[0]!.company_name,
    status: "sent",
    subtotal: totalsA.exclVat,
    vat_amount: totalsA.vatAmount,
    total_amount: totalsA.inclVat,
    valid_until: ymd(new Date(Date.now() + 1000 * 60 * 60 * 24 * 21)),
    created_at: createdAt,
  };

  const quoteItemsB = [
    { description: "Warmtepomp buitenunit", quantity: 2, unit_price: 1850 },
    { description: "Montage & inregelen", quantity: 16, unit_price: 75 },
  ];
  const exclB = roundMoney(
    quoteItemsB.reduce((sum, item) => sum + lineTotal(item.quantity, item.unit_price), 0),
  );
  const totalsB = computeVatTotals({ exclVat: exclB, vatPercentage: 21 });
  const quoteB: QuoteRow = {
    id: randomUUID(),
    tenant_id: DEMO_TENANT_ID,
    quote_number: nextQuoteNumber([quoteA.quote_number]),
    client_id: clients[1]!.id,
    client_name: clients[1]!.company_name,
    status: "accepted",
    subtotal: totalsB.exclVat,
    vat_amount: totalsB.vatAmount,
    total_amount: totalsB.inclVat,
    valid_until: ymd(new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)),
    created_at: createdAt,
  };

  const quoteItemRows: QuoteItemRow[] = [
    ...quoteItemsA.map((item) => ({
      id: randomUUID(),
      quote_id: quoteA.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: lineTotal(item.quantity, item.unit_price),
    })),
    ...quoteItemsB.map((item) => ({
      id: randomUUID(),
      quote_id: quoteB.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: lineTotal(item.quantity, item.unit_price),
    })),
  ];

  const invoiceHours = 18.5;
  const hourlyRate = 72;
  const hoursLine = lineTotal(invoiceHours, hourlyRate);
  const invoiceTotals = computeVatTotals({ exclVat: hoursLine, vatPercentage: 21 });
  const invoiceOpen: InvoiceRow = {
    id: randomUUID(),
    tenant_id: DEMO_TENANT_ID,
    invoice_number: nextInvoiceNumber([]),
    project_id: projectA.id,
    quote_id: quoteA.id,
    client_id: clients[0]!.id,
    client_name: clients[0]!.company_name,
    status: "sent",
    subtotal: invoiceTotals.exclVat,
    vat_amount: invoiceTotals.vatAmount,
    total_amount: invoiceTotals.inclVat,
    due_date: ymd(new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)),
    created_at: createdAt,
  };

  const paidLine = lineTotal(8, 72);
  const paidTotals = computeVatTotals({ exclVat: paidLine, vatPercentage: 21 });
  const invoicePaid: InvoiceRow = {
    id: randomUUID(),
    tenant_id: DEMO_TENANT_ID,
    invoice_number: nextInvoiceNumber([invoiceOpen.invoice_number]),
    project_id: projectA.id,
    quote_id: null,
    client_id: clients[0]!.id,
    client_name: clients[0]!.company_name,
    status: "paid",
    subtotal: paidTotals.exclVat,
    vat_amount: paidTotals.vatAmount,
    total_amount: paidTotals.inclVat,
    due_date: ymd(new Date(Date.now() - 1000 * 60 * 60 * 24 * 5)),
    created_at: createdAt,
  };

  const overdueLine = lineTotal(10, 72);
  const overdueTotals = computeVatTotals({ exclVat: overdueLine, vatPercentage: 21 });
  const invoiceOverdue: InvoiceRow = {
    id: randomUUID(),
    tenant_id: DEMO_TENANT_ID,
    invoice_number: nextInvoiceNumber([
      invoiceOpen.invoice_number,
      invoicePaid.invoice_number,
    ]),
    project_id: projectB.id,
    quote_id: quoteB.id,
    client_id: clients[1]!.id,
    client_name: clients[1]!.company_name,
    status: "overdue",
    subtotal: overdueTotals.exclVat,
    vat_amount: overdueTotals.vatAmount,
    total_amount: overdueTotals.inclVat,
    due_date: ymd(new Date(Date.now() - 1000 * 60 * 60 * 24 * 10)),
    created_at: createdAt,
  };

  const invoiceItems: InvoiceItemRow[] = [
    {
      id: randomUUID(),
      invoice_id: invoiceOpen.id,
      description: `Goedgekeurde uren — ${projectA.title}`,
      quantity: invoiceHours,
      unit_price: hourlyRate,
      total_price: hoursLine,
    },
    {
      id: randomUUID(),
      invoice_id: invoicePaid.id,
      description: "Servicebeurt week 42",
      quantity: 8,
      unit_price: 72,
      total_price: paidLine,
    },
    {
      id: randomUUID(),
      invoice_id: invoiceOverdue.id,
      description: "Voorwerk HVAC montage",
      quantity: 10,
      unit_price: 72,
      total_price: overdueLine,
    },
  ];

  const schedules: ProjectScheduleRow[] = [];
  for (let day = 0; day < 5; day += 1) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + day);
    schedules.push({
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      project_id: projectA.id,
      assigned_user_id: DEMO_EMPLOYEE_IDS[day % 3]!,
      scheduled_date: ymd(date),
      start_time: "08:00",
      end_time: "16:00",
      notes: day === 2 ? "Materiaal ophalen om 07:30" : null,
      created_at: createdAt,
    });
    if (day % 2 === 0) {
      schedules.push({
        id: randomUUID(),
        tenant_id: DEMO_TENANT_ID,
        project_id: projectB.id,
        assigned_user_id: DEMO_EMPLOYEE_IDS[(day + 1) % 3]!,
        scheduled_date: ymd(date),
        start_time: "09:00",
        end_time: "13:00",
        notes: null,
        created_at: createdAt,
      });
    }
  }

  const clockIn = new Date();
  clockIn.setDate(clockIn.getDate() - 2);
  clockIn.setHours(8, 0, 0, 0);
  const clockOut = new Date(clockIn);
  clockOut.setHours(16, 30, 0, 0);

  const liveClockIn = new Date();
  liveClockIn.setHours(liveClockIn.getHours() - 2);

  const timeEntries: TimeEntryRow[] = [
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      user_id: DEMO_EMPLOYEE_IDS[0]!,
      project_id: projectA.id,
      clock_in: clockIn.toISOString(),
      clock_out: clockOut.toISOString(),
      break_minutes: 30,
      notes: "Showroom bedrading",
      status: "approved",
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      user_id: DEMO_EMPLOYEE_IDS[1]!,
      project_id: projectA.id,
      clock_in: new Date(clockIn.getTime() + 86400000).toISOString(),
      clock_out: new Date(clockOut.getTime() + 86400000).toISOString(),
      break_minutes: 30,
      notes: null,
      status: "approved",
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      user_id: DEMO_EMPLOYEE_IDS[0]!,
      project_id: projectA.id,
      clock_in: liveClockIn.toISOString(),
      clock_out: null,
      break_minutes: 0,
      notes: "Actief op locatie",
      status: "pending",
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      user_id: DEMO_EMPLOYEE_IDS[2]!,
      project_id: projectA.id,
      clock_in: new Date(liveClockIn.getTime() - 45 * 60000).toISOString(),
      clock_out: null,
      break_minutes: 0,
      notes: "Tweede monteur",
      status: "pending",
    },
  ];

  const assignments: ProjectAssignmentRow[] = [
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      project_id: projectA.id,
      user_id: DEMO_EMPLOYEE_IDS[0]!,
      assigned_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      project_id: projectA.id,
      user_id: DEMO_EMPLOYEE_IDS[1]!,
      assigned_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      project_id: projectA.id,
      user_id: DEMO_EMPLOYEE_IDS[2]!,
      assigned_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      project_id: projectB.id,
      user_id: DEMO_EMPLOYEE_IDS[1]!,
      assigned_at: createdAt,
    },
  ];

  const vehicles: VehicleRow[] = [
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      license_plate: "V-123-NX",
      brand_model: "Volkswagen Transporter",
      apk_expiry_date: ymd(new Date(Date.now() + 1000 * 60 * 60 * 24 * 40)),
      km_status: 87450,
      assigned_user_id: DEMO_EMPLOYEE_IDS[0]!,
      created_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      license_plate: "V-456-NX",
      brand_model: "Mercedes Sprinter",
      apk_expiry_date: ymd(new Date(Date.now() - 1000 * 60 * 60 * 24 * 5)),
      km_status: 152300,
      assigned_user_id: DEMO_EMPLOYEE_IDS[1]!,
      created_at: createdAt,
    },
  ];

  const tools: ToolRow[] = [
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      name: "Bosch klopboormachine",
      serial_number: "BSH-99821",
      status: "active",
      checked_out_to_user_id: DEMO_EMPLOYEE_IDS[0]!,
      created_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      name: "Laser waterpas",
      serial_number: "LVL-4412",
      status: "active",
      checked_out_to_user_id: DEMO_EMPLOYEE_IDS[2]!,
      created_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      name: "Kabeltrekker set",
      serial_number: "KT-17",
      status: "maintenance",
      checked_out_to_user_id: null,
      created_at: createdAt,
    },
  ];

  const certificates: EmployeeCertificateRow[] = [
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      user_id: DEMO_EMPLOYEE_IDS[0]!,
      certificate_name: "VCA Basis",
      expiry_date: ymd(new Date(Date.now() + 1000 * 60 * 60 * 24 * 20)),
      document_url: null,
      created_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      user_id: DEMO_EMPLOYEE_IDS[1]!,
      certificate_name: "Rijbewijs BE",
      expiry_date: ymd(new Date(Date.now() + 1000 * 60 * 60 * 24 * 400)),
      document_url: null,
      created_at: createdAt,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      user_id: DEMO_EMPLOYEE_IDS[2]!,
      certificate_name: "VCA VOL",
      expiry_date: ymd(new Date(Date.now() - 1000 * 60 * 60 * 24 * 3)),
      document_url: null,
      created_at: createdAt,
    },
  ];

  const workOrders: WorkOrderRow[] = [
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT_ID,
      project_id: projectA.id,
      client_signature_url: null,
      work_summary: "LED armaturen geplaatst in showroomzone A.",
      completed_at: null,
      created_at: createdAt,
      created_by: DEMO_EMPLOYEE_IDS[0]!,
    },
  ];

  await persistDemoStore({
    tenantName: "Nexora Demo Installaties",
    profiles: emptyStore().profiles,
    clients,
    projects: [projectA, projectB],
    quotes: [quoteA, quoteB],
    quoteItems: quoteItemRows,
    invoices: [invoiceOpen, invoicePaid, invoiceOverdue],
    invoiceItems,
    schedules,
    timeEntries,
    breakEntries: [],
    timeEntryCorrections: [],
    auditEvents: [],
    moduleConfigs: [
      {
        id: randomUUID(),
        tenant_id: DEMO_TENANT_ID,
        module_key: "time",
        enabled: true,
        settings: {},
        updated_at: createdAt,
      },
      {
        id: randomUUID(),
        tenant_id: DEMO_TENANT_ID,
        module_key: "crm",
        enabled: true,
        settings: {},
        updated_at: createdAt,
      },
      {
        id: randomUUID(),
        tenant_id: DEMO_TENANT_ID,
        module_key: "fleet",
        enabled: true,
        settings: {},
        updated_at: createdAt,
      },
    ],
    assignments,
    vehicles,
    tools,
    certificates,
    workOrders,
    seededAt: createdAt,
  });

  return { seeded: true };
}

export type ClientHistory = {
  client: ClientRow;
  quotes: QuoteRow[];
  invoices: InvoiceRow[];
  projects: ProjectRow[];
};

export async function getDemoClientHistory(clientId: string): Promise<ClientHistory | null> {
  const store = await readDemoStore();
  const client = store.clients.find((row) => row.id === clientId) ?? null;
  if (client === null) {
    return null;
  }
  return {
    client,
    quotes: store.quotes.filter((row) => row.client_id === clientId),
    invoices: store.invoices.filter((row) => row.client_id === clientId),
    projects: store.projects.filter((row) => row.client_name === client.company_name),
  };
}

export type MarkableInvoiceStatus = Extract<InvoiceStatus, "sent" | "paid" | "overdue">;
export type MutableQuoteStatus = QuoteStatus;
