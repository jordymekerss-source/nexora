function padSequence(value: number): string {
  return String(value).padStart(3, "0");
}

function nextSequenceFromNumbers(numbers: readonly string[], prefix: string, year: number): number {
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let max = 0;
  for (const number of numbers) {
    const match = pattern.exec(number);
    if (match === null) {
      continue;
    }
    const seq = Number.parseInt(match[1] ?? "0", 10);
    if (Number.isFinite(seq) && seq > max) {
      max = seq;
    }
  }
  return max + 1;
}

export function buildDocumentNumber(prefix: "OFF" | "FAC", year: number, sequence: number): string {
  return `${prefix}-${year}-${padSequence(sequence)}`;
}

export function nextQuoteNumber(existingNumbers: readonly string[], now = new Date()): string {
  const year = now.getFullYear();
  const sequence = nextSequenceFromNumbers(existingNumbers, "OFF", year);
  return buildDocumentNumber("OFF", year, sequence);
}

export function nextInvoiceNumber(existingNumbers: readonly string[], now = new Date()): string {
  const year = now.getFullYear();
  const sequence = nextSequenceFromNumbers(existingNumbers, "FAC", year);
  return buildDocumentNumber("FAC", year, sequence);
}
