import { describe, expect, it } from 'vitest';
import { receptionInputSchema, safeCsvCell, scanInputSchema } from '../app/lib/validation';

describe('validación de entradas',()=>{
  it('rechaza una referencia vacía',()=>expect(()=>receptionInputSchema.parse({reference:'',receivedAt:'2026-08-25',expectedPallets:1,notes:''})).toThrow());
  it('rechaza códigos de bulto anómalos',()=>expect(()=>scanInputSchema.parse({code:'<script>',article:'A1',units:1})).toThrow());
  it('neutraliza fórmulas CSV',()=>expect(safeCsvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"'));
});
