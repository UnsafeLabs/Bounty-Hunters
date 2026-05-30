Faisabilité autonome : Oui (API git existante)

Livrables :
- Icône verrou dans BranchToolbar pour indiquer le statut de protection
- Désactivation force-push pour les branches protégées
- Popup warning avant push pour les utilisateurs non autorisés

Approche :

1) Récupérer règles via API git existante pour les branches spécifiques et stocker dans une base de données locale.
2) Utiliser un mécanisme d'authentification pour vérifier l'accès des utilisateurs avant chaque push.
3) Intégrer l'icône avec la vérification d'accès pour bloquer les actions non autorisées.
4) Développer une fonctionnalité de force-push prevention en verifiant si le repository est sous controle avant permettre le push.

Tests unitaires et intégration pour chaque composant du système, incluant l'authentification, la récupération des règles et l'intégration avec les icônes.