# Politique de sécurité

## Versions prises en charge

| Version | Pris en charge |
| ------- | ------------------ |
| principal | :white_check_mark: |

## Signaler une vulnérabilité

Si vous découvrez une vulnérabilité de sécurité dans l'une des implémentations TLS de ce référentiel, veuillez la signaler via l'onglet **Avis de sécurité** de GitHub plutôt que d'ouvrir un problème public.

1. Accédez à l'onglet **Sécurité** de ce référentiel
2. Cliquez sur **Signaler une vulnérabilité**
3. Fournissez une description claire de la vulnérabilité, notamment :
   - Quel fichier et quelle fonction sont concernés
   - Des étapes de reproduction ou une preuve de concept
   - Impact potentiel (par exemple, corruption de mémoire, fuite de clé, contournement d'authentification)

## Délai de réponse

- **Reconnaissance :** Dans les 30 jours suivant la soumission
- **Évaluation :** Dans les 90 jours, nous confirmerons si le rapport est accepté ou refusé.
- **Correction :** Les vulnérabilités acceptées seront corrigées dans un délai de 360 jours

## Portée

Les composants suivants sont concernés par les rapports de sécurité :

| Composant | Fichier | Langue |
|-----------|------|----------|
| Analyseur de couche d'enregistrement TLS | `assembly/tls_record_parser.asm` | x86_64 NASM |
| Validateur de certificat TLS | `c/tls_cert_validator.c` | C |
| Sélecteur de suite de chiffrement TLS | `go/tls_cipher.go` | Aller |
| Machine d’état de prise de contact TLS | `python/tls_handshake.py` | Python |
| Gestionnaire de tickets de session TLS | `rust/tls_session.rs` | Rouille |

## Hors de portée

- Bugs déjà décrits dans les tickets ouverts de GitHub
- Déni de service par épuisement des ressources
- Problèmes dans les dépendances ou les bibliothèques tierces
- Ingénierie sociale

## Divulgation

Nous suivons une divulgation coordonnée. Veuillez ne pas divulguer publiquement les vulnérabilités tant qu'un correctif n'a pas été publié.
