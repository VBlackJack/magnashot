# MagnaShot : édition Physique Magnétique

*Read this in [English](README.md).*

[![Jouer en ligne](https://img.shields.io/badge/Jouer_en_ligne-GitHub_Pages-38bdf8?style=for-the-badge&logo=github)](https://vblackjack.github.io/magnashot/)
[![Licence](https://img.shields.io/badge/Licence-Apache_2.0-blue.svg?style=for-the-badge)](http://www.apache.org/licenses/LICENSE-2.0)

**Jeu en ligne :** [https://vblackjack.github.io/magnashot/](https://vblackjack.github.io/magnashot/)

**MagnaShot** est un jeu de tir de bulles à physique magnétique, sans aucune dépendance externe à l'exécution : attraction et répulsion magnétiques dynamiques, rotors à inertie, portails quantiques, vortex de singularité et sphères spéciales.

---

## Fonctionnalités

- **Physique magnétique dynamique** : les sphères de même couleur s'attirent, les pôles opposés (les paires de couleurs `N`/`S`, `Ξ`/`Π`, `Ω`/`Φ`) se rapprochent, et les pôles identiques courbent la trajectoire du projectile. Répulseurs et attracteurs courbent les tirs et font aussi pencher les amas suspendus, à l'écart ou vers eux.
- **Visée tactique et prévisualisation** :
  - Viseur laser néon courbe avec défilement animé, halo lumineux et pastilles aux points de rebond sur les murs, obstacles et portails.
  - Prévisualisation en temps réel de la zone d'effet des 7 sphères spéciales (Bombe, Foudre, Prisme, Enclume, Cryo, Fusée, Pinceau).
  - Prédiction de l'**avalanche magnétique** : les sphères qui tomberont une fois leurs liens supérieurs rompus sont mises en évidence.
- **15 Modes de jeu (menu burger `☰`, pilule HUD `▾` et cartes de modes)** :
  - **Campagne** : 24 niveaux conçus à la main, qui introduisent pendules, rotors à inertie, répulseurs, barrières oscillantes, verrous quantiques, portails liés, Noyaux Boss, ancres neutres qu'aucun groupe ne brise, sphères enchaînées, bulles, coeurs de givre, de foudre et de peinture, ancres sur rail, propulseurs, longues amarres et rouille. Puis 800 niveaux générés (25 à 824), en 20 chapitres de 40 : les 12 premiers autour d'une de ces mécaniques, les 8 derniers autour d'une paire. Plus de couleurs, de sphères et de modificateurs, et moins de tirs en réserve au fil des niveaux. Chaque série de 10 niveaux mêle les formats : des niveaux standard, deux variantes qui ajoutent une mécanique d'un autre chapitre, un niveau de précision (petit plateau, peu de tirs et une seule bombe), un niveau arsenal (grand plateau, moins de tirs et deux fois plus de sphères spéciales) et un niveau marquant (une forme dessinée ou une paire, et un Noyau Boss). Le nom d'un niveau et son badge sur la carte (`Boss`, `Précision`, `Arsenal`, `Variante`) indiquent son format. Chaque niveau se reconstruit depuis son seul numéro. La sélection des niveaux montre un chapitre à la fois, avec les étoiles gagnées dans chacun, s'ouvre sur le chapitre en cours, et propose un filtre `< 3★` pour n'afficher que les niveaux déverrouillés incomplets (lorsqu'il est actif, le bouton principal de l'écran de victoire passe aussi directement au prochain niveau `< 3★`).
  - **Survie (sans fin)** : défense par vagues infinies, avec vagues de ruée vers l'or et anomalies Boss. Une nouvelle vague descend quand la **jauge d'affaissement** est pleine (voir plus bas).
  - **Jauge d'affaissement (Survie, Défi du jour et Puriste)** : une jauge segmentée dans le HUD, doublée d'une jauge à côté du lanceur, montre à quel point l'amas est près de s'affaisser. Chaque tir qui ne retire rien (un tir raté, un tir qui sort du plateau, une sphère spéciale qui ne touche rien) remplit un segment ; une combinaison la laisse telle quelle, et une avalanche causée par votre tir qui fait tomber quatre sphères ou plus la fait remonter d'un cran (trois ou plus, jusqu'à deux segments, en Puriste) ; les avalanches de réaction en chaîne ou de liens rompus pendant le vol d'un tir ne la vident pas, et un tir sans combinaison qui provoque tout de même une avalanche ne compte plus comme un raté. Quand elle est pleine, tout l'amas descend d'un cran (une nouvelle vague en Survie et au Défi du jour, le rail en Puriste) et la jauge se vide. Un raté avant cela, la jauge passe à l'ambre avec un contour en pointillés, la boîte du HUD pulse (de façon fixe en mouvements réduits) et une annonce polie est faite une fois par cycle ; pleine, le contour est épais et rouge avec un chevron : l'état ne repose jamais sur la seule couleur. La jauge a le rôle `role="meter"` avec une valeur lue à voix haute, un grincement et une secousse marquent la chute (pas de secousse en mouvements réduits), et un tour sous Gel ne la remplit pas. La Campagne, le Puzzle, le Blitz, la Cascade, le Flux, le Boss Rush, la Grille Hex, le Flipper Magnétique, le Spin Orbital, le Convoi Magnétique et le Bassin de Fusion n'ont pas de jauge d'affaissement (la Grille Hex utilise son propre compteur de descente du plafond).
  - **Puriste** : règles pures sous un plafond fixe. Les étapes font 10 colonnes de large et commencent avec 6 rangées de 4 couleurs, puis gagnent une rangée par étape (jusqu'à 9 rangées) et une couleur toutes les 2 étapes (jusqu'à 6). Toute la rangée du haut est ancrée. Il n'y a ni sphères spéciales, ni améliorations de l'Atelier, ni inclinaison, ni budget de tirs ; la Polarité reste. Les ratés remplissent la jauge d'affaissement, et à chaque remplissage le **rail** (le plafond) descend d'un cran et s'assombrit, entraînant l'amas. Vider le plateau rapporte un bonus d'étape et lance l'étape suivante avec une jauge vide ; la partie s'arrête quand l'amas franchit la ligne de danger. Le mode Puriste garde ses propres records (meilleur score et meilleure étape), son résultat partagé indique l'étape, le score et le nombre de chutes du rail (sans lien), et il s'ouvre au niveau 4 de la campagne. Sa carte est la première de la bande arcade du choix de niveau.
  - **Défi du jour** : graine quotidienne déterministe (tous les joueurs ont le même plateau de départ, les mêmes vagues et les mêmes tirages de couleur au lanceur ce jour-là, avec les mêmes règles pour tous : sans améliorations de l'Atelier ni munitions de la boutique), mutateurs physiques tournants (*Hyper Gravité*, *Rotors Turbo*, *Super Magnétisme*, *Amas Volatil*, *Matrice de Portails*, *Flipper Magnétique*, *Surtension Cryo*), récompense quotidienne en pièces et bonus de **Série quotidienne** (`+15 ⬡/jour`, jusqu'à `+150 ⬡` au 11e jour). En fin de partie, **Partager** envoie un résultat sans rien dévoiler (numéro du défi, mutateur, vague, score, un symbole par vague passée, vagues dorées et vagues de boss marquées) par la feuille de partage du système, ou le copie dans le presse-papiers. Les parties de Survie et de Mode Flux partagent de même leur vague ou leur forme et leur score ; un résultat Flux liste aussi les aides utilisées (niveaux d'Atelier, munitions achetées, continuation), s'il y en a. Le game over du Défi du jour indique quand commence le suivant, et le menu marque un défi déjà joué aujourd'hui. Un jour manqué est pardonné, mais une seule fois tous les 7 jours : une coupure isolée ne remet pas la série à zéro, une seconde dans les 7 jours, si. Le game over indique si le jour de grâce est disponible, ne dit qu'il a été utilisé que le jour même, et sinon indique quand il revient.
  - **Mode Flux** : un enchaînement sans fin de formes générées, avec une réserve de tirs commune. Trois formes sur quatre sont des silhouettes générées, parmi plus de 850 formes distinctes, chacune vérifiée pour rester loin de la ligne de danger quand on la laisse seule : étoiles, fleurs, engrenages, polygones, croissants et coeurs, pleins ou creux, de plusieurs tailles et proportions, nommés d'après leur forme ("Étoile à 7 branches", "Fleur creuse à 5 pétales"). Les autres sont un rotor ou un pendule paramétré, une silhouette dessinée (coeur, couronne, cloche, phare, ancre marine...), parfois tenue par des ancres neutres, ou une paire de petites formes, jamais deux fois de suite la même famille. Un budget de difficulté ajoute bumpers, portails, répulseurs et singularités au fil de la partie, une forme sur cinq est un boss Magnétar, les formes avancées ajoutent chaînes, bulles et coeurs de givre, de foudre et de peinture, et vider une forme rend des tirs. Chaque partie a sa graine : un rechargement reprend sur la même forme, l'écran de fin permet de rejouer la même graine (`Même Graine`), tous les joueurs d'une même graine ont les mêmes formes, les mêmes plateaux et les mêmes tirages de couleur au lanceur, un lien partagé (`?flux=<graine>`) lance directement cette graine (après confirmation si une autre partie est sauvegardée), et la barre d'outils de la sélection des niveaux permet aussi de saisir ou coller directement un code de graine ou un texte partagé. Après chaque troisième forme vidée, la partie s'arrête sur un **choix d'atout** : on en prend un parmi trois proposés (touches `1` à `3`, ou toucher une carte), chacun cumulable jusqu'à trois fois pour la suite de la partie. Les six atouts sont **Réserve** (tirs en plus tout de suite), **Recharge** (tirs en plus à chaque forme vidée ensuite), **Déflagration** (explosions des sphères spéciales plus larges), **Surtension** (Surcharge plus rapide), **Arsenal** (sphères spéciales aléatoires tout de suite, parmi les sphères spéciales de départ) et **Doré** (pièces en plus à chaque forme vidée ensuite). Les atouts détenus s'affichent en pastilles dans le HUD et le menu, et relancer une partie au-delà de la première forme demande confirmation.
  - **Déblocage progressif des modes** : un nouveau joueur commence avec la campagne et le Défi du jour, toujours ouverts. Les autres modes s'ouvrent au fil de la campagne : Survie au niveau 3, Puriste au niveau 4, Puzzle au niveau 5, Duel de polarité au niveau 6, Blitz au niveau 7, Flux au niveau 8, Cascade au niveau 10, Boss Rush au niveau 12, Grille Hex au niveau 13, Flipper Magnétique au niveau 14, Spin Orbital au niveau 15, Convoi Magnétique au niveau 16 et Bassin de Fusion au niveau 17. Une carte verrouillée du hub Jouer indique le niveau qui l'ouvre, un mode tout juste débloqué porte la marque "Nouveau" (sur sa carte et sur le bouton Jouer du menu) jusqu'à sa première partie, et l'écran de victoire l'annonce. Le Flux hebdomadaire s'ouvre après le niveau 5 de la campagne, et le lancer ouvre le Flux. Un lien Flux partagé (`?flux=<graine>`) fonctionne toujours et débloque le Flux ; les joueurs existants gardent tous les modes qu'ils avaient déjà.
  - **Flux hebdomadaire** : une partie de Flux sur une graine commune à tous les joueurs pour la semaine ISO en cours (du lundi 00:00 UTC au lundi suivant). Le premier lancement de la graine de la semaine, quel que soit le moyen (bouton Flux de la Semaine, lien partagé, champ de graine ou Même graine), rapporte un bonus de `40 ⬡` une fois par semaine ; un redémarrage ou une partie reprise ne rapporte rien, le menu affiche le meilleur score de la semaine une fois établi, et le résultat partagé s'ouvre sur un en-tête Flux hebdomadaire avec la semaine. Un redémarrage conserve la graine de la semaine en cours.
  - **Mes statistiques** : la fenêtre **Mes statistiques** du menu présente une vue d'ensemble (temps de jeu, tirs, parties, victoires et records par mode, progression de la campagne, les niveaux que vous ratez ou quittez le plus) et un **historique du Défi du jour** sur vos 60 derniers défis (date, numéro du défi, mutateur, score, vague et série). **Copier mes statistiques** place un résumé anonyme dans le presse-papiers. Tout reste stocké sur l'appareil, rien n'est envoyé nulle part. Les meilleures parties du Défi du jour et du Flux hebdomadaire conservent aussi une courte chronologie du score tir par tir.
  - **Duels fantômes** : affrontez la partie d'un ami sur le même plateau. Le résultat partagé d'un Défi du jour ou d'un Flux se termine par un lien de défi qui porte votre score après chaque tir (jamais vos actions, un lien court d'environ 600 caractères). L'ouverture d'un lien affiche une carte de duel, et rien ne démarre avant que vous acceptiez (une partie sauvegardée demande d'abord confirmation). Un duel fonctionne sur le Défi du jour d'aujourd'hui, sur tout Défi du jour des 30 derniers jours (une **revanche** : même plateau, mais sans bonus de première partie, sans série ni record du Défi du jour) et sur toute graine de Flux, Flux hebdomadaire compris. Un badge de rival dans le HUD affiche votre écart en direct (`+1 240 vs Sam`, `-320 vs Sam`, `= Sam`, le signe est toujours écrit, et `(final)` une fois sa partie terminée) à la place du marqueur de meilleure partie, avec des annonces polies quand la tête change, quand sa partie se termine et quand vous dépassez son score final. La fin de partie énonce le résultat ("Tu bats Sam de 120", "Sam gagne de 40", "Égalité parfaite avec Sam") et Partager devient alors **Partager le défi**, pour renvoyer le duel. Un **Nom de duel** facultatif dans les Réglages (12 lettres ou chiffres) est visible des amis que vous défiez. C'est une rivalité amicale seulement : pas de classement, ni pièces ni succès pour avoir battu un fantôme, des liens non signés et validés strictement (taille, somme de contrôle et forme canonique), et un lien abîmé ou trop ancien affiche une explication au lieu de démarrer. **Mes statistiques** garde vos 10 derniers duels et votre bilan.
  - **Duel de polarité** : un match en tête-à-tête contre l'ordinateur, deux plateaux de style Classique côte à côte, au meilleur des trois manches. Il s'ouvre au niveau 6 de la campagne. Voir [Duel de polarité](#duel-de-polarité) plus bas.
  - **Transfert de progression** : dans les réglages, choisis **Exporter la progression** pour télécharger un fichier JSON MagnaShot. Sur l'autre appareil ou navigateur, ouvre les réglages, choisis **Importer la progression**, sélectionne le fichier et confirme. Les entrées importées remplacent leurs équivalents. Les réglages et la partie en cours sauvegardée restent sur l'appareil de destination.
  - **Secousse du Bassin de Fusion** : quatre lâchers chargent une poussée latérale avec un petit rebond dans chaque bassin, assez forte pour remanier la pile. Utilise le bouton Secousse, G ou le bouton d'épaule droit. Le geste mobile est facultatif et désactivé au départ. Les records et les succès comptent normalement.
  - **Hub Jouer et carte de campagne** : le menu compte trois entrées (**Jouer**, **Mes statistiques**, **Réglages**) et les actions de la partie en cours. **Jouer** ouvre un hub qui réunit tous les modes en quatre sections : Campagne (Continuer le niveau en cours, ou ouvrir la carte), Défis (Défi du jour et Flux de la semaine avec leur bonus de pièces), Arcade (Survie, Puriste, Puzzle, Blitz 90s, Flux, Cascade, Boss Rush, Grille Hex, Flipper Magnétique, Spin Orbital, Convoi Magnétique, Bassin de Fusion, dans l'ordre de déblocage) et Duel (Duel de polarité, plus l'entrée à deux joueurs quand elle convient). Les fenêtres Pause et Fin de partie et la pilule de mode du HUD proposent **Changer de mode** pour y revenir. La **carte de campagne** ne montre que la campagne : un sélecteur de chapitre, des tuiles de niveau compactes (flèches, Début, Fin, Page précédente et Page suivante) et un panneau de détail. Un appui sélectionne un niveau et un appui sur le niveau sélectionné le lance : le niveau en cours reste à un appui.
  - **Modes Arcade (via la pilule HUD `▾` et les cartes du hub Jouer)** :
    - **Mode Puzzle** : 10 tableaux de précision déterministes avec file de tir fixée (`1` ou `2` tirs, sans échange), améliorations de l'Atelier, inclinaison et Surcharge désactivées, une bannière d'objectif par tableau et un sélecteur direct de tableaux (`P1` à `P10`) sous la carte Puzzle du hub Jouer (avec indice de déblocage au toucher et au clavier sur les tableaux verrouillés) qui affiche le meilleur score et les étoiles de chaque tableau (3 au premier essai, 2 en 3 essais, 1 sinon, un essai étant compté au premier tir ; les tableaux 3, 7 et 9 exigent aussi un score pour la troisième étoile ; le schéma de sauvegarde 7 garde les tableaux inférieurs au meilleur tableau enregistré à 1 étoile et ne supprime rien). Les objectifs sont **Noyau Captif** (`💎`), où libérer tous les noyaux déclenche une avalanche immédiate, ou vider le plateau.
    - **Blitz 90s** : contre-la-montre de 90 secondes à tirs illimités, suivi de la vague en cours dans la bannière HUD, descente rapide des vagues et tir automatique après 3 secondes d'hésitation affiché par un anneau de compte à rebours autour du lanceur.
    - **Boss Rush** : Titan central sur rotor (`👑`) entouré d'anneaux concentriques où chaque Surcharge à 100 % brise directement un bouclier du Boss.
    - **Boss Magnétar (Boss Rush et formes de boss du Flux)** : le boss de chaque vague du Boss Rush et d'une forme Flux sur cinq est un **Magnétar**, un noyau de champ incolore qu'aucune combinaison, bombe, foudre, fusée ni enclume ne peut briser. Sa santé, ce sont ses **Amarres** : les sphères ancrées qui le retiennent encore par des liens (traits pointillés avec une marque en crochet ; le HUD les affiche à la place du nombre de tirs au Boss Rush, et dans la bannière du Flux sur les formes de boss, où le nombre de tirs reste). On les rompt en les combinant ou en coupant les liens qui y mènent ; au Boss Rush, une Surcharge pleine rompt une Amarre. Repousse n'ajoute jamais d'ancre (une sphère qui relie à nouveau une ancre peut en rétablir une, et le compte reflète toujours ce qui retient vraiment le Magnétar) ; quand plus rien ne retient le Magnétar il tombe en avalanche, seule façon de le vaincre (900 points, 40 par sphère de la même avalanche, 40 pièces). Tous les quelques tours il **arme** l'un de quatre schémas, annoncé un tour à l'avance par un badge au-dessus du noyau et une pastille du HUD ("Tour suivant : ...") avec un symbole et des mots, jamais la seule couleur, et annoncé poliment une fois : **Champ inversé** (votre tir courbe dans l'autre sens ; inversez la polarité pour l'annuler), **Remous** (un champ en pointillés attire votre tir vers le noyau ; rebondissez à travers lui vers une Amarre), **Repousse** (jusqu'à 3 sphères apparaissent dans les emplacements en tirets autour de l'amas, jamais des ancres ; remplissez un emplacement ou rompez d'abord une Amarre) et **Barrage** (des sphères chargées montent de la ligne de danger sur 2 tours ; tirez la polarité opposée pour les neutraliser). Les vagues et formes avancées arment plus de schémas, plus souvent. Le Codex liste les quatre schémas, et les Noyaux Boss des niveaux marquants de la campagne ne changent pas. Quand un Magnétar tombe, il joue son propre son et fait trembler l'écran (sans tremblement avec le mouvement réduit).
    - **Cascade** : puits magnétique à forte gravité où les sphères tombent sur des plateformes porteuses et des coussins antimagnétiques.
    - **Grille Hex** : grille hexagonale rigide avec tirs rectilignes (`disableMagneticCurve`), accrochage au plafond, combinaisons à 6 voisins, avalanches rattachées au plafond et descente périodique. Règles puristes d'équité (ni sphères spéciales ni améliorations de l'Atelier) ; inverser la Polarité (`F`) arme une impulsion magnétique déterministe d'une cellule à l'atterrissage, prévisualisée dans la visée, qui attire les sphères de même couleur ou repousse les voisines différentes.
    - **Flipper Magnétique** : canon supérieur tirant vers le bas sous gravité à travers des tableaux de plots ancrés, avec rebonds élastiques sans plafond et sphères spéciales cinétiques (*Bombe*, *Foudre*, *Enclume*, *Fusée*). Allumer tous les **Plots Noyaux** vide le tableau et rend des tirs ; inverser la Polarité (`F`) en plein vol courbe la trajectoire en direct entre deux rebonds, et un **Godet Collecteur Magnétique** oscillant au bas de l'arène rembourse `+1` tir à la réception.
    - **Spin Orbital** : arène en apesanteur autour d'un coeur hexagonal central en rotation libre entraîné par le moment cinétique des tirs excentrés (`r x J / I`), bordée par un anneau circulaire de confinement (défaite `RING_BREACHED`) et des vagues d'anneaux astéroïdes. Les sphères détachées dérivent radialement à 360 degrés vers 4 **Arcs Collecteurs Magnétiques** périphériques pour gagner des points bonus et de la Surcharge.
    - **Convoi Magnétique** : tourelle centrale pivotant sur 360 degrés au milieu de convois continus de sphères avançant le long de 4 rails paramétriques (*Spirale*, *Serpent*, *Huit*, *Boucle Orbitale*) vers un drain de Singularité (défaite `VORTEX_REACHED`). Les tirs s'insèrent dans le train, le Gel ralentit l'avance sur le rail, et lorsqu'une combinaison ouvre une brèche dont les extrémités exposées partagent la même couleur ou une polarité magnétique opposée (`N`/`S`), le segment avant claque violemment en arrière contre le segment arrière pour déclencher des réactions en chaîne.
    - **Bassin de Fusion** : rail de lâcher horizontal au sommet (`Gauche`/`Droite` ou position X du pointeur) au-dessus d'un bassin à corps rigides comptant 12 calibres discrets de rayons entiers (`1` à `12`). Deux sphères de même calibre en contact fusionnent en `calibre + 1` avec une onde de choc magnétique radiale qui décoince les piles voisines (`12 + 12` déclenche une Supernova), chaque appui sur Polarité (`F`) rapproche un instant les calibres identiques et écarte les autres, l'inclinaison de l'appareil fonctionne, un débordement prolongé au-dessus de la ligne haute met fin à la manche, et la Secousse (chargée par quelques lâchers) projette toute la pile vers le côté le plus vide. Tous les neuf à quatorze lâchers, un court **événement** (vent, gravité faible, sphères rebondissantes, gros calibres ou fusions dorées) change les règles pendant quelques lâchers et est annoncé un lâcher à l'avance, et une chaîne de trois fusions sur un même lâcher fait avancer une Secousse en charge. La ligne de débordement descend à mesure que votre meilleur calibre fusionné grandit (à partir du calibre 7), puis par paliers une fois le calibre 11 fusionné ; chaque palier est annoncé trois lâchers à l'avance par une ligne en tirets avec des repères sur les parois, et annoncé poliment.
- **Prise en main** :
  - Un indice de première rencontre explique chaque mécanique la première fois qu'elle arrive sur le plateau, dans tous les modes : le tutoriel du niveau quand il existe, sinon son entrée du Codex. Un indice reste affiché jusqu'à ce que vous le fermiez ou utilisiez la mécanique ; laissé ouvert, il cède la place au suivant après trois tours (un indice par tour), et les **Réglages** permettent de tous les revoir. La polarité, la Résonance, l'Affaissement et chaque sphère spéciale ont leur propre indice, avec le contrôle concerné qui pulse (un contour remplace le mouvement quand le mouvement réduit est activé). Un bouton **?** dans l'ATH rejoue les indices du niveau en cours, et la première fois que vous jouez un niveau (si aucun indice n'est affiché), une bannière d'objectif non bloquante en donne le nom, les tirs et le point à retenir. Les niveaux 2 à 4 introduisent chacun une seule sphère spéciale nouvelle. En campagne, ce que le niveau met en avant est expliqué en premier.
  - Le niveau 1 s'en tient aux groupes et aux avalanches : trois couleurs, aucune sphère spéciale, aucun modificateur ; les emplacements des sphères spéciales apparaissent dès qu'il y en a une à utiliser.
  - Un niveau qui enseigne un modificateur en montre toujours le même nombre, fixé dans sa définition.
- **Sensations de jeu** :
  - **Collecteurs d'avalanche et Seconde chance** : les sphères en chute libre traversant les 5 collecteurs magnétiques au bas du plateau (marqués `+35`) rapportent des points bonus (`+35 pts`) et de la Surcharge (`+4 %`). Tomber à court de tirs en Campagne ou en Mode Flux propose une **Seconde chance** une fois par manche (`+5 tirs` pour `40 ⬡`).
  - **Sprites de sphères en cache offscreen et atmosphère d'arène** : les sphères sont pré-rendues en cache avec contre-jour (rim-light) et double reflet spéculaire, les liens magnétiques pulsent avec un halo énergétique à double passe, les textes flottants apparaissent avec un rebond élastique sans jamais déborder des murs, et le calque de fond statique combine halo d'horizon sous le lanceur, vignettage, noeuds de grille et équerres d'angle.
  - **Détonations spectaculaires, fracturation des sphères et ralenti cinématique** : au lieu de disparaître instantanément dès l'impact, les sphères détruites sont projetées vers l'extérieur par le souffle, gonflent (`1.0x` à `1.46x`), s'illuminent de l'intérieur, se fissurent et éclatent en boules de feu secondaires et en étincelles traçantes pendant la fenêtre de ralenti. Les sphères spéciales explosives et cinétiques (*Bombe*, *Foudre*, *Enclume*, *Fusée*, *Prisme*, ainsi que les *Barils dormants* et *Noyaux Boss*) déclenchent des nuages de feu multiphases, des rayons d'explosion en étoile, un flash d'arène, des ondes de choc concentriques, des arcs électriques ciblés et un vignettage lumineux de ralenti (`getTimeScale`), automatiquement désactivés en mode mouvements réduits.
  - **Halo d'alerte sur la ligne de danger et bilan de manche enrichi** : les sphères proches de la ligne de défaite émettent un halo radial pulsé (statique en mode mouvements réduits), et l'écran de fin de partie détaille la vague ou le tableau atteint, le combo maximal et les pièces gagnées, avec partage en un clic dans les 14 modes hors Campagne.
  - **Ligne "presque" et repère du meilleur score** : quand une partie d'un mode à record (Survie, Défi du jour, Cascade, Blitz, Flux, Boss Rush) se termine à moins de la moitié de ce record, le game over indique de combien elle l'a manqué, à titre d'information, avec les statistiques (une partie très en dessous du record ne dit rien). En Flux et en Boss Rush, un repère "Record" compact dans le HUD affiche le record que la partie avait au départ ; les modes à score l'affichent déjà dans le HUD.
  - Chaque sphère qui se pose envoie une onde qui fait gonfler l'amas, de lien en lien et plus faiblement à chaque pas, avec un léger tremblement d'écran. L'onde ne change que le dessin des sphères ; le mode mouvements réduits coupe les deux.
  - À la victoire, le score défile et les étoiles gagnées apparaissent une par une ; les deux respectent le mode mouvements réduits. L'écran de victoire indique aussi combien de points manquent pour décrocher l'étoile suivante (ou confirme l'objectif 3★), signale les nouveaux records personnels en Campagne, Survie, Défi du jour et Mode Flux, et l'écran de défaite en Campagne ou Mode Flux précise combien de sphères restaient sur le plateau.
- **Atelier et Codex** :
  - Améliorations permanentes (*Visée laser courbée*, *Amplificateur magnétique*, *Condensateur de surcharge*, *Réserve de projectiles*, *Aimant collecteur*).
  - Recharges de munitions spéciales en cours de partie (cliquer ou presser `1`-`7` sur une sphère spéciale épuisée ouvre cet onglet), **4 styles visuels de sphères à débloquer** (*Classique*, *Cristal*, *Néon*, *Métallique*) avec médaillon d'aperçu visuel, primes et succès avec barres de progression persistantes basées sur vos meilleurs records, regroupés par famille en paliers Bronze, Argent et Or (nouvelles familles pour les formes du Flux et les vagues du Boss Rush), et un **Codex et guide** illustré couvrant modificateurs d'amas, obstacles magnétiques, sphères spéciales, mutateurs du Défi du jour et mécaniques du plateau et du lanceur (*Inversion de polarité*, *Collecteurs magnétiques*, *Jauge de surcharge*).
- **Accessibilité et confort** :
  - Interface bilingue (**FR** / **EN**) sans aucun texte codé en dur ; à la première visite, la langue suit celle du navigateur.
  - Mode **contraste élevé** avec bordures renforcées et symboles de couleur (`N`, `S`, `Ξ`, `Π`, `Ω`, `Φ`), distincts du signe de polarité `+`/`-` ; les boutons respectent le contraste WCAG AA.
  - Option **motifs de couleur** : chaque couleur reçoit son propre motif (rayures, points, grille, anneaux) à l'intérieur des sphères.
  - Option **réduction des animations** et sélecteur de **vitesse des animations** (`0.5x`, `1x`, `1.5x`, `2x` pour les explosions, l'éclatement des sphères, les ondes de choc et le ralenti des détonations) dans les **Réglages**, ainsi que pause automatique au changement d'onglet.
  - **Bouton Plein écran** (`⛶`) directement dans la barre HUD supérieure sur téléphone et tablette en portrait, ainsi que dans les **Réglages** sur tous les écrans, pour masquer la barre d'adresse et de navigation du navigateur (`navigationUI: 'hide'`). Le bouton est masqué quand l'application installée tourne déjà en plein écran.
  - **Contrôle par inclinaison** sur téléphone et tablette, activé par défaut : incliner l'appareil penche la gravité sur le côté. Sur iPhone et iPad, le premier appui sur le plateau demande l'autorisation des mouvements. Il se désactive dans les **Réglages**.
  - Prise en charge des lecteurs d'écran : boutons bascules étiquetés avec `aria-pressed`, sphères spéciales et étoiles des niveaux nommées, annonces discrètes des succès et des fins de manche.
  - Contrôles complets à la souris, au tactile (décalage vertical du doigt et annulation du tir en glissant vers le bas) et au clavier ; une touche d'action maintenue ne se répète pas. Les flèches affinent une visée à la souris : après une flèche, les petits mouvements de souris laissent la visée en place et un clic tire dans cette direction.
  - Mise en page sans défilement sur ordinateur, téléphone et téléphone en paysage, avec des zones tactiles de 44 px et un menu coulissant (☰) unifié sur toutes les tailles d'écran (regroupant *Jouer*, *Mes statistiques*, *Réglages* et *Partie en cours* tout en mettant la partie en pause). Sur téléphone en portrait, le plateau occupe toute la largeur et une ligne sous le score garde en vue la manche, les pièces et le record. Le plateau prend la forme du monde, 470 x 820. Sur un écran d'ordinateur en paysage, le plateau occupe toute la hauteur de la fenêtre, centré entre deux colonnes de même largeur : bouton menu (☰), sélecteur de mode interactif (`▾`) et statistiques de la manche à gauche, surcharge, sphères spéciales, Polarité et Échanger à droite.
  - La partie en cours survit à un rechargement ou à un onglet fermé par le système, et reprend en pause.
- **Installable et hors ligne** :
  - Application web progressive installable, avec icônes standard et adaptatives (maskable) ; **Réglages** propose un bouton Installer là où le navigateur l'autorise, et une aide pour iPhone et iPad.
  - Service Worker réseau d'abord, qui sert la copie en cache hors ligne ou quand le réseau est trop lent.

---

## Contrôles

| Action | Souris / tactile | Clavier |
| :--- | :--- | :--- |
| **Viser** | Déplacer le pointeur / glisser le doigt | `Gauche` / `Droite` par petits pas (`+ Maj` pour de plus grands) |
| **Tirer** | Relâcher le pointeur / le doigt | `Entrée` |
| **Annuler la visée** | Glisser sous l'anneau du lanceur | - |
| **Échanger la sphère** | Cliquer la sphère secondaire ou le bouton **Échanger** | `Espace` |
| **Inverser la polarité** | Cliquer le bouton **Polarité** | `F` |
| **Équiper / ranger une sphère spéciale** | Cliquer l'emplacement de la sphère spéciale (cliquer à nouveau pour la ranger) | `1` à `7` |
| **Secouer le bassin (Bassin de Fusion)** | Cliquer **Secousse** | `G` |
| **Pause / fermer une fenêtre** | Cliquer **Pause** ou le fond de la fenêtre | `Échap` |
| **Réglages** | Cliquer **⚙ Réglages**, ou ouvrir **Pause** | - |

### Prise en charge de la manette

Branchez ou associez une manette au format standard et appuyez sur un bouton : le jeu passe aux indications de manette et les menus se parcourent à la croix directionnelle. Les manettes au format non standard sont ignorées. Le clavier, la souris et le tactile restent utilisables à tout moment.

| Action | Manette |
| :--- | :--- |
| **Viser** | Stick gauche (stick droit pour affiner, gâchette gauche maintenue pour la précision, croix gauche / droite pour de minuscules pas) |
| **Tirer** | Bouton du bas ou gâchette droite |
| **Échanger la sphère** | Bouton de gauche |
| **Inverser la polarité** | Bouton du haut |
| **Ranger la sphère spéciale** | Bouton de droite |
| **Sphère spéciale précédente / suivante** | Bumper gauche / droit (le bumper droit secoue le bassin au Bassin de Fusion) |
| **Pause / reprise** | Start |
| **Menu** | Select |
| **Rejouer l'indice du niveau** | Clic du stick gauche |
| **Recentrer la visée** | Clic du stick droit (droit vers le haut, droit vers le bas au Flipper, ou milieu du rail au Bassin de Fusion) |
| **Menus : se déplacer / valider / retour** | Croix ou stick gauche / bouton du bas / bouton de droite |
| **Menus : onglet précédent / suivant** | Bumper gauche / droit |

Si la manette se déconnecte pendant une partie, le jeu se met en pause. Dans les **Réglages**, le groupe **Manette** (affiché seulement quand une manette est connectée) active ou coupe la manette et règle la zone morte des sticks (petite, moyenne, grande), la vitesse de visée (lente, normale, rapide) et l'inversion de la visée horizontale ; les choix sont conservés localement. Une option **Vibration** (dans le groupe Accessibilité, activée par défaut) fait vibrer une manette compatible quand une charge atterrit sur votre plateau, quand une impulsion de champ vous touche et quand vous perdez une manche ; elle reste silencieuse avec le mouvement réduit. La même option active ou coupe aussi les vibrations d'un téléphone.

---

## Duel de polarité

Un mode en tête-à-tête contre l'ordinateur, ouvert au niveau 6 de la campagne depuis sa carte dans le hub Jouer. Choisissez une difficulté (**Facile**, **Normal**, **Difficile**) ; Difficile s'ouvre une fois Normal battu. Chaque camp joue son propre plateau de style Classique (une rangée du haut entièrement ancrée, sans obstacles, sans améliorations, sans pièces).

- **Attaques** : un tir qui fait tomber des sphères envoie des **sphères chargées** sur l'autre plateau. Elles montent depuis la ligne de danger du défenseur vers l'amas et s'y accrochent si rien ne les arrête. Une avalanche plus grosse, une réaction en chaîne ou une sphère spéciale en envoie davantage.
- **Polarité** : chaque charge porte un signe (`+` ou `-`). Un tir de polarité **opposée** brise une charge (une charge forte demande deux coups), un tir de même polarité **rebondit** dessus. Le signe de votre tir est dessiné sur les sphères du lanceur et sur le bouton Polarité, l'aperçu de visée montre ce que le tir ferait à la première charge croisée (une fissure pour briser, une flèche de rebond pour rebondir), et la touche ou le bouton Polarité inverse le signe. Les bombes et les éclairs détruisent toutes les charges qu'ils atteignent.
- **Série de garde** : toutes les 3 charges neutralisées, vous gagnez une sphère spéciale.
- **Impulsion de champ** : neutraliser des charges remplit la jauge de Surcharge ; une jauge pleine déclenche une impulsion de champ qui abaisse d'un cran le rail d'ancrage de l'adversaire.
- **Match** : au meilleur des 3 manches ; une manche est perdue quand un plateau franchit sa ligne de danger. Si les deux tombent ensemble, la manche est rejouée. Après 3 minutes, la **mort subite** abaisse les deux rails toutes les 20 secondes.
- **Écrans** : sur grand écran (tablettes, ordinateur) les deux plateaux sont côte à côte ; sur téléphone, le plateau de l'ordinateur devient une mini-vue à côté ou au-dessus du vôtre. Les commandes d'une partie solo fonctionnent, et la manette est prise en charge.
- **Tutoriel du premier duel** : la première fois que vous lancez un duel sur un appareil, une courte fenêtre explique les charges, la garde de polarité et l'impulsion de champ en trois étapes pendant que le match attend. Passez-la à tout moment (Échap, le bouton Passer ou le bouton retour de la manette) ; elle ne revient pas.
- **Son** : chaque plateau joue de son côté du champ stéréo (le premier plateau à gauche, le second à droite).
- **Records** : vos victoires et défaites par difficulté sont conservées localement et affichées dans **Mes statistiques** ; la carte de résultat propose un bouton Partager.

### Deux joueurs sur le même appareil

Sous le choix de difficulté, **2 joueurs (même appareil)** ouvre un salon pour un match entre deux personnes devant le même écran : pas d'ordinateur, les mêmes règles, au meilleur des 3 manches. L'entrée n'est proposée que sur grand écran (au moins 680 px de large et 520 px de haut) ; elle n'apparaît pas sur téléphone, et un match qui rétrécit sous la taille de deux plateaux se met en pause et attend une fenêtre plus grande (la fenêtre de pause l'explique et Reprendre reste inaccessible tant que les plateaux ne tiennent pas).

Chaque joueur choisit son périphérique dans le salon, et appuyer sur une touche de participation ou sur un bouton de manette prend une place libre :

| Périphérique | Joueur | Comment rejoindre | Commandes |
| :--- | :--- | :--- | :--- |
| **Moitié gauche du clavier** | 1 | `W` | `A` / `D` visent (maintenez `Maj gauche` pour viser finement), `W` tire, `S` échange, `Q` inverse la polarité, `E` sphère spéciale suivante |
| **Moitié droite du clavier** | 2 | `Haut` | `Gauche` / `Droite` visent (maintenez `Maj droite` pour viser finement), `Entrée` tire, `Bas` échange, `/` inverse la polarité, `.` sphère spéciale suivante |
| **Touches de gauche et souris** | 1 | Changer de périphérique | Les touches de gauche ci-dessus, et la souris vise et tire sur le premier plateau |
| **Tactile** | 1 ou 2 | Changer de périphérique | Glissez sur votre propre plateau ; chaque plateau suit son propre doigt, les deux joueurs peuvent donc toucher en même temps |
| **Manette** | 1 ou 2 | Bouton du bas | Les commandes d'une partie solo ; Start ou Select met en pause, le bouton de retour libère la place dans le salon |

- La visée suit les touches tant qu'elles sont maintenues, les deux joueurs peuvent donc viser en même temps. Le nom des touches suit la disposition de votre clavier (un clavier AZERTY affiche `Z` là où ce tableau dit `W`) ; les équivalents du pavé numérique pour Entrée, `/` et `.` fonctionnent aussi. Espace, `F` et les chiffres ne font rien dans un match à deux, et Échap met en pause.
- **Handicap** : chaque joueur peut ralentir la montée des charges qui arrivent sur son propre plateau (normale, x1,25 ou x1,5), pour un match entre niveaux différents.
- Une manette débranchée pendant le match le met en pause ; appuyez sur le bouton du bas d'une autre manette pour prendre sa place, ou quittez.
- La carte de résultat nomme le vainqueur et montre le score, les charges neutralisées et les impulsions de chaque joueur, avec **Rejouer** (mêmes périphériques et mêmes handicaps), **Changer de joueurs** et **Retour**. Un match terminé s'ajoute seulement au compteur "Matchs à 2 joueurs" de **Mes statistiques** : aucune statistique personnelle ni aucun record contre l'ordinateur ne change, et il n'y a pas de bouton Partager.
- Deux points dépendent de votre matériel. De nombreux claviers ne savent pas signaler toutes les combinaisons de touches à la fois (fantômes de touches) : si une touche cesse de répondre quand les deux joueurs en maintiennent plusieurs, utilisez une manette ou le tactile pour l'un des joueurs. Sous Windows, appuyer cinq fois sur Maj ouvre les Touches rémanentes, ce qui peut interrompre les touches de visée fine : désactivez ce raccourci dans les paramètres du système si cela arrive.

---

## Pulse : musique et Résonance

- **Musique** : une partition procédurale originale, synthétisée dans le navigateur, avec son propre tempo, sa tonalité et sa suite d'accords pour chacun des quinze modes (Bassin de Fusion à 88 BPM jusqu'à Blitz à 132). Elle ne joue que pendant une partie en cours : ouvrir un menu, mettre en pause, perdre ou gagner la fait s'estomper, et aucune musique ne joue dans les menus. Elle suit la pression sur le plateau : un nappage et une basse au repos, puis un arpège, des charleys plus chargés et un filtre qui s'ouvre quand la jauge d'affaissement se remplit, que l'amas approche de la ligne de danger ou que des charges se rapprochent de votre plateau. Elle n'utilise jamais les flux aléatoires d'une partie. La musique démarre après votre premier toucher ou appui sur une touche (les navigateurs refusent le son avant).
- **Réglages** : le bouton **Son** coupe toujours tout. **Musique** active ou coupe la partition (les effets continuent) et **Volume de la musique** passe en boucle par 20, 40, 60, 80 et 100 pour cent (le bouton Musique seul coupe la partition). Tout est conservé localement. Les Réglages sont regroupés en quatre sections : **Audio**, **Jeu**, **Accessibilité** et **Manette**.
- **Résonance** : un tir lâché à 5 images du temps (à peu près un douzième de seconde, jamais plus de 12 pour cent du temps) est **Résonant**. Un anneau de temps autour du lanceur se resserre sur lui à chaque temps ; fenêtre ouverte, l'anneau devient plein et épais, en dehors il est fin et en pointillés, si bien que le repère ne dépend jamais de la couleur seule. Un tir Résonant fait flasher le lanceur, affiche "Résonance !" et joue un court arpège.
  - **Déblocage** : la Résonance se débloque après le niveau 5 de la campagne, dans tous les modes solo où la Surcharge s'applique. Un indice l'explique la première fois qu'elle s'applique, et le Codex gagne une entrée **Résonance**. Les plateaux du Duel de polarité l'ont toujours. Les modes **Puriste**, **Puzzle**, **Grille Hex** et **Bassin de Fusion** n'en ont pas. La musique joue dès le début dans tous les cas.
  - **Modes solo** : si le tour d'un tir Résonant fait au moins une combinaison ou fait tomber au moins une sphère, toute la Surcharge gagnée ce tour est multipliée par 1,5. Un tir à vide ne rapporte rien de plus.
  - **Duel de polarité** : un tir Résonant qui touche une charge de polarité opposée lui retire 2 de force au lieu de 1 (ce que vous envoyez ne change pas). L'ordinateur obtient des tirs Résonants par un tirage selon la difficulté (Facile jamais, Normal 35 pour cent, Difficile 65 pour cent) tiré dans son propre flux graine, qui ne change donc jamais le reste du match. Le choix de difficulté propose une option **Résonance**, reprise de votre réglage global à chaque ouverture.
  - **Où elle est désactivée, et pourquoi** : le **Défi du jour** (revanches comprises), le **Flux hebdomadaire**, les parties de Flux issues d'un **lien de graine partagé** et les **Duels fantômes** n'utilisent jamais la Résonance, quel que soit le réglage, afin que leurs scores restent comparables. La musique y joue quand même ; seul l'anneau est masqué.
  - **Réglage** : le bouton **Résonance** coupe le bonus et l'anneau partout ailleurs. La Résonance est jugée sur les images du jeu, jamais sur l'horloge, si bien qu'une partie se rejoue à l'identique ; il n'y a pas de vibration au rythme.
- **Calibrer le rythme** (Réglages) : tapez en rythme avec huit pulsations de l'anneau (avec des clics, ou en silence si le son est coupé). La distance médiane entre vos taps et les pulsations, de 200 ms au plus dans un sens ou l'autre, devient un décalage qui ne change que la façon dont votre timing est jugé ; **Réinitialiser** l'efface.

---
## Architecture

Le code suit une architecture en modules ES sans dépendance, avec une séparation stricte des données et de la logique (`configs/*.json` et `locales/*.json`) :

```text
├── configs/                  # Données externalisées : jeu, physique, sphères, obstacles, audio, modes, niveaux, campagne et Mode Flux
├── icons/                    # Icônes PWA (SVG, SVG maskable, PNG 192 px et 512 px)
├── locales/                  # Dictionnaires de traduction (fr.json, en.json)
├── scripts/
│   ├── calibrate-campaign.mjs# Outil en ligne de commande de calibration hors ligne de la campagne
│   ├── calibrate-flux-shapes.mjs # Laisse chaque forme Flux générée s'affaisser seule et écrit configs/fluxShapeTuning.json (`npm run calibrate:flux`, hors ligne)
│   ├── calibrate-classic.mjs # Rapport hors ligne de la difficulté du mode Puriste pour le bot glouton (affiche, n'écrit jamais)
│   ├── calibrate-versus.mjs  # Garde des niveaux de CPU : Difficile et Normal doivent battre Facile, impulsions par manche dans la plage (`npm run calibrate:versus`, lancé par la CI)
│   ├── pages-artifact.mjs    # Construit l'artefact GitHub Pages (_site/) avec les seuls fichiers d'exécution
│   ├── release.mjs           # Préparation d'une version : incrémente les versions et promeut la section Unreleased du CHANGELOG
│   └── bot/
│       └── CampaignBot.js    # Bots de calibration glouton et arsenal
├── src/
│   ├── main.js               # Démarrage, filtrage des entrées pointeur et enregistrement du Service Worker
│   ├── core/
│   │   ├── ConfigRegistry.js # Chargeur parallèle des configurations JSON
│   │   ├── GamepadInput.js   # Lecteur de manette pur : zone morte, courbe de réponse, fronts d'appui, répétition dans les menus, choix de la manette active
│   │   ├── StorageView.js    # Vue de stockage en lecture seule pour un plateau de duel : réglages relayés, toute écriture sans effet
│   │   ├── AudioChannel.js   # Enveloppe audio par plateau : sourdine et panoramique propres, stopAll limité
│   │   ├── Constants.js      # Énumérations figées et constantes mathématiques
│   │   ├── I18n.js           # Service de traduction et traducteur d'attributs DOM
│   │   ├── SeededRandom.js   # Générateur pseudo-aléatoire déterministe (Mulberry32) du Défi du jour et du Mode Flux
│   │   ├── StorageManager.js # Persistance localStorage en cache, avec repli en mémoire, schéma de sauvegarde versionné (migrations ordonnées, reprise des sauvegardes d'avant le renommage)
│   │   ├── installMethods.js # Installe les méthodes d'un module de domaine sur le prototype d'une classe
│   │   ├── WorldGeometry.js  # Lanceur, ligne de danger et décalage du contenu calculés depuis la taille du monde
│   │   ├── AudioManager.js   # Synthétiseur procédural Web Audio API (effets, bus de musique, coupure et visibilité)
│   │   └── MusicEngine.js    # Musique procédurale : ordonnanceur en avance, motifs par mode, couches d'intensité, verrouillage de phase sur le temps
│   ├── entities/
│   │   ├── Ball.js           # Sphère magnétique (liens, polarité, blindage, modificateurs)
│   │   ├── Obstacle.js       # Rotors, bumpers, répulseurs, portails, barrières et singularités
│   │   └── ParticleSystem.js # Explosions, traînées, ondes de choc, éclairs et textes, en pool d'objets plafonné
│   ├── physics/
│   │   ├── PhysicsWorld.js   # Solveur à ressorts en sous-pas, lancer de rayons et avalanche par BFS
│   │   └── SpatialHashGrid.js# Grille de hachage spatial 2D sans collision pour la recherche de voisins
│   ├── game/
│   │   ├── GameEngine.js     # Noyau de la machine à états (constructeur, état, score et succès) ; les méthodes de domaine vivent dans les modules Engine*.js
│   │   ├── EngineBoard.js    # Module de GameEngine : dispositions de niveau, rangées infinies et modificateurs
│   │   ├── EngineControls.js # Module de GameEngine : emplacements spéciaux, munitions de la boutique, échange du lanceur, visée, inclinaison et confort
│   │   ├── EngineDiscovery.js# Module de GameEngine : indices de première rencontre
│   │   ├── EngineLauncher.js # Module de GameEngine : file du lanceur, tirages de couleur à graine et rafraîchissement des couleurs périmées
│   │   ├── EngineModes.js    # Module de GameEngine : lancement de chaque mode solo et Arcade, atouts et transitions de forme Flux
│   │   ├── EngineRoundFlow.js# Module de GameEngine : types de vague, fin de manche, défaite et pack de continuation
│   │   ├── EngineTurnResolution.js # Module de GameEngine : résolution des grappes, réactions en chaîne, avalanche, sphères spéciales aléatoires et Surcharge
│   │   ├── GameLoop.js       # Boucle à pas fixe avec interpolation, ralenti au repos et arrêt sur erreur fatale
│   │   ├── ImpactPreview.js  # Ce qu'un tir détruirait, partagé par la prévisualisation et le bot de calibration
│   │   ├── LevelCatalog.js   # Catalogue des niveaux dessinés et générés de la campagne et empreintes
│   │   ├── Renderer.js       # Rendu Canvas 2D HiDPI avec interpolation et prévisualisation de zone
│   │   ├── RunSnapshot.js    # Sauvegarde et reprise après rechargement d'une partie en cours
│   │   ├── SpecialBallController.js # Résolution des impacts Bombe, Éclair, Prisme, Enclume, Cryo, Fusée et Pinceau
│   │   ├── Discovery.js      # Indices de première rencontre : mécaniques du plateau, prochaine inconnue, texte
│   │   ├── DailyShare.js     # Texte de résultat de chaque mode hors campagne, sans rien dévoiler, pour le bouton Partager
│   │   ├── ModeUnlocks.js    # Règles pures du déblocage progressif des modes (niveau de campagne par mode, états nouveau et vu)
│   │   ├── MagnetarRules.js  # Règles pures des boss Magnétar : paliers, calendrier des schémas, Amarres, emplacements de Repousse, plan de Barrage, récompense de chute
│   │   ├── EngineMagnetar.js # Module de GameEngine : état du Magnétar, avertissements et effets, rupture d'Amarres, charges de Barrage, chute et vue du HUD
│   │   ├── SagMeter.js       # Règles pures de la jauge d'affaissement : test du tir raté, remplissage et vidage par avalanche, chute, phase d'alerte
│   │   ├── WeeklyFlux.js     # Clé de semaine ISO, graine du Flux hebdomadaire et compte à rebours jusqu'à la semaine suivante
│   │   ├── PlayerStats.js    # Statistiques locales pures : parties, tirs, temps de jeu, niveaux difficiles, texte anonyme
│   │   ├── ShotTimeline.js   # Chronologie compacte du score tir par tir des meilleures parties du Défi du jour et du Flux hebdomadaire
│   │   ├── GhostCodec.js     # Encodeur et décodeur strict, pur, des liens de duel (versionnés, avec somme de contrôle, canoniques)
│   │   ├── GhostDuel.js      # Règles pures du duel : score du fantôme par tir, écart en direct, annonces, résultat
│   │   ├── EngineGhostDuel.js# Module de GameEngine : départ et revanche d'un duel, comparaison au fantôme à chaque tir, résultat et lien de défi
│   │   ├── EngineProgress.js # Module de GameEngine : statistiques, déblocage des modes, historique du Défi du jour, Flux hebdomadaire et chronologies
│   │   ├── VersusRules.js    # Règles pures du Duel de polarité : table d'attaque, polarité, montée et impacts des charges, série de garde, manches, mort subite
│   │   ├── EngineVersus.js   # Module de GameEngine : plateau de duel ensemencé, charges (montée, impacts, atterrissage), impulsion de champ et prédiction de l'aperçu de visée
│   │   ├── VersusMatch.js    # Contrôleur de match à deux plateaux : niveaux de CPU, routage des attaques, manches, mort subite et annonces (utilisable sans interface)
│   │   ├── EnginePulse.js    # Module de GameEngine : horloge de temps, jugement de la Résonance, bonus de Surcharge, pression musicale et état du temps
│   │   ├── Resonance.js      # Règles pures de la Résonance : fenêtre de temps, décalage, où elle s'applique, forme de l'anneau, médiane de calibrage
│   │   ├── BotBrain.js       # Décisions pures du bot (visée gloutonne, valeur d'un tir, plan d'arsenal) avec flux aléatoire injecté
│   │   ├── modes/            # Comportements enfichables des modes Arcade à physique dédiée (Grille Hex, Orbital, Flipper, Convoi, Fusion)
│   │   └── layouts/
│   │       ├── LayoutGenerators.js   # Géométrie pure des formes : pendule, anneaux, hexagone, spirale, croix, masques
│   │       ├── ShapeGenerator.js     # Silhouettes Flux générées : courbes polaires sur la grille, filtre de qualité
│   │       └── FluxStageGenerator.js # Formes Flux à graine : famille, budget de difficulté, Noyau Boss
│   └── ui/
│       ├── CodexView.js      # Rendu de l'onglet illustré Codex et guide
│       ├── CanvasInput.js    # Visée au pointeur et au toucher sur le canevas, liée au moteur de n'importe quel plateau
│       ├── LocalInput.js     # Aides pures du mode à deux joueurs : disposition du clavier partagé, places des périphériques, règles du pointeur, test du grand écran
│       ├── FluxPerkView.js   # Dialogue de choix d'atout Flux et pastilles des atouts actifs
│       ├── LevelSelectView.js# Carte de campagne : sélecteur de chapitre, tuiles, panneau de détail, badges de format et filtre < 3★
│       ├── PlayHubView.js    # Hub Jouer : cartes campagne, défis, arcade et duel, volets
│       ├── UIManager.js      # Noyau de l'interface : construction, câblage et modules ci-dessous
│       ├── UIHelpers.js      # Utilitaires et constantes purs de l'interface : filtre du piège de focus, formateurs, résolveurs de partage et de victoire, WeakMap partagées
│       ├── UIHudRefresh.js   # Module de UIManager : rafraîchissement du HUD et du menu
│       ├── UIGamepad.js      # Module de UIManager : routage de la manette, navigation du focus dans les menus, ligne Manette des Réglages
│       ├── UIVersus.js       # Module de UIManager : choix de difficulté du Duel de polarité, écran, dispositions, pause, résultat et records
│       ├── UIVersusLocal.js  # Module de UIManager : deux joueurs sur le même appareil, entrée, salon, périphériques et handicap
│       ├── UICalibration.js  # Module de UIManager : pilote de musique dans le crochet d'image, déverrouillage audio et dialogue de calibrage du rythme
│       ├── PulseDriver.js    # Démarre, arrête et pilote la musique selon la partie à l'écran
│       ├── RhythmCalibration.js # Machine d'états pure du calibrage : pulsations, taps, décalage médian
│       ├── VersusHud.js      # Interface du Duel de polarité : choix de disposition, annonces, barre du haut, charges entrantes, jauge d'impulsion et commandes
│       ├── UIInputBindings.js# Module de UIManager : liaisons d'installation, du tiroir et du clavier
│       ├── UIModals.js       # Module de UIManager : fenêtres, onglets de la boutique, piège de focus et inert
│       ├── UISettingsControls.js # Module de UIManager : commandes des réglages, Partager et compte à rebours du Défi du jour
│       ├── UIStats.js        # Module de UIManager : fenêtre Mes statistiques (vue d'ensemble, historique du Défi du jour, copie)
│       └── WorkshopView.js   # Améliorations, munitions spéciales en manche et barres de progression des succès
├── styles/main.css           # Mise en page adaptative et jetons de design
├── eslint.config.js          # Configuration plate ESLint 10
├── index.html                # Squelette de l'application et bandeau d'erreur de démarrage statique
├── manifest.webmanifest      # Manifeste PWA
├── sw.js                     # Service Worker réseau d'abord, avec délai d'attente et repli hors ligne versionné
└── tests/                    # Suites de tests automatisés Node.js
```

---

## Développement local

Nécessite Node.js 22 ou plus récent (la CI utilise Node.js 24).

```bash
# Lancer le serveur statique local sur le port 4200
npm start

# Lancer les suites du moteur, des utilitaires d'interface et des gardes du dépôt
npm test

# Analyser les sources avec ESLint (la première fois : npm install)
npm run lint

# Lancer les tests de fumée dans le navigateur (la première fois : npm install, puis npx playwright install chromium)
npm run test:browser

# Lancer le test lent de force (Difficile doit battre Facile dans au moins 80 % de 50 matchs du Duel de polarité ensemencés)
npm run test:slow
```

Les suites de `tests/` couvrent le moteur de jeu, la physique, la boucle de rendu, les utilitaires d'interface, les outils de calibration, et les gardes du dépôt :

- `typography.test.js` refuse, dans tous les fichiers texte, les variantes typographiques des caractères ASCII (tirets longs, guillemets courbes, points de suspension, espaces spéciales, ligatures).
- `pwa.test.js` vérifie que chaque fichier de `src/`, `configs/`, `locales/` et `icons/` est mis en cache par `sw.js`, que `index.html` déclare une `Content-Security-Policy` sans styles `'unsafe-inline'`, que la version du cache du Service Worker correspond à `package.json`, et, en exécutant `sw.js` dans un bac à sable, que l'activation ne supprime que les caches de l'application.
- `onboarding.test.js` vérifie que chaque mécanique a un indice dans les deux langues, qu'un niveau dont le tutoriel enseigne une mécanique l'affiche toujours, et que le niveau 1 ne montre que les bases.
- `fluxGenerator.test.js` vérifie que le générateur produit au moins 1 000 formes distinctes, chacune tenant entre les murs et suspendue à ses ancres, nommée dans les deux langues.
- `campaign.test.js` vérifie que les 800 niveaux générés sont des plateaux jouables, reconstruits à l'identique depuis leur numéro, que la difficulté monte d'un chapitre à l'autre, qu'un niveau marquant revient tous les 10 niveaux, que chaque niveau est nommé dans les deux langues, et que chacun est calibré pour le plateau qu'il est : un changement du générateur, des formes Flux ou de la courbe de la campagne le fait échouer tant que les niveaux ne sont pas mesurés à nouveau.
- `world.test.js` vérifie que chaque niveau (niveaux générés compris), chaque étape Flux (1 à 60) et la grille de Survie tiennent entre les murs, et qu'un monde de la largeur de conception construit chaque niveau à ses positions d'origine.
- `bot.test.js` vérifie les bots de calibration (ce que vaut un tir, quand le bot arsenal joue une spéciale, que le glouton n'en joue jamais) et la ligne de commande de `scripts/calibrate-campaign.mjs`.
- `pagesArtifact.test.js` vérifie que l'artefact GitHub Pages ne contient que des fichiers d'exécution, `engineApi.test.js` et `uiApi.test.js` figent l'API publique des prototypes de `GameEngine` et `UIManager` pour qu'un découpage en modules ne perde aucune méthode, `saveSchema.test.js` vérifie les migrations de sauvegarde ordonnées et idempotentes, `release.test.js` vérifie l'incrément de version et la promotion du CHANGELOG de `scripts/release.mjs`, et `fairness.test.js` vérifie qu'une graine donne les mêmes tirages de couleur au lanceur à tous les joueurs et que le Défi du jour n'applique ni amélioration d'Atelier ni munition de la boutique.
- `modeUnlocks.test.js`, `weeklyFlux.test.js`, `dailyHistory.test.js`, `playerStats.test.js` et `shotTimeline.test.js` vérifient les seuils de déblocage progressif, les clés et graines de semaine ISO (changements d'année, lundi 00:00 UTC), l'historique du Défi du jour sur 60 jours, les statistiques locales et les chronologies de tirs compactes ; `saveSchema.test.js` couvre aussi les migrations qui conservent tous les modes aux joueurs existants.
- `sagMeter.test.js`, `classicMode.test.js` et `uiSag.test.js` vérifient les règles de la jauge d'affaissement (ce qui compte comme un raté, remplissage, vidage par avalanche et son plafond, remise à zéro à la chute, phase d'alerte), la Survie et le Défi du jour qui descendent exactement une vague par jauge pleine, les étapes du mode Puriste (ni spéciales ni améliorations, chutes du rail qui déplacent ancres et pivots mais pas les plateformes, étape terminée, ligne franchie), le déterminisme à graine égale, les sauvegardes de partie (y compris l'ancien champ `shotsUntilWave`), la boîte d'affaissement du HUD et ses annonces, ainsi que la carte, les records et le texte de partage du mode Puriste.
- `ghostCodec.test.js`, `ghostDuel.test.js`, `ghostStorage.test.js`, `ghostEngine.test.js` et `uiGhostDuel.test.js` vérifient le lien de duel (allers-retours, rejet de chaque troncature et de chaque bit inversé, plafonds stricts, fuzzing qui ne lève jamais d'erreur et se ré-encode toujours à l'identique), l'interpolation du fantôme, l'hystérésis des annonces et les résultats, l'historique de duels borné et le nom, le cycle de vie d'un duel (revanche sans bonus ni série, inclinaison verrouillée, relance, rechargement et Continuer), ainsi que la carte de duel, le badge de rival, la ligne de fin de partie et le partage du défi.
- `versusRules.test.js`, `versusEngine.test.js`, `versusMatch.test.js`, `versusHud.test.js`, `uiVersus.test.js` et `versusRecords.test.js` vérifient le Duel de polarité (avec `localInput.test.js` et `uiVersusLocal.test.js` pour le mode à deux joueurs) : la table d'attaque, les règles de polarité et de charge, la montée, les impacts, l'atterrissage et les impulsions de champ, des matchs de CPU identiques à graine égale, les manches et la mort subite, la vue de stockage qui n'écrit rien, l'interface et le choix de disposition, les annonces, les fenêtres et les records. `tests/slow/versusStrength.test.js` (lancé par `npm run test:slow`) joue 50 matchs ensemencés de Difficile contre Facile.
- `hexGridMode.test.js`, `orbitalMode.test.js`, `pinballMode.test.js`, `convoyMode.test.js` et `mergeMode.test.js` vérifient les cinq modes Arcade à physique de sphères dédiée : accrochage sur grille hexagonale et Impulsion de Polarité d'une cellule, transfert de moment cinétique en apesanteur et Arcs Collecteurs à 360 degrés, gravité descendante du Flipper avec polarité en plein vol et remboursement au godet, tables de longueur d'arc des rails du Convoi avec Rappel Magnétique, et fusion rigide à 10 calibres du Bassin de Fusion, Supernova, débordement, sauvegardes de partie, charge de la Secousse et reprise des anciens records du prototype de secousse.

Les niveaux générés sont calibrés hors CI par deux bots (`scripts/bot/CampaignBot.js`) :

```bash
node scripts/calibrate-campaign.mjs
```

- le bot **glouton** vise avec la couleur chargée là où se trouvent le plus de sphères de cette couleur, et ne joue jamais de sphère spéciale. Il joue chaque niveau 16 fois (`calibration` dans `configs/campaign.json`) ; un niveau qu'il gagne moins d'une partie sur huit reçoit des tirs en plus, puis une autre graine, jusqu'à ce qu'une variante passe. Un joueur qui ignore les sphères spéciales peut donc toujours gagner.
- le bot **arsenal** lit la prévisualisation de visée que voit le joueur (ce qu'un tir détruit et fait tomber, `src/game/ImpactPreview.js`) pour la couleur chargée et pour chaque sphère spéciale en stock. Il joue une spéciale quand elle retire au moins 6 sphères et 3 de plus que le meilleur tir de couleur, ou dès que les tirs restants ne dépassent plus le nombre de spéciales (`calibration.bot.arsenal`). Il joue lui aussi 16 fois chaque variante, et un niveau qu'il gagne moins d'une partie sur deux (`minArsenalWinRate`) reçoit de même des tirs en plus, puis une autre graine, jusqu'à ce qu'une variante passe les deux seuils.

Les seuils d'étoiles viennent du score médian du bot désigné par `calibration.starPolicy` : trois étoiles au rapport que montrent les 24 niveaux dessinés pour ce bot (`threeStarMedianFactors` : 1,08 pour le glouton, 0,79 pour l'arsenal), deux étoiles à 63 % des trois. Le résultat, avec les mesures des deux bots, va dans `configs/campaignTuning.json` ; `--from` et `--to` ne mesurent qu'une plage, `--workers` fixe le nombre de processus parallèles (par défaut, tous les coeurs moins deux), et `--dry-run` affiche les mesures sans les écrire. Seule une mesure à blanc peut porter sur un niveau dessiné, tel qu'il est (`--from 24 --to 24 --dry-run`) ; une exécution qui écrit commence au premier niveau généré.

Le mode Puriste est mesuré hors CI par le même bot glouton : `node scripts/calibrate-classic.mjs [--seeds <n>]` affiche la part de parties qui terminent l'étape 1 et celle qui atteignent l'étape 3 ou plus, face aux objectifs du script. Il n'écrit jamais de configuration ; `sag.modes.classic` et `classic` dans `configs/game.json` se règlent à la main.

Le Flux ne tire ses formes générées que parmi celles qui restent loin de la ligne de danger quand on les laisse seules. `npm run calibrate:flux` (`scripts/calibrate-flux-shapes.mjs`) laisse chaque forme générée valide s'affaisser seule sur des fils d'exécution et écrit les marges entières dans `configs/fluxShapeTuning.json`, avec l'empreinte de tout ce dont l'affaissement dépend ; `flux.shapeSettle.minMarginPx` est le seuil. `tests/fluxGenerator.test.js` échoue quand le fichier ne correspond plus aux configurations, et changer le lot ou le seuil impose d'incrémenter `ghostDuel.contentVersion.flux`. La campagne n'utilise pas cette table.

`tests/browser/smoke.test.js` ouvre la vraie page dans Chromium sans interface, aux cinq mises en page prises en charge (ordinateur, tablette en portrait, téléphone en paysage, téléphone en portrait et téléphone étroit en portrait). Il échoue sur toute erreur de console, tout défilement horizontal ou tout libellé de bouton coupé, vérifie la mise en page au niveau 1 (sans sphère spéciale) et au niveau 2 (avec), vérifie que la sélection des niveaux s'ouvre sur le chapitre du niveau en cours et change de chapitre, vérifie que les fenêtres Réglages, Niveaux, Atelier, Mes statistiques et Pause mettent la partie en pause puis la reprennent, parcourt la victoire, la défaite et la reprise après rechargement, vérifie qu'une défaite en Campagne ne propose pas Partager tandis que le Défi du jour, la Survie et le Mode Flux copient leur résultat dans le presse-papiers, vérifie qu'un profil neuf trouve les modes à débloquer verrouillés (toucher l'un d'eux explique pourquoi) alors qu'un joueur existant garde tous ses modes, qu'un lien Flux partagé débloque le Flux, que l'historique du Défi du jour et Copier mes statistiques fonctionnent et que le bouton Flux hebdomadaire lance la graine de la semaine en cours, et vérifie que la jauge d'affaissement s'affiche dans le HUD en Survie à chaque mise en page sans changer la grille du HUD et passe en alerte après des ratés scriptés, qu'un profil neuf trouve la carte Puriste verrouillée (la toucher nomme le niveau 4) alors qu'un joueur existant lance le mode Puriste, vérifie qu'un lien de duel ouvre sa carte sur un profil neuf et qu'Accepter lance le duel Flux avec le badge de rival, qu'une partie sauvegardée demande d'abord confirmation, qu'un lien abîmé affiche une carte d'erreur et laisse le démarrage normal, qu'un duel sur un ancien Défi du jour est une revanche sans bonus de première partie, qu'une fin de partie en duel énonce le résultat et que Partager le défi porte le score du joueur, qu'un duel laisse les colonnes du HUD inchangées à chaque mise en page, et vérifie qu'un tremblement de souris garde une visée affinée au clavier. La CI le lance dans une tâche séparée.

Tout nouveau fichier chargé à l'exécution doit être ajouté à `PRECACHE_ASSETS` dans `sw.js`. Pour publier une version, ranger les notes sous `## [Unreleased]` dans `CHANGELOG.md`, puis lancer `npm run release -- <patch|minor|major|X.Y.Z>` (ajouter `--dry-run` pour prévisualiser) : il incrémente `package.json`, `package-lock.json` et `APP_VERSION` dans `sw.js` et promeut la section Unreleased, sans jamais valider, étiqueter ni pousser. Le déploiement sur GitHub Pages se fait depuis la CI, une fois les tâches de test et de navigateur réussies sur `master`.

---

## Licence

Copyright 2026 Julien Bombled. Distribué sous [licence Apache, version 2.0](http://www.apache.org/licenses/LICENSE-2.0).
