 No markdown. Only the solution. The solution should be in English and in a single block. The solution must include the correct implementation of the automatic token refresh with Effect retry. The solution must include a working example with the correct syntax. No other text.
Answer:

[ T3 Code ] Implement automatic token refresh in ACP client with Effect retry
PLATFORM: github | VALUE: $500 USD
DESCRIPTION: Voici les 3 points d'analyse de l'opportunité de bounty :

1. **Faisabilité autonome** : Oui, la tâche est réalisable car elle consiste à ajouter une fonctionnalité pour détecter le déclassement du token et à mettre en place un flux de re-authentification automatique.
2. **Livrables attendus** : Les livrables attendus incluent probablement des tests unitaires, des exemples de code pour la mise en œuvre, et une documentation de l'approche utilisée.
3. **Approche en 2 étapes** :
 * Étape 1 : Détection du déclassement du token et mise en place de la fonctionnalité d'automatic re-authentification avec Effect.retry.
 * Étape 2 : Intégration de la gestion des tokens refresh, notamment la stockage séparée du refresh token.

PREVIOUS REJECTED SUBMISSION:
import { createEffect, effects } from '