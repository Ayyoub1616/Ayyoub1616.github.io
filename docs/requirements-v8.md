# Matriz de requisitos PalletFlow Producción V8

| Requisito | Implementación | Prueba/evidencia | Estado |
|---|---|---|---|
| REQ-001 Fuente reproducible y CI | `package.json`, workflow CI/Pages | typecheck, lint, test, build, audit | Implementado |
| REQ-002 Datos privados fuera de GitHub | D1/R2 y `.private/` ignorado | escaneo de archivos versionados | Implementado |
| REQ-003 Autenticación real | `app_users`, PBKDF2 y sesión firmada | pruebas de API pendientes de entorno | Implementado, falta alta inicial |
| REQ-004 Roles efectivos | política de servidor admin/coordinador/operario | `permissions.test.ts` | Implementado |
| REQ-005 Unicidad concurrente | tablas de reclamación QR/bulto/ubicación | conflicto D1 transaccional | Implementado |
| REQ-006 Auditoría inmutable | `security_audit` y auditoría de entidades v3 | schema y eventos | Parcial |
| REQ-007 Modelo v3 aditivo | tipos, Dexie v3 y migración | copia real sin alterar totales | Implementado |
| REQ-008 Importación idempotente | reconciliador con hashes y dry-run | informe V8 | Implementado; promoción bloqueada por aprobación |
| REQ-009 Maestro corrupto | cuarentena y reconstrucción verificable | 167 filas en cuarentena | Implementado |
| REQ-010 Recepciones editables | alta, edición, aumento/reducción segura | `warehouse.test.ts` | Implementado |
| REQ-011 Escáner PDA | Enter, foco, antirrebote, audio/vibración | unitarias y build | Implementado |
| REQ-012 OCR offline | Tesseract cargado bajo demanda y cache PWA | build cliente | Implementado |
| REQ-013 Reglas versionadas | entidad central sincronizada | parser unitario | Implementado |
| REQ-014 Layout vivo | ubicación única, capacidad, mapa de calor | test de hueco ocupado | Implementado |
| REQ-015 Picking avanzado | exacta, sobrante, menos palés y ruta | `barcodes.test.ts` | Implementado |
| REQ-016 Misiones guiadas | ubicación → palé → confirmación | flujo existente | Implementado básico |
| REQ-017 Tiempo real | SSE con sequence y reconexión | build/API | Implementado |
| REQ-018 Offline-first | IndexedDB, cola idempotente, tombstones | pruebas existentes | Parcial |
| REQ-019 Excel real | 9 hojas `.xlsx` | typecheck/build | Implementado |
| REQ-020 Histórico multinivel | contenedor → palé → bulto, filtros/contadores | UI | Implementado |
| REQ-021 Fotos privadas | R2 y metadatos D1 | API autenticada | Implementado |
| REQ-022 Backups comprobables | R2, SHA-256 y restauración | API y dry-run | Parcial |
| REQ-023 Conteos cíclicos | recuento por pasillo con diferencias | API coordinador/admin | Implementado básico |
| REQ-024 KPIs y alertas | ocupación, anomalías, retrasos, productividad | dashboard | Implementado básico |
| REQ-025 QR/PDF | rollo 100×64, A4 y albarán PDF | build cliente | Implementado |
| REQ-026 API/webhook | stock con API key y cierre de contenedor | rutas servidor | Implementado |
| REQ-027 GitHub Pages | workflow desde `main` | despliegue pendiente | Preparado |
| REQ-028 Verificación PDA/escritorio | pruebas públicas | pendiente de despliegue | Pendiente |
