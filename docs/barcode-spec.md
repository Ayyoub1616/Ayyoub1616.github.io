# Especificación provisional de código de bulto

Perfil inicial `NNN-bulto-18-v3`:

- Mocacota: `normalized.slice(0, 12)`.
- Unidades: `normalized.slice(-3, -1)`.
- El último dígito se conserva y no se interpreta todavía como checksum.
- Un error de parseo o unidades `0` no suma stock.

Casos de regresión:

| Entrada | Mocacota | Uds. |
|---|---|---:|
| `055844718000500609` | `055844718000` | 60 |
| `061470504073800285` | `061470504073` | 28 |
| `84178016200200287` | `841780162002` | 28 |

La interfaz permite cambiar los tres parámetros, probar una etiqueta y ver el resultado antes de guardar. El perfil versionado en servidor sigue pendiente de la fase de producción segura.

