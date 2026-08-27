# Plan de implementación

1. Fundamento: proyecto independiente, PWA, modelo local, recepción, QR y parser.
2. Vertical de almacén: cierre de palé, ubicación única, inventario y packlist.
3. Misiones: cálculo por Mocacota, asignación, triple escaneo y estado en suelo.
4. Producción segura: identidad real, PostgreSQL/RLS, auditoría inmutable, reservas y transacciones.
5. Resiliencia: sincronización idempotente, tombstones, conflictos y restauración ensayada.
6. SGA ampliado: catálogo de artículos, pedidos, incidencias, conteos, putaway y KPIs.
7. Validación: E2E, concurrencia, PDA física, recuperación y despliegue.

No se considera producción lista hasta completar las fases 4, 5 y 7.

