# Registro de cambios

Todos los cambios notables en BountyHunters se documentarán en este archivo.

## [v3.0.0] - 2025-11-01

### Cambios importantes
- Se eliminaron los puntos finales de autenticación heredados.
- La versión mínima de Python aumentó a 3.10
- Se requiere migración del esquema de base de datos (consulte la guía de actualización)

### Agregado
- Soporte del proveedor OAuth2
- Notificaciones en tiempo real a través de WebSocket
- API de operaciones de recompensas masivas

### Fijo
- Pérdida de memoria en el proceso de trabajo en segundo plano.
- El limitador de velocidad no se reinicia correctamente a la medianoche UTC

## [v2.1.0] - 2025-08-15

### Agregado
- Recompensas de equipo con recompensas compartidas
- Exportar datos de recompensas a CSV
- Soporte de webhook para cambios de estado de recompensas

### Fijo
- La búsqueda no devuelve resultados para términos con guiones
- Error de cálculo de desplazamiento de paginación en consultas filtradas

## [v2.0.0] - 2025-09-30

### Cambios importantes
- El formato de respuesta API cambió a JSON: especificación API
- Los tokens de autenticación ahora caducan después de 24 horas.

### Agregado
- Nuevo sistema de gestión de reclamaciones.
- Plantillas de recompensa
- Puntuaciones de reputación del usuario.

### Fijo
- Se corrigió la vulnerabilidad XSS en las descripciones de recompensas.
- Manejo de zona horaria corregida para cálculos de fechas límite.

## [v1.2.0] - 2025-05-10

### Agregado
- Soporte de rebajas en descripciones de recompensas
- Notificaciones por correo electrónico para actualizaciones de reclamos
- Se agregó limitación de velocidad a todos los puntos finales.

### Fijo
- Se corrigió la paginación rota en el punto final de la lista de recompensas.
- Bucle de redireccionamiento de inicio de sesión en sesiones caducadas

## [v1.1.0] - 2025-03-20

### Agregado
- Función de búsqueda de recompensas
- Páginas de perfil de usuario
- Panel de análisis básico

### Fijo
- Se corrigió la creación de recompensas duplicadas al hacer doble clic.

## [v1.1.0] - 2025-03-20

### Agregado
- Función de búsqueda de recompensas
- Páginas de perfil de usuario
- Panel de análisis básico

### Fijo
- Se corrigió la creación de recompensas duplicadas al hacer doble clic.

## [v1.0.0] - 2025-01-15

### Agregado
- Lanzamiento inicial
- Operaciones CRUD de recompensa principal
- Autenticación y autorización de usuario.
- Flujo de trabajo básico de envío de reclamos

---

Para obtener instrucciones de actualización entre versiones principales, consulte la guía de actualización v2.0.1.
