# Estrategia de sincronización

Cada mutación local crea una operación UUID junto al cambio de IndexedDB. El cliente envía lotes de hasta 200 operaciones. El servidor ignora operaciones ya registradas, compara versiones y devuelve conflictos. Una operación confirmada sale de la cola; los errores conservan la operación para reintento.

La versión actual usa una política conservadora: una versión remota igual o mayor produce conflicto y no se sobrescribe. El usuario debe revisar esos casos. `deletedAt` actúa como tombstone. No hay sincronización en tiempo real ni resolución automática campo a campo.

El identificador del dispositivo se crea localmente una vez. No contiene identidad personal ni credenciales.
