# Pautas de contribución

Gracias por su interés en contribuir a este proyecto. Lea esta guía detenidamente antes de enviar cualquier solicitud de extracción.

## Programa de recompensas

Cada problema de GitHub describe un error o una solicitud de función con una etiqueta de recompensa (por ejemplo, `$1`). Los montos de las recompensas varían según la complejidad del problema. Las recompensas se pagan al fusionarse.

## Normas

### Un problema por solicitud de extracción

Cada solicitud de extracción debe abordar **exactamente un** problema de GitHub. No combine correcciones para varios problemas en un solo PR. Los RP que afecten a más de un tema se cerrarán sin revisión.

**Bien:** Un PR titulado "Solucionar el desbordamiento de enteros check_expiry()" que aborda solo el problema n.º 7.

**Malo:** Un PR que soluciona tanto el problema 7 como el 12 en un solo envío.

### Reclama antes de comenzar

Comenta sobre el problema de GitHub en el que deseas trabajar antes de comenzar. Esto evita la duplicación de esfuerzos. Los RP no reclamados perderán su prioridad. Los reclamos caducan después de **48 horas** de inactividad.


### Confirmar mensajes

Utilice el formato [Compromisos convencionales](https://www.conventionalcommits.org/):

```
fix(c): use constant-time comparison in match_fingerprint

Replaces memcmp() with CRYPTO_memcmp() to prevent timing
side-channel attacks on certificate fingerprint validation.

Closes #<issue-number>
```

### Sólo cambios de código

Su PR debe contener **solo** los cambios de código necesarios para satisfacer los criterios de aceptación enumerados en la edición de GitHub. No:

- Refactorizar el código circundante
- Actualizar documentación o comentarios no relacionados con la solución.
- Cambiar el nombre de las variables o reformatear archivos
- Agregar dependencias a menos que la solución lo requiera absolutamente
- Modificar archivos de origen fuera de la carpeta del idioma de destino

### Se requieren pruebas

Cada PR debe incluir pruebas que cubran la solución o característica. Los criterios de aceptación en cada número enumeran las condiciones exactas que sus pruebas deben verificar. Los RP sin pruebas no se fusionarán.

### Haga coincidir el idioma y el estilo

Escriba código que coincida con el estilo existente del archivo que está modificando. No introduzca nuevas convenciones de formato, reglas de linting o patrones estructurales.

## Plantilla de solicitud de extracción

La descripción de su PR debe incluir:

1. **Problema:** Qué problema aborda (por ejemplo, "Cierra el número 14")
2. **Resumen:** Una o dos oraciones que describen lo que cambiaste
3. **Lista de verificación de criterios de aceptación:** Copie los criterios de aceptación del problema y márquelos cada uno.

Ejemplo:

```markdown
## Issue
Closes #14

## Summary
Generate a fresh random nonce for each call to encrypt_ticket() instead
of reusing the hardcoded ENCRYPTION_NONCE constant.

## Acceptance criteria
- [x] encrypt_ticket() generates a unique 12-byte nonce per call
- [x] Two consecutive encryptions of the same ticket produce different ciphertext
- [x] All existing tests still pass
- [x] Add new tests covering the fixed bugs
```

## Proceso de revisión

1. Los RP se revisan en el orden en que se reciben.
2. Es posible que reciba comentarios solicitando cambios; responda dentro de **48 horas** o se cerrará el PR
3. Solo se fusionarán los RP que cumplan **todos** los criterios de aceptación.
4. La recompensa se paga después de que el PR se fusiona con "principal".

## Estructura de carpetas

```
assembly/    x86_64 NASM — TLS record layer parser
c/           C — TLS certificate chain validator
go/          Go — TLS cipher suite selector
python/      Python — TLS handshake state machine
rust/        Rust — TLS session ticket manager
```

Cada carpeta contiene un archivo fuente relacionado con la implementación del protocolo TLS.

## Código de conducta

Sea respetuoso. Las relaciones públicas no deseadas, los envíos que requieran poco esfuerzo o los intentos de engañar al sistema de recompensas resultarán en una prohibición.
