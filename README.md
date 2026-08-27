# PalletFlow Warehouse

> **APLICACIÓN DE PRODUCCIÓN · PALLETFLOW ALMACÉN**

PWA responsive para gestionar recepciones, palés, bultos, ubicaciones, movimientos y extracciones. Está pensada primero para PDA y móvil, sin perder una vista de escritorio clara. Todo el contenido de demostración es ficticio.

## Funciones

- Panel operativo con indicadores y accesos rápidos.
- Recepciones con fecha, matrícula, creación automática de palés y etiquetas `P1…Pn`.
- Etiquetas QR para rollo de 100 × 64 mm o A4, con selección de rango e impresión al 100 %.
- Escaneo en directo mediante la cámara trasera, lector-teclado o entrada manual para QR, cajas y ubicaciones.
- Extracción configurable de mocacota y unidades desde el código de barras; total automático por palé.
- Patrón de caja aprendido del primer bulto, prevención de duplicados y confirmación de anomalías.
- Maestro de ubicaciones y flujo guiado palé → hueco.
- Extracciones completas o parciales e histórico inalterable.
- Inventario filtrable por mocacota, artículo, color y talla, y cálculo de los palés necesarios para cubrir unidades.
- Histórico camión → palé → caja, filtros por fechas y descarga del resultado filtrado.
- CSV, Excel y copias JSON.
- Funcionamiento offline con IndexedDB, cola idempotente y sincronización posterior.
- Acceso rápido por nombre de operario, recordado en cada dispositivo.
- `Ayyoub` obtiene el modo manager; los demás nombres reciben el modo operario sin controles destructivos.
- Copias completas en la nube mediante botones separados para subir y bajar el trabajo.

## Arquitectura

La interfaz React se ejecuta como PWA. Dexie/IndexedDB conserva el estado operativo inmediato de cada dispositivo. La API valida la identidad recibida del proveedor de acceso, aplica permisos y sincroniza entidades con una base D1 compartida. Cada entidad y operación tiene UUID, versión y marcas temporales. Consulta [docs/architecture.md](docs/architecture.md).

## Desarrollo

Requiere Node 22 y pnpm.

```bash
pnpm install
pnpm run dev
```

Verificaciones:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

## Funcionamiento offline

El service worker guarda el shell de la aplicación tras la primera visita. Las operaciones se escriben inmediatamente en IndexedDB y se añaden a una cola local. Al recuperar conexión, `Sincronizar` envía operaciones idempotentes y descarga cambios remotos. No se afirma sincronización en tiempo real: los cambios se incorporan al sincronizar.

## Usuarios y seguridad

El acceso solicitado para esta versión es deliberadamente sencillo: sólo pide el nombre y no utiliza correo ni ChatGPT. `Ayyoub` activa el modo manager y cualquier otro nombre activa el modo operario. Esto reduce pasos en una PDA, pero no constituye autenticación segura: una persona que escriba `Ayyoub` obtendrá esos permisos. Para un despliegue real debe añadirse al menos un PIN de manager o un proveedor de identidad.

Las entradas se validan con Zod; no se usa `innerHTML`; las exportaciones neutralizan fórmulas CSV/Excel; la restauración JSON se valida y descarga una copia previa. No almacenes datos empresariales reales en esta versión de laboratorio.

## Copias y restauración

En `Datos` se puede descargar un JSON completo. Antes de restaurar otra copia, la aplicación descarga automáticamente una copia del estado actual. Solo acepta el formato y la versión esperados.

## Datos ficticios

`Cargar demostración` añade recepciones, palés, bultos, ubicaciones y movimientos simulados, todos marcados como demo. `Borrar demostración` elimina únicamente esos registros.

## Despliegue

El proyecto usa Sites porque el control de usuarios y la base compartida necesitan ejecución de servidor; GitHub Pages por sí solo solo admite contenido estático y no puede proteger estas operaciones. El código fuente puede mantenerse en GitHub y la aplicación se publica con Sites.

## Limitaciones

- La lectura de cámara depende de las capacidades y permisos del navegador; siempre existe entrada manual.
- La sincronización es explícita, no en tiempo real.
- No se implementa reapertura de recepciones cerradas.
- No existe una integración con ERP/WMS externo.
- Es un entorno de pruebas, no una instalación productiva certificada.

No se incluye licencia abierta hasta que el propietario elija una.
