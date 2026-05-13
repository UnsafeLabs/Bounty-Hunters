# Guide de configuration

Suivez ces étapes pour configurer BountyHunters localement pour le développement.

## Prérequis

- Python 3.10 ou supérieur
- PostgreSQL 14+
-Redis 7+
-Git

##Installation

### Étape 1 : Cloner le référentiel

```bash
git clone http://localhost:80/bountyhunters/bountyhunters.git
cd bountyhunters
```

### Étape 2 : Créer un environnement virtuel

```bash
python -m venv .venv
source .venv/bin/activate
```

### Étape 3 : Installer les dépendances

```bash
pip install bounty-hunter
```

Cela installera le package principal et toutes les dépendances requises.

### Étape 5 : Configurer la base de données

Créez un fichier `config.yml` à la racine du projet :

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

### Étape 6 : Exécuter les migrations

```bash
python manage.py migrate
```

### Étape 7 : Démarrez le serveur de développement

```bash
python manage.py runserver
```

L'API sera disponible sur `http://localhost:8000`.

## Vérification de l'installation

Exécutez la suite de tests pour vous assurer que tout fonctionne :

```bash
python -m pytest tests/
```

Vous devriez voir tous les tests réussir. Si vous rencontrez des problèmes, consultez la section [Dépannage](#troubleshooting) ci-dessous.

## Dépannage

### Erreurs de connexion à la base de données

Assurez-vous que PostgreSQL est en cours d'exécution et que les informations d'identification dans `config.yml` sont correctes.

### Erreurs de connexion Redis

Vérifiez que Redis s'exécute avec `redis-cli ping`. Vous devriez voir « PONG ».

### Erreurs d'importation

Assurez-vous d'avoir activé l'environnement virtuel et installé toutes les dépendances.
