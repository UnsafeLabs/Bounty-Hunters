# Lignes directrices de contribution

Merci de votre intérêt à contribuer à ce projet. Veuillez lire attentivement ce guide avant de soumettre des demandes de tirage.

## Programme de primes

Chaque problème GitHub décrit une demande de bogue ou de fonctionnalité avec une étiquette de prime (par exemple, « $1 »). Les montants des primes varient en fonction de la complexité du problème. Les primes sont payées lors de la fusion.

## Règles

### Un problème par demande de tirage

Chaque demande d'extraction doit résoudre **exactement un** problème GitHub. Ne combinez pas les correctifs de plusieurs problèmes dans un seul PR. Les PR qui touchent plus d’un problème seront fermés sans examen.

**Bon :** Un PR intitulé "Correction du dépassement d'entier check_expiry()" qui résout uniquement le problème n°7.

**Mauvais :** Un PR qui corrige à la fois le problème n°7 et le problème n°12 en une seule soumission.

### Réclamez avant de commencer

Commentez le problème GitHub sur lequel vous souhaitez travailler avant de commencer. Cela évite les efforts en double. Les PR non réclamés seront dépriorisés. Les réclamations expirent après **48 heures** d'inactivité.


### Messages de validation

Utilisez le format [Conventional Commits](https://www.conventionalcommits.org/) :

```
fix(c): use constant-time comparison in match_fingerprint

Replaces memcmp() with CRYPTO_memcmp() to prevent timing
side-channel attacks on certificate fingerprint validation.

Closes #<issue-number>
```

### Modifications de code uniquement

Votre PR doit contenir **uniquement** les modifications de code requises pour satisfaire aux critères d'acceptation répertoriés dans le problème GitHub. Ne pas:

- Refactoriser le code environnant
- Mettre à jour la documentation ou les commentaires sans rapport avec le correctif
- Renommer les variables ou reformater les fichiers
- Ajouter des dépendances sauf si cela est absolument requis par le correctif
- Modifier les fichiers sources en dehors du dossier de langue cible

### Des tests sont requis

Chaque PR doit inclure des tests qui couvrent le correctif ou la fonctionnalité. Les critères d'acceptation dans chaque numéro énumèrent les conditions exactes que vos tests doivent vérifier. Les PR sans tests ne seront pas fusionnés.

### Faites correspondre la langue et le style

Écrivez du code qui correspond au style existant du fichier que vous modifiez. N'introduisez pas de nouvelles conventions de formatage, règles de peluchage ou modèles structurels.

## Modèle de demande de tirage

Votre description de PR doit inclure :

1. **Problème :** Quel problème cela résout (par exemple, « Ferme # 14 »)
2. **Résumé :** Une ou deux phrases décrivant ce que vous avez modifié
3. **Liste de contrôle des critères d'acceptation :** Copiez les critères d'acceptation du problème et cochez chacun d'eux.

Exemple:

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

## Processus de révision

1. Les PR sont examinées dans l'ordre dans lequel elles sont reçues
2. Vous pouvez recevoir des commentaires demandant des modifications. Veuillez répondre dans les **48 heures**, sinon le PR sera fermé.
3. Seuls les PR qui satisfont **à tous** les critères d'acceptation seront fusionnés
4. La prime est payée après la fusion du PR dans « principal »

## Structure des dossiers

```
assembly/    x86_64 NASM — TLS record layer parser
c/           C — TLS certificate chain validator
go/          Go — TLS cipher suite selector
python/      Python — TLS handshake state machine
rust/        Rust — TLS session ticket manager
```

Chaque dossier contient un fichier source lié à la mise en œuvre du protocole TLS.

## Code de conduite

Soyez respectueux. Les spams PR, les soumissions sans effort ou les tentatives de contourner le système de primes entraîneront une interdiction.
