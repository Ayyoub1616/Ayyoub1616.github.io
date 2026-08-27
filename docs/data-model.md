# Modelo de datos

- `Reception`: referencia, transporte, palés previstos, estado y metadatos de versión.
- `Pallet`: código, recepción, conteos, artículo, operador, estado y ubicación.
- `Parcel`: lectura UUID, código único, artículo, unidades, operador y anomalía.
- `Location`: código único, zona, pasillo, módulo, nivel, hueco, capacidad y estado.
- `Movement`: tipo, palé, origen/destino, cantidad, motivo, operador y dispositivo.
- `Profile`: identidad externa, correo, rol, permisos y estado.
- `PendingOperation`: operación UUID, entidad, versión, dispositivo e intentos.

Las entidades operativas incluyen `createdAt`, `updatedAt`, `deletedAt` y `version`. Las anulaciones se representan mediante estado o movimientos compensatorios; no se elimina el histórico operativo.
