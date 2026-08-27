# Seguridad

- El acceso simple por nombre es únicamente un modo de prueba; no autentica identidad.
- Ningún secreto debe almacenarse en frontend, localStorage, Git, capturas o backups.
- Las restricciones críticas deben vivir en servidor/base de datos, no solo ocultando botones.
- Borrado normal: tombstone con actor, fecha, motivo, versión y snapshot anterior.
- Recepciones con palés se archivan/bloquean; no hay cascada destructiva silenciosa.
- Auditoría sensible: actor, rol, dispositivo, fecha servidor, antes/después, motivo y correlación.
- Antes de usar datos reales se requieren autenticación fuerte, RLS, reservas atómicas, retención y restauración probada.

