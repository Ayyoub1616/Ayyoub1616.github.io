# Arquitectura

## Capas

1. `app/page.tsx`: superficies operativas responsive.
2. `app/lib`: modelos, validación, almacenamiento local, operaciones y sincronización.
3. `app/api`: sesión, administración de perfiles y API de sincronización.
4. `db`: inicialización D1 y tipos de persistencia.
5. `public`: manifiesto, service worker e identidad PWA.

El dispositivo escribe primero en IndexedDB dentro de transacciones atómicas. Cada cambio crea una operación idempotente. La API conserva una representación JSON versionada por entidad y un diario de operaciones. Los perfiles y permisos viven solo en el servidor compartido.

## Límites de confianza

La interfaz puede ocultar acciones, pero no es una barrera de seguridad. La API identifica al usuario mediante cabeceras autenticadas del despliegue y comprueba estado/rol. Todo dato recibido vuelve a validarse. D1 es la fuente compartida y IndexedDB es la fuente inmediata offline del dispositivo.
