# Matriz de trazabilidad PalletFlow Producción V9

Estado verificado el 27/08/2026. “Preparado” significa código y prueba local listos, pendiente únicamente de desplegar. La promoción de datos reales requiere aprobación independiente.

| REQ | Requisito atómico | Código / migración | Prueba o evidencia | Estado |
|---|---|---|---|---|
| REQ-001 | Fuente reproducible en el repositorio autorizado | `package.json`, CI, `vercel.json` | typecheck, lint, unit, build | Verificado |
| REQ-002 | Frontend público sin datos reales | GitHub Pages + API remota | escaneo de secretos/datos | Verificado |
| REQ-003 | Autenticación real por usuario/contraseña | `api/session`, PBKDF2, sesión firmada | login público sin cookies | Verificado |
| REQ-004 | Roles admin/coordinador/operario en servidor | `access.ts`, `policy.ts` | `permissions.test.ts` | Verificado |
| REQ-005 | Operario/coordinador sin borrado directo | `policy.ts`, `api/trash` | pruebas 403/política | Verificado |
| REQ-006 | Impacto previo de contenedor/palé | `GET /api/trash` | conteos calculados desde servidor | Preparado |
| REQ-007 | Reautenticación, motivo e identificador exacto | `POST/PATCH /api/trash` | validación Zod + contraseña | Preparado |
| REQ-008 | Bloqueo por misión/reserva | `api/trash` | impacto `activeTasks/reservations` | Preparado |
| REQ-009 | Snapshot previo en almacenamiento privado | R2 `trash/<fecha>/<id>.json` | escritura antes de transacción | Preparado |
| REQ-010 | Soft delete transaccional e idempotente | `trash_actions`, D1 batch | clave única + tombstone | Preparado |
| REQ-011 | Liberar ubicación una sola vez | `location_claims` en D1 batch | idempotencia + índice único | Preparado |
| REQ-012 | Histórico/auditoría inmutables | `security_audit`, movimientos conservados | evento de papelera/restauración | Preparado |
| REQ-013 | Restauración con conflictos QR/ubicación | `PATCH /api/trash` | 409 o resolución `desubicar` | Preparado |
| REQ-014 | PDA offline no resucita tombstone | `api/sync` | rechazo de upsert sobre borrado | Preparado |
| REQ-015 | Papelera admin móvil/escritorio | `AdminTrash.tsx` | build responsive | Preparado |
| REQ-016 | Excel con 24 columnas Palés del ejemplo | `export-v9.ts` | `export-v9.test.ts` | Verificado |
| REQ-017 | Excel con 15 columnas Packing list del ejemplo | `export-v9.ts` | `export-v9.test.ts` | Verificado |
| REQ-018 | Tablas, autofiltros y fila congelada | `addSheet()` | todas las hojas inspeccionadas en test | Verificado |
| REQ-019 | Identificadores como texto | formato `@` por encabezado | código de bulto con cero inicial | Verificado |
| REQ-020 | Totales recalculados desde bultos | `build()` | resumen 14 uds fixture | Verificado |
| REQ-021 | Metadatos del snapshot/exportador/filtros | hoja `Metadatos` | test de hojas | Verificado |
| REQ-022 | Maestro corrupto excluido | filtro de caracteres corruptos | 167 filas detectadas en dry-run | Verificado |
| REQ-023 | Ubicaciones actuales sin retirados/papelera | `Ubicaciones actuales` | filtro de estado/tombstone | Verificado |
| REQ-024 | Movimientos, anomalías y auditoría | hojas V9 | test de hojas | Verificado |
| REQ-025 | Exportar contenedor | botón Recepciones + `exportContainerWorkbook` | build | Preparado |
| REQ-026 | Exportar palé | `exportPalletWorkbook` | build | Preparado |
| REQ-027 | Exportar histórico filtrado y columnas visibles | `HistoryExplorerV3` | filtros y resumen en vivo | Preparado |
| REQ-028 | Exportar layout actual | `exportLayoutWorkbook` | build | Preparado |
| REQ-029 | Exportar stock por mocacota | `exportStockWorkbook` | build | Preparado |
| REQ-030 | Exportación completa admin | `exportFullWorkbook` | test de 10 hojas | Verificado |
| REQ-031 | Importación real idempotente con hashes | scripts de migración/reconciliación | dry-run V9 | Verificado |
| REQ-032 | Conciliación 36/1.015/7.671 | informe privado dry-run | controles cuadran | Verificado |
| REQ-033 | Unidades corregidas 302.305 | informe privado dry-run | delta auditado +32 | Verificado |
| REQ-034 | Conflictos en cuarentena | reconciliador | 13 ubicaciones, 14 unidades inválidas | Verificado |
| REQ-035 | Promoción real sólo con aprobación | flag `requiresAdminApproval` | ninguna escritura en este dry-run | Bloqueado por aprobación |
| REQ-036 | Escaneo PDA/cámara/lector físico | cámara ZXing + Enter | pruebas/build previos | Verificado |
| REQ-037 | QR, ubicación y bulto únicos | tablas de reclamación D1 | restricciones únicas | Verificado |
| REQ-038 | Tiempo real/reconciliación | secuencia + resincronización automática | polling tolerante a reconexión | Parcial: objetivo <2 s pendiente |
| REQ-039 | Backup con checksum y R2 | `api/backup` | SHA-256 | Verificado |
| REQ-040 | Restauración de backup probada en staging | flujo existente | prueba integral pendiente | Pendiente |
| REQ-041 | Pedidos/reservas/misión multioperador | planificador y tareas existentes | unitarias parciales | Parcial |
| REQ-042 | E2E con tres sesiones y Playwright | — | — | Pendiente |
| REQ-043 | Accesibilidad y responsive PDA | estilos mobile-first | lint/build; QA manual pendiente | Parcial |
| REQ-044 | Publicación GitHub Pages + backend Sites | configuración existente | URL pública | Preparado |

## Puerta de datos reales

El dry-run no modifica producción. Antes de cualquier nueva promoción se crea una copia de seguridad, se vuelve a ejecutar la conciliación contra el snapshot actual y se requiere autorización explícita del propietario.
