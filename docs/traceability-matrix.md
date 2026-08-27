# Matriz de trazabilidad

| Requisitos | Módulo | Implementación/prueba | Estado |
|---|---|---|---|
| REQ-001–002 | Proyecto/PWA | estructura nueva, manifest, service worker, interfaz responsive | probado |
| REQ-003–008 | Seguridad | documentación y permisos UI; falta identidad/RLS/tombstones completos | en desarrollo |
| REQ-009–011 | Recepciones/etiquetas | `app/page.tsx`, `createReception`, impresión QR | probado |
| REQ-012–017 | Escaneo/cierre | `GuidedScanner`, `scanParcel`, `closePallet` | probado |
| REQ-018–020 | Parser | `app/lib/barcodes.ts`, `tests/barcodes.test.ts` | verificado |
| REQ-021–026 | Perfiles/anomalías | valores básicos y patrón; falta perfil versionado/antirrebote completo | en desarrollo |
| REQ-027–030 | Ubicación | `locatePallet`, pruebas de palé abierto y hueco ocupado | probado |
| REQ-031–034 | Maestro/layout | maestro local básico; faltan perfiles/versionado/layout completo | en desarrollo |
| REQ-035–037 | Búsqueda/selección | inventario y `planPallets` | probado |
| REQ-038–040 | Catálogo/reservas | diseño documentado; backend transaccional pendiente | pendiente |
| REQ-041–045 | Misiones | asignación, lista operario, triple escaneo, estado en suelo | implementado |
| REQ-046–047 | Offline/sync | IndexedDB, cola y botón sincronizar | probado |
| REQ-048 | Backups | copia manual/nube básica; política/dry-run pendiente | en desarrollo |
| REQ-049–050 | Excel | hojas Recepciones, Palés y Bultos; reconciliación ampliada pendiente | implementado |
| REQ-051 | Cámara/PDA | BarcodeDetector + ZXing + manual | implementado |
| REQ-052 | QA integral | 12 tests actuales; E2E/concurrencia/PDA pendientes | en desarrollo |

