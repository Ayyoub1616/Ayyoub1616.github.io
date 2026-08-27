import { describe,expect,it } from 'vitest';
import { parseBoxBarcode,planPallets } from '../app/lib/barcodes';
import type { Pallet } from '../app/lib/types';

describe('códigos y preparación',()=>{
  it('extrae mocacota y unidades con la regla del sistema original',()=>expect(parseBoxBarcode('84178016200200287')).toMatchObject({mocacota:'841780162002',units:28,valid:true}));
  it('interpreta las dos etiquetas reales confirmadas',()=>{expect(parseBoxBarcode('055844718000500609')).toMatchObject({mocacota:'055844718000',units:60,valid:true});expect(parseBoxBarcode('061470504073800285')).toMatchObject({mocacota:'061470504073',units:28,valid:true})});
  it('conserva ceros iniciales y rechaza unidades inválidas',()=>{expect(parseBoxBarcode('055844718000500609').mocacota).toBe('055844718000');expect(parseBoxBarcode('055844718000500009').valid).toBe(false)});
  it('propone los palés ubicados suficientes',()=>{const base={createdAt:'',updatedAt:'',deletedAt:null,version:1,receptionId:'r',status:'ubicado',article:'A',mocacota:'A',parcels:1,notes:'',operator:''} as const;const pallets=[{...base,id:'1',locationId:'l1',code:'P1',number:1,units:60},{...base,id:'2',locationId:'l2',code:'P2',number:2,units:50}] as Pallet[];const locations=[{id:'l1',code:'A-1'},{id:'l2',code:'A-2'}] as never[];const result=planPallets(pallets,locations,'A',100);expect(result.lines).toHaveLength(2);expect(result.total).toBe(110);expect(result.missing).toBe(0)});
  it('encuentra una combinación exacta y no devuelve parciales sin stock',()=>{const base={createdAt:'',updatedAt:'',deletedAt:null,version:1,receptionId:'r',status:'ubicado',article:'A',mocacota:'A',parcels:1,notes:'',operator:'',locationId:'l'} as const;const pallets=[40,60,75].map((units,i)=>({...base,id:String(i),code:`P${i}`,number:i,units})) as Pallet[];const locations=[{id:'l',code:'A-1'}] as never[];expect(planPallets(pallets,locations,'A',100,{strategy:'exacta'}).exact).toBe(true);expect(planPallets(pallets,locations,'A',500).lines).toHaveLength(0)});
});
