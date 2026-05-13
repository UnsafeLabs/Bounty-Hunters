# Referencia de API

URL base: `http://localhost:80/v1`

## Autenticación

Todas las solicitudes requieren un token de portador en el encabezado "Autorización".

```
Authorization: Bearer <your-api-key>
```

## Puntos finales

### Lista de recompensas

```
GET /bounties
```

Devuelve una lista paginada de todas las recompensas disponibles.

**Parámetros**

| Nombre | Tipo | Requerido | Descripción |
|----------|--------|----------|--------------------------|
| página | entero | No | Número de página (predeterminado: 1) |
| por_página | entero | No | Artículos por página (máx.: 50) |
| estado | cadena | No | Filtrar por estado |

**Respuesta**

```json
{
  "data": [
    {
      "id": "b_123",
      "title": "Fix login bug",
      "reward": 500,
      "status": "open"
    }
  ],
  "total": 42,
  "page": 1
}
```

### Crear recompensa

```
GET /bounties
```

Crea una nueva lista de recompensas.

**Cuerpo de la solicitud**

```json
{
  "title": "Fix authentication flow",
  "description": "OAuth2 redirect is broken on mobile",
  "reward": 750,
  "labels": ["bug", "auth"]
}
```

**Respuesta**

```json
{
  "id": "b_124",
  "title": "Fix authentication flow",
  "status": "open",
  "created_at": "2025-09-14T12:00:00Z"
}
```

### Obtener detalles de la recompensa

```
GET /bounties/:id
```

Devuelve todos los detalles de una sola recompensa.

### Enviar reclamo

```
POST /bounties/:id/claims
```

Presentar un reclamo contra una recompensa. Consulte [Ciclo de vida del reclamo](#claim-lifecycle) para ver las transiciones de estado.

**Cuerpo de la solicitud**

```json
{
  "pr_url": "http://localhost:80/org/repo/pull/42",
  "notes": "Fixed the redirect issue by updating the callback URL validation"
}
```

## Límites de tarifas

Todos los puntos finales tienen velocidad limitada. Límites actuales:

| Punto final | Método | Límite de tarifa |
|-------------------|--------|------------------|
| /recompensas | OBTENER | 100 solicitudes/min |
| /recompensas | PUBLICAR | 10 solicitudes/min |
| /recompensas/:id | OBTENER | 100 solicitudes/min |
  /recompensas/:id/reclamaciones | PUBLICAR | 5 solicitudes/min |

## Códigos de error

| Código | Descripción |
|------|---------------------------|
| 400 | Solicitud incorrecta |
| 401 | No autorizado |
| 404 | No encontrado |
| 429 | Límite de tarifa excedido |
| 500 | Error interno del servidor |

## SDK

- [SDK de Python](http://localhost:80/bountyhunters/python-sdk)
- [SDK de Node.js](http://localhost:80/bountyhunters/node-sdk)
