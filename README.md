# World Mapgen Console

Console application based on [redblobgames/mapgen4](https://github.com/redblobgames/mapgen4). It keeps the mesh, elevation, rainfall, river generation, and reference-style map rendering pipeline, but the active application is now a Node CLI that writes PNG files directly from terminal runs.

There is no Vite server, browser page, WebGL canvas, or Playwright export path in the normal workflow.

## Install

```sh
npm install
```

## Build

```sh
npm run build
```

This bundles the console app to:

```sh
dist/world-mapgen.cjs
```

## Generate A Map

```sh
npm run generate
```

Default output:

```sh
output/mapgen4.png
```

Generate with explicit controls:

```sh
npm run generate -- --out output/mapgen4-seed.png --set elevation.seed=187 --set rivers.flow=0.2
```

Generate a smaller PNG:

```sh
npm run generate -- --size 1024 --out output/seed-42-1024.png --set elevation.seed=42
```

Generate with the exact `mapgen4.ts` input preset:

```sh
npm run generate -- --size 1600 --controls mapgen4-controls.json --out output/mapgen4-input.png
```

Generate the provided `output/test-mapgen4.png` sample input:

```sh
npm run generate -- --size 2048 --controls test-mapgen4-controls.json --out output/test-mapgen4-console.png
```

The renderer is CPU-only, but it follows the original mapgen4 visual path closely: biome colormap, river triangle geometry, slope lighting, coastline/depth outlines, and bathymetry bands are all calculated during the terminal PNG export.

Run the built console app directly:

```sh
node dist/world-mapgen.cjs --help
node dist/world-mapgen.cjs --out output/direct.png --set elevation.seed=99 --summary
```

`npm run export:png` is kept as an alias for `npm run generate`.

## Civilizations

Civilizations are an optional simulation layer over the generated terrain. They choose suitable homelands, found capitals and towns, claim territory within a bounded travel distance from each controlled settlement, plan new town sites near existing settlements, invade nearby enemy settlements after the early expansion period, and advance by year. Roads connect same-civilization settlements only after both endpoints have been controlled for a while, and older roads render stronger than new roads. Civilizations maintain local military units, equipment caches, spy networks, and spy operations; battles now record named battlefield locations, map coordinates, terrain context, committed units, intelligence operations, and attacker/defender power. The PNG renderer shades claimed territory and draws borders between neighboring claims; settlement markers are the city/town layer. The simulation has its own seed, so settlement, road, and territory placement can stay stable while render settings stay locked.

Generate a map with civilizations advanced 300 years:

```sh
npm run generate -- --civilizations 5 --years 300 --civ-seed 77 --out output/civilizations.png --civ-json output/civilizations.json
```

Generate a Dwarf-Fortress-style Legends archive and self-contained wiki viewer:

```sh
npm run generate -- --size 1024 --controls simulation-controls.example.json --civilizations 5 --years 100 --civ-seed 77 --out output/legends-map.png --legends-json output/legends/legends.json --legends-html output/legends/index.html
```

Serve the generated viewer over local HTTP:

```sh
npm run serve:legends -- output/legends 8787
```

Open `http://127.0.0.1:8787/index.html`. The viewer has a starter archive embedded in `index.html`, but full index search and rich on-demand pages use generated `indexes/`, `records/`, `texts/`, and `mentions/` JSON chunks. Long `headline` and `description` fields are written to `texts/` and loaded only when a page needs them, with bounded browser-side chunk caches. Serving the folder over HTTP avoids browser `file://` restrictions for those chunk requests.

The Legends viewer is a local HTML file with wiki-style links such as `#people/42`, `#births/1184`, `#age-milestones/24`, `#appearance-features/24`, `#person-allegiances/42`, `#preferences/9`, `#traditions/9`, `#epithets/9`, `#reputation-milestones/9`, `#settlements/7`, `#settlement-controls/7`, `#natural-features/3`, `#structures/4`, `#households/3`, `#lineages/4`, `#organizations/5`, `#memberships/8`, `#organization-ranks/8`, `#beliefs/2`, `#belief-adherences/8`, `#myths-magic/2`, `#myths/2`, `#doctrines/2`, `#magic-roles/2`, `#prophecies/2`, `#civilization-goals/2`, `#sacred-sites/2`, `#offices/4`, `#office-terms/6`, `#laws/8`, `#cases/11`, `#testimonies/20`, `#conflicts/2`, `#battles/6`, `#battle-participations/12`, `#injuries/15`, `#illnesses/15`, `#care-records/15`, `#wound-legacies/15`, `#memorials/20`, `#burials/20`, `#death-records/20`, `#ambitions/9`, `#apprenticeships/6`, `#skills/8`, `#residences/10`, `#careers/10`, `#journeys/12`, `#roads/3`, `#relationships/9`, `#relationship-milestones/9`, `#unions/4`, `#artifacts/3`, `#chronicles/4`, `#memories/30`, `#thoughts/18`, `#personality-shifts/12`, `#opinions/14`, `#social-claims/14`, `#conversations/4`, `#rumors/12`, `#secrets/5`, `#schemes/7`, `#feuds/3`, `#oaths/4`, `#ceremonies/6`, `#ceremony-participations/9`, `#activities/9`, `#teachings/4`, `#projects/9`, `#project-participations/9`, `#obligations/6`, `#holdings/8`, `#belongings/9`, `#possession-attachments/9`, `#estates/3`, and `#events/120`. Founding beliefs now seed a compact myth cycle instead of a single myth: multiple myths can produce doctrines, active magic-role holders, prophecy goals, doctrine-backed kingdom goals, and sacred sites, with myths, doctrines, roles, prophecies, and goals linked to nearby named mountains, rivers, forests, springs, caves, or coasts when the terrain supports it. Each civilization also gets a `#myths-magic/N` hub page that links its religion-like belief roots, myths, doctrines, magic-role holders, open prophecies, active kingdom goals, sacred places, source events, and social echoes. Magic-role pages link directly to the kingdom goals they sponsor, and civilization-goal pages link back to the oracle, seer, warder, runesmith, star-scribe, oathbinder, root-mender, wayfinder, or other role responsible for the aim. Belief, myth, doctrine, magic-role, prophecy, civilization-goal, sacred-site, and Myths & Magic hub pages include Mythic Summary hubs that put origins, holders, targets, kingdom links, records, rumors, vows, relics, pilgrimages, and recent events before the exhaustive relation lists. Open prophecies can be reinterpreted by magic-role holders or local adherents, creating prophecy rumors, secrets, oaths, omen thoughts, prophecy-targeted schemes, and direct links back into kingdom goals. Serious and grave healed injuries can now leave wound legacy records such as scars, limps, maimed limbs, chronic pain, battle fright, or fever marks, each linked to the person, injury, care record, healer, battle role, memories, and later social echoes. Burial records preserve where the dead were laid to rest, who mourned, which memorial or battle they connect to, and which artifacts or belongings became grave goods. Death records provide a canonical death page for each dead person, linking the source death event, cause, fatal injuries or illnesses, battle role, memorial, burial, estate, house, lineage, belief, and later social echoes. Birth records preserve each person's first canonical life record, including parents, household, lineage, union, belief, birthplace, and the source `person-born` event. Age milestone records preserve coming-of-age and elderhood transitions, linking the profession-change event, career record, household, lineage, workplace, place, and civilization. Appearance feature records preserve baseline descriptions, elder marks, and wound marks linked to the person, source life record, household, lineage, place, civilization, and later echoes. Strong memories can now create personality shifts, changing a person's traits or values after severe, sacred, civic, or family-defining events; value shifts can awaken new needs and occasionally start an ambition that links back to the source memory and personality shift. Strong opinions toward people can now become favors or grudges, nudging relationship trust, affinity, familiarity, and tension while recording whether the claim remains active, is repaid, settles, or fades. Reputation milestones now preserve the moments when a person becomes locally known, widely renowned, or earns an epithet, with links to the person, source event, earned name, house, lineage, place, civilization, and later echoes. Relationship milestones now preserve the notable moments in a bond: formation, deepening, strain, reconciliation, claim-made turns, and endings, with links to the people, relationship, source event, claim or conversation, place, and later echoes. People, birth records, age milestone records, appearance feature records, person allegiance terms, preferences, traditions, epithets, reputation milestones, places, settlement control terms, natural features, structures, households, lineages, organizations, memberships, organization ranks, beliefs, belief adherences, Myths & Magic hubs, myths, doctrines, magic roles, prophecies, civilization goals, sacred sites, offices, office terms, laws, cases, testimonies, conflicts, battles, battle participation records, injuries, illnesses, care records, wound legacies, memorials, burials, death records, ambitions, apprenticeships, skills, residences, careers, journeys, roads, relationships, relationship milestones, unions, artifacts, chronicles, memories, thoughts, personality shifts, opinions, social claims, conversations, rumors, secrets, schemes, feuds, oaths, ceremonies, ceremony participation records, activities, teachings, projects, project participation records, obligations, holdings, belongings, possession attachments, estates, civilizations, and events link to each other through their timelines.

Military units, equipment caches, spy networks, and spy operations are also exported as wiki routes (`#military-units/N`, `#equipment-caches/N`, `#spy-networks/N`, and `#spy-operations/N`). Battle pages expose a Battlefield relation group with the battlefield name, terrain class, map coordinate, triangle id, attacker/defender units, and linked spy operations.

Need episodes are durable hardship and recovery records available at routes like `#need-episodes/12`; they link the affected person, settlement, household or structure, source memory or personality shift, latest relief activity, and the events that started or resolved the pressure.

The sidebar search stays scoped to the selected tab by default. Turning on `All` searches every generated legend index after three typed characters, including high-volume events, memories, thoughts, personality shifts, need episodes, allegiances, residences, careers, possessions, rumors, secrets, oaths, ceremonies, work records, and other life-history records that are otherwise buried in their own tabs.

World Mentions sections render every generated backlink group, including allegiances, adherences, doctrines, civilization goals, sacred sites, conversations, teachings, project and ceremony roles, and chapter summaries, so a person, place, event, artifact, myth, or goal page is not limited to a hand-picked subset of related records.

Gods are first-class Myths & Magic records available at routes like `#gods/1`, with linked `#commandments/N`, `#destinies/N`, and `#miracles/N` pages. Each civilization now receives a deterministic creation-seat domain before capitals are placed; that domain biases homeland selection toward suitable terrain matching the eventual creator god's mythic concern, such as rivers, mountains, harvest land, stars, storms, trade, forge, or ancestors. Each god carries explicit control spheres plus readable control notes for creation seating, religious mandate, prophecy method, destiny pressure, miracle bias, and commandment style. Founding myths use the creation claim to explain why a people were first seated at their origin settlement, while later doctrines, prophecies, kingdom goals, miracles, and commandments link back to the god shaping them.

Person pages include a Life Summary section that behaves like a wiki hub for that person, linking their family, home, siblings, ancestors, descendants, household kin, lineage kin, career records, needs, ambitions, strongest memories, recent thoughts, personality shifts, strong opinions, closest or most strained relationships, illness/injury care records, and notable life events. They also include a Social Web section that synthesizes bonds, claims, conversations, opinions, feuds, oaths, and obligations into supportive, tense, mixed, and known ties around the person. Derived Life Chapters cover birth and family, homes, work, daily life, bonds, beliefs, public service, law and intrigue, hardships, legacy, and death, with each chapter linking back to the records and source events it summarizes. Daily-life chapters gather activities, needs, thoughts, preferences, and conversations so a person page can answer what the person did, wanted, liked, and talked about. Ambitions can now link personal motives to beliefs, doctrines, magic roles, prophecies, civilization goals, source memories, and personality shifts, so a kingdom-scale myth, hard memory, or changed value can be traced down to the people trying to act on it.

Social claims are durable favor and grudge records available at routes like `#social-claims/14`. They form from strong person-targeted opinions, link back to the source memory and event, optionally attach to a relationship, can seed obligations, oaths, feuds, revenge schemes, and relationship milestones, and can later be repaid, settled, or faded by death.

Person pages also include a Legacy Summary for death, memorials, burials, estate settlements, achievements, works, created artifacts, passed-on artifacts or belongings, descendants, birth records of children, memories, opinions, rumors, secrets, schemes, feuds, oaths, obligations, and unfinished ambitions.

Birth, age milestone, appearance feature, epithet, residence, career, journey, relationship, relationship milestone, union, ambition, apprenticeship, skill, injury, illness, memorial, and burial pages include Life Milestone Summary hubs so a person's origins, coming-of-age and elderhood transitions, visible marks, earned names, movements, work, bonds, training, health, goals, and remembrance can be read as individual history entries with source events, people, places, consequences, and echoes.

Preference, tradition, membership, organization-rank, belief-adherence, office, office-term, law, case, testimony, ceremony, ceremony-participation, activity, teaching, project, project-participation, chronicle, written-work, and estate pages include Institutional or Record Summary hubs so civic offices, legal disputes, rites, lessons, rank advancement, work, archives, authored records, and death-property handoffs open with their people, institutions, sources, subjects, consequences, and reception before the full relation list. Contested estates can now open inheritance dispute cases, which can spawn testimony, verdicts, rumors, feuds, and oaths linked back to the estate record.

Settlement control, person allegiance, and battle participation pages include Continuity Summary hubs so captures, political transfers, changed loyalties, and individual battlefield roles can be read through their trigger events, war context, affected people or places, consequences, records, and social echoes.

Event pages include Event Summary hubs that group each timeline entry by primary record, people, places and polities, institutions and beliefs, conflict or hardship, life/work/material records, social echoes, source chain, and aftermath/backlinks. This makes individual events usable as wiki nodes instead of only one-line timeline entries.

Place, artifact, road, civilization, organization, household, and lineage pages include compact Summary sections before their exhaustive Relations lists. Place summaries link current control, notable residents, institutions, families, roads, journeys, civic history, local life, artifacts, records, and recent events. Settlement pages also include derived Place Chapters for founding and control, people and families, buildings and work, roads and journeys, faith and culture, law and politics, conflict and hardship, and memory and legacy. Structure pages include derived Structure Chapters for construction, institutions, residents and households, work and training, rites and culture, law and hardship, and assets and records. Artifact summaries link holder and creator, provenance events, conflicts, journeys, ambitions, vows, rites, work, records, and recent events. Artifact records now carry explicit scale, so trinkets such as lockets, charms, jewelry, and pocket-watch-style timepieces can sit in the same wiki as monumental works, pyramids, obelisks, colossi, and other wonders created by construction projects. Artifact pages also include derived Artifact Chapters for creation, custody, travel, conflict and capture, dedication and rites, work and claims, records and memory, and current resting place. Road summaries link endpoints, civilization, route stats, and traffic. Road pages also include derived Road Chapters for opening and route, traffic and journeys, trade and pilgrimage, conflict and danger, and records and legacy. Conflict pages include derived Conflict Chapters for outbreak, campaigns and battles, casualties and captures, control and aftermath, vows and rumors, and records and legacy. Battle pages include derived Battle Chapters for prelude, commanders and sides, fighting and outcome, casualties and wounds, spoils and control, and records and memory. Civilization summaries link notable people, settlements, roads, politics, war, culture, institutions, homes, lineages, artifacts, records, and recent events. Civilization pages also include derived Civilization Chapters for founding and expansion, rule and law, beliefs and goals, war and captures, roads and journeys, people and families, works and records, and current legacy. Organization, household, and lineage summaries make guilds, temples, households, and families browsable through leaders, members, homes, work, rites, assets, memories, obligations, feuds, and authored records. Organization pages also include derived Organization Chapters for founding, leadership and membership, work and training, rites and beliefs, assets and works, and records and legacy. Household pages include derived Household Chapters for founding and family, homes and members, daily work, bonds and obligations, hardship and memory, and assets and legacy. Lineage pages include derived Lineage Chapters for founding ancestors, household branches, members and standing, work and training, conflict and hardship, and records and legacy.

Artifact records also include purpose, value, decoration kind, current condition, physical detail text, optional inscription, depiction links, and dedication links. Artifact provenance now tracks gifts, inheritance, capture, loss, recovery, theft, and contested claims, so trinkets and great works can become sources of grudges, restitution obligations, oaths, rumors, and feuds. Artifact condition pages record creation state, capture wear or battle damage, loss, recovery, theft wear, and later restoration work with links to the artifact, actor, place, project, battle, and source event. Those refs are indexed as World Mentions, so a person, project, belief, place, or source event can show the artifacts that depict, honor, damage, lose, steal, recover, contest, or restore it.

Derived person, relationship, place, artifact, road, structure, conflict, battle, civilization, organization, household, and lineage chapters are also exported to the Legends viewer as searchable `#chapters/N` pages. These are viewer-only records generated from the canonical owner records, so `legends.json` remains stable while the wiki can search and link chapter summaries directly. Owner pages include chapter-record links in each embedded chapter block, chapter records appear in World Mentions for the people, places, events, myths, prophecies, goals, and artifacts they cite, and chapter pages receive incoming World Mentions from their owner record and source events.

Written works are durable authored works available at routes like `#written-works/5`. They include songs, poems, prayers, manuals, treatises, biographies, genealogies, law codes, ledgers, and travelogues, with links to the author, storage place, organization or belief, source chronicle, source events, subjects, physical book copies, memories, opinions, conversations, rumors, and other social records.

Traditions are named local customs available at routes like `#traditions/5`. Festival customs, craft styles, food customs, funerary rites, legal customs, hospitality codes, training drills, and story cycles link back to founding people, settlements, beliefs, organizations, adherents, practiced activities, ceremonies, written works, and related social records.

Teachings are person-to-person lessons available at routes like `#teachings/4`. Study, training, craft practice, worship, and active apprenticeships can create lessons that link mentor, student, specialty, skill record, activity, institution, belief, tradition, written work, memories, opinions, and source events.

Conversations are person-to-person exchanges available at routes like `#conversations/4`. Shared meals, market visits, worship, training, study, craft work, and play can create warm, tense, serious, joyful, worried, guarded, or curious exchanges that link speakers, listeners, relationships, activities, teachings, rumors, secrets, memories, beliefs, traditions, artifacts, and source events.

Memory, thought, personality-shift, opinion, conversation, rumor, secret, scheme, feud, oath, obligation, holding, belonging, possession-attachment, and care-record pages include Record Summary hubs before their exhaustive Relations lists. These summaries put the actor, patient, healer, changed person, place, source event, subjects, consequences, social echoes, material holders, object attachments, and recent events at the top so individual life records read like small wiki entries instead of only raw backlinks.

Testimonies are court statements available at routes like `#testimonies/20`. Trials now record who testified, whether the statement helped or hurt the accused, credibility, pressure, and links to cases, laws, offices, witnesses, victims, rumors, secrets, conversations, memories, and verdict events.

Thoughts are individual reactions available at routes like `#thoughts/18`. They link a person to a source memory, event, activity, ceremony, preference, tradition, dream, or omen with tone, intensity, mood, stress, and subject backlinks. Dream and omen thoughts can point back to beliefs, myths, doctrines, magic roles, prophecies, civilization goals, and sacred sites.

Sacred sites are named mythic places available at routes like `#sacred-sites/2`. They are seeded from beliefs and link to myths, doctrines, magic roles, prophecies, civilization goals, local rites, pilgrimages, relics, offerings, thoughts, memories, and timeline events. Pilgrimage journeys now carry a `sacredSiteId`, so the journey page links to the site and the sacred-site page lists the travelers who came there. Pilgrimages can dedicate carried artifacts or newly made relics; artifact provenance entries include `journeyId` and `sacredSiteId` when that object becomes part of a site's history.

People also carry persistent needs such as rest, companionship, craft, training, learning, faith, family, justice, wealth, comfort, legacy, health, or play. Need states drift each year, affect stress and morale, and link to the activity, ceremony, thought, preference, tradition, memory, or personality shift that most recently shaped or satisfied them.

Relationships track more than a label and strength. Friendship, rivalry, mentorship, and patronage records include affinity, trust, tension, familiarity, last interaction year/event, active or ended state, and ending reason when applicable. Annual maintenance can now record explicit strain and reconciliation events, and relationship pages include derived chapters for formation, turning points, conversations, claims and obligations, and endings. Relationship pages also show the surrounding social web for both people, so a bond can be read in the context of each person's allies, rivals, claims, debts, and feuds.

Oaths are balanced across vengeance, service, pilgrimage, craft, guardianship, secrecy, reconciliation, and prophecy sources so a history does not collapse into only feud-driven promises.

Generate a 100-year annual civilization history with agents, settlement resources, events, roads, and high-resolution map frames:

```sh
npm run generate -- --size 1024 --controls simulation-controls.example.json --civilizations 5 --years 100 --civ-seed 77 --snapshot-dir output/settlement-claims-100-year-history --snapshot-every 1 --snapshot-render-every 1 --snapshot-gif output/settlement-claims-100-year-history/settlement-claims-100-years.gif --civ-json output/settlement-claims-100-year-history/final-summary.json --out output/settlement-claims-100-year-history/final.png
```

Snapshot output layout:

- `manifest.json`: run settings and final counts.
- `history.json`: all recorded yearly snapshots.
- `years/year-000.json` through `years/year-100.json`: annual state summaries.
- `maps/year-000.png` through `maps/year-100.png`: rendered map frames.
- `settlement-claims-100-years.gif`: optional timeline GIF when `--snapshot-gif` is supplied.

Useful civilization options:

- `--civilizations <count>` or `--civs <count>`: number of civilizations to seed.
- `--years <years>`: number of years to advance. If years are provided without a civilization count, 5 civilizations are used.
- `--civ-seed <seed>`: deterministic seed for civilization placement and expansion.
- `--civ-workers <count>`: civilization worker threads. Parallel mode is the default: if this option is omitted, the worker target matches the civilization count, so a 5-civilization run starts 5 workers. Workers currently parallelize civilization terrain analysis, settlement-site ranking, capital/town seed plan and adult/child draft generation, triangle territory projection, annual age/profession drafts, settlement economy drafts, household pair drafts, birth-count drafts, birth parent planning, migration planning, and internal road pathfinding; use `--civ-workers 1` for a deterministic one-worker debug run.
- `--expansion-rate <rate>`: expected town-founding attempts per civilization per 100 years. The default keeps the previous every-interval expansion behavior, while lower values are useful for long-horizon stress runs.
- `--settlement-interval <years>`: years between town-founding opportunities.
- `--claim-radius <distance>`: normal settlement territory claim distance.
- `--capital-claim-radius <distance>`: capital settlement territory claim distance.
- `--civ-json <json>`: write civilization, territory, claimed Voronoi region, road, settlement, and population summary data.
- `--civ-profile-json <json>`: write compact final count, event, and memory profile JSON for long-run diagnostics.
- `--civ-profile-dir <dir>`: with `--progress-every`, write compact profile JSON at each checkpoint, useful for stress runs that may be stopped early.
- `--profile-civ-phases`: include per-year CPU phase timings in progress logs and profile JSON.
- `--compact-event-ref-names-after <years>`: compact old event refs after the retention window; defaults to 30 years.
- `--compact-event-refs-every <years>`: run old-event ref compaction every N simulated years; defaults to 5.
- `--spill-event-text-dir <dir>`: write old event headlines/descriptions to disk chunks and lazy-load them back when needed. This is intended for long stress/profile runs where old event prose is not hot.
- `--spill-event-text-after <years>`: spill event text after the retention window; defaults to the event-ref retention window when `--spill-event-text-dir` is supplied.
- `--spill-event-text-every <years>`: run old-event text spilling every N simulated years; defaults to `--compact-event-refs-every` when spilling is enabled.
- `--spill-event-text-cache-chunks <count>`: number of spilled event text chunks to cache after lazy reads; defaults to 128 when spilling is enabled. Long stress runs use a larger cache to avoid repeated disk reads while still keeping the event array compact.
- `--compact-new-event-refs`: compact high-volume event refs immediately as they are created. This can reduce some CPU paths, but it may increase peak heap, so it is off by default.
- `--gc-after-compaction`: request garbage collection after compaction checkpoints. This only takes effect when running Node with `--expose-gc`, and is intended for long stress runs.
- `--legends-json <json>`: write detailed Legends archive data for people, birth records, age milestone records, appearance feature records, person allegiance terms, preferences, traditions, earned epithet records, reputation milestones, places, settlement control terms, natural features, structures, households, lineages, organizations, memberships, organization ranks, beliefs, belief adherences, Myths & Magic hubs, myths, doctrines, magic roles, prophecies, civilization goals, sacred sites, offices, office terms, laws, cases, testimonies, conflicts, battles, battle participation records, military units, equipment caches, spy networks, spy operations, injuries, illnesses, care records, wound legacies, memorials, burials, death records, ambitions, apprenticeships, skills, residences, careers, journeys, roads, relationships, relationship milestones, unions, artifacts, chronicles, memories, thoughts, personality shifts, opinions, social claims, conversations, rumors, secrets, schemes, feuds, oaths, ceremonies, ceremony participation records, activities, teachings, projects, project participation records, obligations, holdings, belongings, possession attachments, estate settlements, civilizations, and events. Birth entries tie a person to their source `person-born` event, parents, household, lineage, family union, belief, birthplace, and civilization. Age milestone entries tie simulated coming-of-age and elderhood transitions to the source `profession-changed` event, the active career record, household, lineage, workplace, place, and civilization. Appearance feature entries tie baseline descriptions, elder marks, and wound marks to the person, source birth, age milestone, or wound legacy, household, lineage, place, civilization, source event, and later echoes. Care records tie a healed injury or illness to the patient, healer, household, structure, source event, and health/morale deltas. Wound legacy records tie lasting scars, limps, maimed limbs, chronic pain, battle fright, and fever marks to the healed injury, care record, healer, battle role, person, place, effects, source event, memories, and later echoes. Battles include battlefield name, terrain, map coordinates, triangle id, side units, spy operations, and power totals. Reputation milestone records tie durable fame changes to the person, source event, earned epithet when present, household, lineage, place, civilization, reputation values, and later echoes. Relationship milestone records tie notable bond changes to the people, relationship, source event, social claim or conversation, place, bond status, and later echoes. Epithet entries tie an earned name to the person, household, lineage, source event, related subjects, and later social echoes. Organization rank entries tie institutional standing to a person, membership, organization, duty, prestige, sponsor, previous rank, source event, and later echoes. Possession attachments tie emotionally significant artifacts and belongings to the person, household, lineage, source event, memories, later echoes, and object history that made them matter. Estate entries tie a death event to heirs, household, lineage, memorial, transferred artifacts, holdings, belongings, transfer events, and any inheritance dispute cases, feuds, rumors, or oaths. Burial entries tie a death event to a resting place, mourners, memorial, battle, structure, household, belief, and grave goods. Death records tie each dead person to the source event, cause, fatal health records, battle role, memorial, burial, estate, house, lineage, belief, and later social echoes. Founding belief entries now include a small myth cycle, doctrine goals, active magic-role patrons, prophecy goals, sacred sites, and terrain-linked mythic features; civilization records carry `beliefIds` and `mythsMagicId`, and the `mythsAndMagic` array provides one civilization-level hub record for those linked records. Ambition entries include belief, doctrine, magic-role, prophecy, and civilization-goal context when those motives come from the culture's mythic layer, scheme entries track intrigue around offices, secrets, cases, ambitions, feuds, prophecies, and civilization goals, thought entries can include dream or omen reactions tied to the same records and sacred places, personality-shift entries show the strong memory that changed a person's trait or value, and social-claim entries show favors and grudges that grow out of opinions and alter relationships.
- The Legends JSON also includes `writtenWorks` and `writtenWorkCount` for authored works and their wiki links.
- The Legends JSON also includes `traditions` and `traditionCount` for local customs practiced by people, activities, and ceremonies.
- The Legends JSON also includes `gods`/`godCount`, `commandments`/`commandmentCount`, `destinies`/`destinyCount`, and `miracles`/`miracleCount` for divine-control records linked into beliefs, myths, magic roles, prophecies, kingdom goals, sacred sites, and source events.
- The Legends JSON also includes `thoughts`, `thoughtCount`, `personalityShifts`, `personalityShiftCount`, `socialClaims`, and `socialClaimCount` for person-level reactions, durable trait/value changes, and favor/grudge records linked to memories, opinions, relationships, places, and source events. Ambitions may include `sourceMemoryId` and `personalityShiftId` when a changed value or trait sparks a new life goal.
- Each person entry includes `needStates`, a compact set of persistent personal needs with urgency, satisfaction, latest satisfying activity or ceremony, and related thought/preference/tradition links.
- The Legends JSON also includes `needEpisodes` and `needEpisodeCount` for durable need crises, relief arcs, and links from people, memories, personality shifts, thoughts, activities, ceremonies, places, households, structures, civilizations, and events.
- The Legends JSON also includes `reputationMilestones`/`reputationMilestoneCount` and `relationshipMilestones`/`relationshipMilestoneCount` for durable fame and relationship history entries linked to people, source events, epithets, bonds, claims, conversations, places, civilizations, and later echoes.
- Relationship entries include affinity, trust, tension, familiarity, last interaction, ending metadata, and derived relationship chapters so people pages can separate close, strained, reconciled, and ended bonds.
- `--legends-html <html>`: write a self-contained offline Legends wiki viewer.
- `--snapshot-dir <dir>`: write annual history JSON and periodic PNG frames to a directory.
- `--snapshot-every <years>`: annual history interval; defaults to 1 when snapshots are enabled.
- `--snapshot-render-every <years>`: rendered map frame interval; defaults to 25 when snapshots are enabled.
- `--snapshot-gif <gif>`: encode rendered map frames into an animated GIF. Requires `ffmpeg` or ImageMagick `magick` on PATH.
- `--snapshot-gif-fps <fps>`: GIF playback speed; defaults to 8 frames per second.
- `--summary`: include the civilization summary in terminal output.

The health/death and record-creation phases intentionally stay serial. Earlier deaths can mutate later agents through relationships, inheritance, belongings, offices, residences, and careers, so those phases need a stricter draft/apply design before they can be safely parallelized.

Stress-test a 500-year simulation with checkpoint profiles:

```sh
npm run stress:500
```

This uses a small 128px render target, the default parallel civilization workers, phase timing checkpoints, old-event text spilling after a 10-year hot window, and writes `output/stress-probes/probe-500-final.png`, `output/stress-probes/probe-500-final.json`, old event text chunks in `output/stress-probes/probe-500-event-text/`, and 100-year checkpoint profiles in `output/stress-probes/probe-500-profiles/` as `year-100.json`, `year-200.json`, `year-300.json`, `year-400.json`, and `year-500.json` when the full run completes. Worker terrain snapshots use shared buffers where practical so default parallel runs do not clone full triangle arrays once per worker, and settlement resource potentials are cached at settlement creation before annual economy drafts are dispatched.

Evaluate the top generated story hooks with OpenRouter after a profile run:

```sh
$env:OPENROUTER_API_KEY = "..."
npm run evaluate:story-hooks -- --input output/stress-probes/probe-500-final.json --out output/stress-probes/probe-500-story-hook-report-cards --overwrite
```

The evaluator reads `storyHookSamples` and `storyHookSamplesByKind` from the compact profile, sends each selected hook to the OpenRouter Chat Completions API, and writes one Markdown report card per hook under `cards/`, plus `summary.md`, `index.md`, and `manifest.json`. Each report card includes the hook's prompt summary, grade, scored criteria, risks, improvements, revised writing prompt, resolved seed-ref context, resolved event context, raw trace refs/ids, and a copied World Simulation Details block with the run year, civilization/agent/event counts, lifecycle diagnostics, story-hook counts by kind, and relevant record counts. The compact profile resolves sampled hook refs into readable people, artifacts, conflicts, battles, prophecies, relationships, and event headline/description text before the AI call, so the report-card model does not have to infer meaning from IDs alone. Use `OPENROUTER_MODEL` to select a model, or pass `--model <provider/model>`. For output-shape testing without API calls, pass `--provider mock`.

Create story outlines from generated report cards:

```sh
$env:OPENROUTER_API_KEY = "..."
npm run outline:stories -- --cards-dir output/stress-probes/probe-500-story-hook-report-cards/cards --out output/stress-probes/probe-500-story-outlines --overwrite
```

If no filename is supplied, the outline script reads every `.md` report card in `--cards-dir`. To outline one card, pass either an absolute path or a filename found under `--cards-dir`:

```sh
npm run outline:stories -- hook-000-character-garin-quaovars-unresolved-thread.md --cards-dir output/stress-probes/probe-500-story-hook-report-cards/cards --out output/story-outlines --overwrite
```

The outline generator defaults to `openai/gpt-5.5`, uses the same OpenRouter environment variables as the report-card evaluator, and injects the writing rules from local `writing-rules.md` into the system prompt. Override that file with `--writing-rules <md>` or `STORY_OUTLINE_WRITING_RULES`. It writes one Markdown outline per report card under `outlines/`, plus `summary.md`, `index.md`, and `manifest.json`. Use `--provider mock` to test output shape without an API call.

Run the 500-year stress probe and then immediately evaluate story hooks:

```sh
npm run stress:500:review
```

Stress-test a 1000-year simulation with the same 100-year checkpoint cadence:

```sh
npm run stress:1000
```

The 1000-year probe uses `--expansion-rate 0.25` so it stresses long-lived relationships, beliefs, records, and old-event text spilling without forcing every civilization to found a town every 25 simulated years. It writes `output/stress-probes/probe-1000-final.png`, `output/stress-probes/probe-1000-final.json`, old event text chunks in `output/stress-probes/probe-1000-event-text/`, and checkpoint profiles in `output/stress-probes/probe-1000-profiles/`.

The offline Legends wiki viewer also writes text chunks in `texts/<kind>/<chunk>.json` beside its `records/`, `indexes/`, and `mentions/` folders. Record chunks keep ids and compact metadata hot; headline/description prose is loaded and cached by chunk when a linked page needs it.

Compare two civilization profile JSON files while ignoring runtime-only timing, memory, and worker-count diagnostics:

```sh
npm run compare:civ-profiles -- output/default.json output/one-worker.json
```

Verify a generated Legends archive and its wiki chunk/index files:

```sh
npm run verify:legends -- output/legends/legends.json output/legends
```

The verifier checks schema counts, route ids, cross-record references, person and place timeline links, road timeline backlinks, military/equipment/spy links, battle battlefield fields, event mention backlinks, artifact provenance, scale, and detail refs, and the chunked `indexes/`, `records/`, and broad `mentions/` files used by the offline wiki viewer. It also validates the viewer-only derived chapter layer: `indexes/chapters.json`, `records/chapters/*.json`, embedded owner `chapterId` links, and `mentions/chapters`.

## Simulation Controls

Control definitions live in `map-controls.ts`. Simulation code can change only these unlocked controls:

- `elevation.seed`
- `elevation.island`
- `biomes.wind_angle_deg`
- `biomes.raininess`
- `biomes.rain_shadow`
- `biomes.evaporation`
- `rivers.flow`
- `render.biome_colors`

All other mapgen4 controls are locked to their defaults. Locked values in JSON files are ignored, and explicit `--set` attempts for locked controls fail with an error.

Pass unlocked values in a JSON file:

```json
{
  "elevation": {
    "seed": 187,
    "island": 0.5
  },
  "biomes": {
    "wind_angle_deg": 0,
    "raininess": 0.9,
    "rain_shadow": 0.5,
    "evaporation": 0.5
  },
  "rivers": {
    "flow": 0.2
  },
  "render": {
    "biome_colors": 1
  }
}
```

Then run:

```sh
npm run generate -- --controls simulation-controls.example.json --out output/simulation-map.png
```

`mapgen4.ts` is a data-only module containing the original mapgen4 initial slider table. `map-controls.ts` derives the console defaults from that file, and `mapgen4-controls.json` is an explicit JSON copy of those same values. `test-mapgen4-controls.json` uses the same values except for `elevation.seed=42` and `rivers.flow=0.35`, matching the provided sample image input.

## Main Files

- `console.ts`: CLI argument parsing and terminal command entry point.
- `node-mapgen.ts`: Node-side mapgen4 mesh and terrain generation.
- `civilizations.ts`: civilization simulation, agents, settlement economies, political Voronoi ownership, internal roads, settlements, named natural features, mythic seeding, beliefs, magic roles, prophecies, and time advancement.
- `elevation-constraints.ts`: default unpainted island constraint map.
- `cpu-renderer.ts`: CPU-only PNG renderer.
- `map-controls.ts`: shared map control definitions.
- `map.ts`, `generate-points.ts`, `dual-mesh/`: adapted mapgen4 generation code.

## Attribution

Mapgen4 and Red Blob Games helper libraries are licensed under Apache-2.0. The upstream license is preserved in `LICENSE` and the original `README.org` is kept for reference.
