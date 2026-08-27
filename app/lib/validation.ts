import { z } from 'zod';

export const receptionInputSchema = z.object({
  reference: z.string().trim().min(3, 'Indica una referencia de al menos 3 caracteres.').max(40),
  vehicle: z.string().trim().max(30).optional(),
  receivedAt: z.string().date(),
  expectedPallets: z.number().int().min(1).max(500),
  notes: z.string().trim().max(500),
});

export const scanInputSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9-]{6,40}$/i, 'El código debe tener de 6 a 40 letras, números o guiones.'),
  article: z.string().trim().min(2).max(40),
  mocacota: z.string().trim().min(2).max(40).optional(),
  color: z.string().trim().max(30).optional(),
  size: z.string().trim().max(20).optional(),
  units: z.number().int().min(1).max(100000),
});

export function safeCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
