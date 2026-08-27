# Requisitos atómicos de PalletFlow V2

Fuente: especificación `PROMPT_MAESTRO_PALLETFLOW_V2.md`. Este inventario separa la primera vertical operativa de las ampliaciones de producción.

## Identidad, seguridad y permisos

- REQ-001: proyecto original e independiente, sin código, secretos, datos ni historial de `reingzgz/rack`.
- REQ-002: PWA mobile-first para PDA Android, móvil y escritorio.
- REQ-003: autenticación y autorización reales en servidor para producción.
- REQ-004: roles admin, operador y base extensible para supervisor.
- REQ-005: operador sin borrado, reapertura, sustitución de QR ni corrección histórica.
- REQ-006: acciones sensibles con motivo, confirmación reforzada y auditoría.
- REQ-007: borrado lógico restaurable y tombstones que prevalecen sobre copias offline antiguas.
- REQ-008: secretos únicamente en variables de entorno; nunca en cliente, Git o backups.

## Recepción, QR y grabación

- REQ-009: crear recepción con referencia, matrícula/transporte, fecha y palés previstos.
- REQ-010: generar exactamente N palés y etiquetas QR únicas P1…PN.
- REQ-011: etiquetas imprimibles en 100 × 64 mm y A4 con recepción, fecha y matrícula.
- REQ-012: escanear primero QR de palé registrado y autorizado.
- REQ-013: indicar bultos previstos y escanear cajas continuamente.
- REQ-014: persistir cada lectura inmediatamente con usuario, dispositivo y fecha.
- REQ-015: cerrar palé con cualquier cantidad positiva, incluido 1 o 2 bultos.
- REQ-016: impedir nuevas lecturas en un palé cerrado; reapertura solo admin.
- REQ-017: contabilizar bultos y unidades desde eventos válidos, sin contadores paralelos.

## Parser y calidad de lectura

- REQ-018: normalizar solo controles, CR/LF y espacios exteriores configurados.
- REQ-019: perfil provisional: primeros 12 caracteres = Mocacota.
- REQ-020: perfil provisional: dos dígitos desde tres posiciones del final = unidades.
- REQ-021: conservar código bruto, normalizado, perfil y versión usados.
- REQ-022: rechazar unidades ausentes, cero o fuera de rango; nunca convertir error en stock.
- REQ-023: perfiles versionados por proveedor/tipo con prueba previa y regresión.
- REQ-024: primer bulto fija patrón observado; discrepancias se detienen o quedan como anomalía auditada.
- REQ-025: primera Mocacota fija el palé; mezcla requiere confirmación excepcional y motivo.
- REQ-026: antirrebote de lector/cámara y detección de doble disparo.

## Ubicaciones e inventario

- REQ-027: solo se ubican palés cerrados y aptos.
- REQ-028: secuencia palé → ubicación → validación → confirmación transaccional.
- REQ-029: una ubicación activa admite como máximo un palé activo.
- REQ-030: un palé activo ocupa como máximo una ubicación.
- REQ-031: ubicaciones deben existir y estar activas en un maestro.
- REQ-032: perfiles versionados `rack-guiones` y `rack-compacto`, sin equivalencias implícitas.
- REQ-033: conservar código bruto, canónico, perfil, componentes y orden de ruta.
- REQ-034: layout vivo con ocupados, libres, reservados, bloqueados e incidencias.

## Stock, pedidos y misiones

- REQ-035: buscar por referencia, Mocacota, bulto, palé, recepción, ubicación y estado.
- REQ-036: mostrar stock físico, disponible, reservado, bloqueado y abierto por separado.
- REQ-037: calcular palés concretos para cubrir unidades con exacto/sobrante/faltante.
- REQ-038: catálogo explícito entre referencia comercial y Mocacotas equivalentes.
- REQ-039: comparar estrategias mejor ajuste, menos palés, FIFO/FEFO y mejor ruta.
- REQ-040: reservar y crear orden/tareas en una operación atómica e idempotente.
- REQ-041: asignar misión a operario sin duplicar palés entre órdenes.
- REQ-042: extracción obligatoria ubicación → palé esperado → misma ubicación.
- REQ-043: error de escaneo no avanza la misión.
- REQ-044: completar tarea libera ubicación y deja palé en suelo/histórico.
- REQ-045: admin ve progreso y operador ve solo la siguiente acción necesaria.

## Offline, copias, exportación y operación

- REQ-046: IndexedDB, cola offline, sincronización idempotente y conflictos explícitos.
- REQ-047: botón único de sincronización para operador; administración separada de backups.
- REQ-048: backup diario, preoperación, cifrado, retención y restauración con dry-run.
- REQ-049: Excel reconciliable con Recepciones, Palés, Packing list/Bultos y resúmenes.
- REQ-050: códigos exportados como texto conservando ceros iniciales y sin fórmulas inyectables.
- REQ-051: cámara y lector físico compatibles con Chrome/Firefox y entrada manual controlada.
- REQ-052: pruebas unitarias, integración, E2E, offline, concurrencia, seguridad y viewport PDA.

