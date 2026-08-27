# Especificación de ubicaciones

Perfil inicial `rack-guiones`:

`P-{MODULO}-{TRAMO}-{NIVEL}-{HUECO}`

Regex provisional: `^P-([A-Z][A-Z0-9]*)-(\d{3})-([A-Z])-([0-9]{3})$`.

El perfil `rack-compacto` conserva cadenas como `PM1001A201`, pero no se segmentará ni se considerará equivalente sin un maestro/alias autorizado. Una ubicación debe existir previamente, estar activa y no tener otro palé activo.

