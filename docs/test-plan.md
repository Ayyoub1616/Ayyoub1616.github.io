# Plan de pruebas

- Unitarias: parser, normalización, totales, selección de palés y transiciones.
- Integración: recepción, cierre, ubicación única, extracción, cola y API.
- Seguridad: permisos directos, RLS, borrado lógico, reautenticación y auditoría.
- Concurrencia: doble ubicación, doble reserva y doble finalización de tarea.
- Offline: reintento idempotente, orden de cambios, tombstones y conflictos.
- E2E: recepción → QR → cajas → cierre → ubicación → orden → triple escaneo.
- Dispositivo: Chrome/Firefox en PDA, lector teclado, cámara, vibración y PWA.
- Recuperación: checksum, dry-run y restauración en entorno aislado.

Estado actual: 12 pruebas automatizadas aprobadas. Faltan RLS, concurrencia, E2E y PDA física.

