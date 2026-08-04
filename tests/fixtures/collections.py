"""Reference collections used to validate the source-member matcher.

These are the real-world test datasets for feasibility of exact-affirmative
automatic matching (issue #68): a Dune library that ships both ``epub`` and
``Mobi`` copies of every book, and an Expanse library with nested
``Series NN Title`` directories. Additional collections can be added here so a
single source of truth drives both the unit tests and the feasibility demo.
"""

from __future__ import annotations

DUNE_FILES = [
    "Dune 01 Dune - Frank Herbert.epub",
    "Dune 02 Dune Messiah - Frank Herbert.epub",
    "Dune 03 Children of Dune - Frank Herbert.epub",
    "Dune 04 God Emperor of Dune - Frank Herbert.epub",
    "Dune 05 Heretics of Dune - Frank Herbert.epub",
    "Dune 06 Chapterhouse Dune - Frank Herbert.epub",
    "Dune 07 Hunters of Dune - Brian Herbert.epub",
    "Dune 08 Sandworms Of Dune - Brian Herbert.epub",
    "DUNE A Brief Guide - BookWyrm.epub",
    "Dune Genesis - Frank Herbert.epub",
    "Heros of Dune 01 Paul of Dune - Brian Herbert.epub",
    "Heros of Dune 02 The Winds of Dune - Brian Herbert.epub",
    "Legends of Dune 01 The Butlerian Jihad - Brian Herbert.epub",
    "Legends of Dune 02 The Machine Crusade - Brian Herbert.epub",
    "Legends of Dune 03 The Battle of Corrin - Brian Herbert.epub",
    "Prelude to Dune 01 House Atreides - Brian Herbert.epub",
    "Prelude to Dune 02 House Harkonnen - Brian Herbert.epub",
    "Prelude to Dune 03 House Corrino - Brian Herbert.epub",
    "Schools of Dune 01 Sisterhood of Dune - Brian Herbert.epub",
]

DUNE_MOBI = [name.replace(".epub", ".mobi") for name in DUNE_FILES]

EXPANSE_FILES = [
    "./The Expanse/The Expanse 03 Abaddon's gate/Abaddon's Gate - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 0.2 The Churn/Churn, The - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 0.5 The Butcher of Anderson Station/"
    "Butcher of Anderson Station, The - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 01 Leviathan Wakes/Leviathan Wakes - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 02 Caliban's War/Caliban's War - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 02.5 Gods of Risk/Gods of Risk - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 0.1 Drive/Drive - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 04 Cibola Burn/Cibola Burn - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 05 Nemesis Games/Nemesis Games - James S. A. Corey.mobi",
    "./The Expanse/The Expanse 05.5 The Vital Abyss/The Vital Abyss - James S A Corey.epub",
    "./The Expanse/The Expanse 06 Babylons Ashes/Babylon's Ashes.epub",
]


def dune_members() -> list[str]:
    return DUNE_FILES + DUNE_MOBI
