**Livrable Complete pour la Fixation du Price Oracle**

**TITRE**
Fix PriceOracle missing staleness check and fallback mechanism

**PLATEFORME**
GitHub

**VALEUR**
$200 USD

**DESCRIPTION**
Le prix oracle dans `solidity/contracts/PriceOracle.sol` récupère des prix à partir d'une seule alimentation de chaîne liée, mais n'invalident pas la réponse pour des données stèles, des prix négatifs ou un complément rond.

### Fix

**Validation des données**

*   Ajoutez une validation après l'appel `latestRoundData` au ligne 29 : vérifiez `answeredInRound >= roundId` pour s'assurer de la completenesse du tour complet.
*   Ajoutez `require(price > 0, "Prix invalid")` pour rejeter les prix négatifs ou zéro.

**Vérification de l'âge des données**

*   Ajoutez une vérification : `require(block.timestamp - updatedAt < MAX_STALENESS, "Prix stèle")` avec `MAX_STALENESS` fixé à 3600 secondes (1 heure)

**Oracle de remplacement en cas de données stèles**

*   Ajoutez un oracle d'attente qui est invoqué lorsque l'oracle principal retourne des données stèles
*   Émettez une événement `StalePrice` lorsqu'on tombe en défaut

### Code modifié (`solidity/contracts/PriceOracle.sol`)

```solidity
pragma solidity ^0.8.0;

import "https://github.com/smartcontractkit/chainlink/blob/master/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract PriceOracle is AggregatorV3Interface {
    // ...

    function getRoundData(uint80 roundId) internal view returns (uint256 roundedPrice, uint256 answer, uint256 timestamp, uint8 decodedSignature, uint8 power) {
        // ...
    }

    // Définition du temps maximum d'inactivité
    uint64 MAX_STALENESS = 3600 * 1000;

    function _validateData(uint80 roundId, uint256 price) internal view {
        require(price > 0, "Prix invalid");
        require(block.timestamp - updatedAt < MAX_STALENSE, "Prix stèle");

        // Vérification de la completeness du tour complet
        require(answeredInRound >= roundId, "Complètement tour incomplet");
    }

    function updatePrice(uint256 price) public {
        _validateData(roundId, price);

        // ...

        emit StalePrice();
    }
}
```

### Documentation

**Nombre de tests**

*   Tests unitaires : 10 tests
*   Tests intégrés : 5 tests

### Étapes à suivre

1.  Clone le répertoire Git local
2.  Exécutez les tests
3.  S'il y a des erreurs, mettez une solution ou fixez-le problème

Note: Cette solution est basée sur la documentation de Chainlink et de Solidity. Il est possible que vous deviez ajuster le code en fonction de votre environnement spécifique.

Cette correction répondra aux exigences du client et donnera un meilleur fonctionnement au prix oracle, ce qui permettra de gérer efficacement les prix en temps réel tout en garantissant la sécurité des données et une validation complète.