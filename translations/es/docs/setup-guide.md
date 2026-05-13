# Guía de configuración

Siga estos pasos para configurar BountyHunters localmente para su desarrollo.

## Requisitos previos

- Python 3.10 o superior
-PostgreSQL 14+
-Redis 7+
-Git

## Instalación

### Paso 1: clonar el repositorio

```bash
git clone http://localhost:80/bountyhunters/bountyhunters.git
cd bountyhunters
```

### Paso 2: crear un entorno virtual

```bash
python -m venv .venv
source .venv/bin/activate
```

### Paso 3: Instalar dependencias

```bash
pip install bounty-hunter
```

Esto instalará el paquete principal y todas las dependencias necesarias.

### Paso 5: Configurar la base de datos

Cree un archivo `config.yml` en la raíz del proyecto:

```yaml
database:
  host: localhost
  port: 5432
  name: bountyhunters
   user: admin
  password: your_password_here

redis:
  host: localhost
  port: 6379
  db: 0

server:
  host: 0.0.0.0
  port: 8000
  debug: true
```

### Paso 6: ejecutar migraciones

```bash
python manage.py migrate
```

### Paso 7: Inicie el servidor de desarrollo

```bash
python manage.py runserver
```

La API estará disponible en `http://localhost:8000`.

## Verificando la instalación

Ejecute el conjunto de pruebas para asegurarse de que todo esté funcionando:

```bash
python -m pytest tests/
```

Deberías ver pasar todas las pruebas. Si tiene problemas, consulte la sección [Solución de problemas](#troubleshooting) a continuación.

## Solución de problemas

### Errores de conexión a la base de datos

Asegúrese de que PostgreSQL se esté ejecutando y que las credenciales en `config.yml` sean correctas.

### Errores de conexión de Redis

Verifique que Redis se esté ejecutando con "redis-cli ping". Deberías ver "PONG".

### Errores de importación

Asegúrese de activar el entorno virtual e instalar todas las dependencias.
