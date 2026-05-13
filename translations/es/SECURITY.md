# Política de seguridad

## Versiones compatibles

| Versión | Apoyado |
| ------- | ------------------ |
| principal | :white_check_mark: |

## Informar de una vulnerabilidad

Si descubre una vulnerabilidad de seguridad en cualquiera de las implementaciones de TLS en este repositorio, infórmelo a través de la pestaña **Avisos de seguridad** de GitHub en lugar de abrir un problema público.

1. Vaya a la pestaña **Seguridad** de este repositorio.
2. Haga clic en **Informar de una vulnerabilidad**
3. Proporcione una descripción clara de la vulnerabilidad, que incluya:
   - Qué archivo y función se ven afectados
   - Pasos para reproducir o una prueba de concepto.
   - Impacto potencial (por ejemplo, corrupción de la memoria, fuga de claves, omisión de autenticación)

## Cronograma de respuesta

- **Reconocimiento:** Dentro de los 30 días posteriores al envío
- **Evaluación:** Dentro de 90 días confirmaremos si el informe se acepta o rechaza
- **Solución:** Las vulnerabilidades aceptadas se repararán en un plazo de 360 días.

## Alcance

Los siguientes componentes están dentro del alcance de los informes de seguridad:

| Componente | Archivo | Idioma |
|-----------|------|----------|
| Analizador de capas de registros TLS | `ensamblado/tls_record_parser.asm` | x86_64 NASM |
| Validador de certificados TLS | `c/tls_cert_validator.c` | C |
| Selector de conjunto de cifrado TLS | `ir/tls_cipher.go` | Ir |
| Máquina de estado de protocolo de enlace TLS | `python/tls_handshake.py` | Pitón |
| Administrador de tickets de sesión TLS | `rust/tls_session.rs` | Óxido |

## Fuera de alcance

- Errores ya descritos en problemas abiertos de GitHub.
- Denegación de servicio por agotamiento de recursos
- Problemas en dependencias o bibliotecas de terceros.
- Ingeniería social

## Divulgación

Seguimos la divulgación coordinada. No divulgue públicamente las vulnerabilidades hasta que se haya publicado una solución.
