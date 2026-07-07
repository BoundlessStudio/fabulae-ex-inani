#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const chunkSize = 500;
const mentionChunkSize = 500;

const kindSpecs = [
  ["story-hooks", "storyHooks", "story-hook"],
  ["people", "people", "person"],
  ["births", "births", "birth"],
  ["age-milestones", "ageMilestones", "age-milestone"],
  ["appearance-features", "appearanceFeatures", "appearance-feature"],
  ["settlements", "settlements", "settlement"],
  ["settlement-controls", "settlementControls", "settlement-control"],
  ["natural-features", "naturalFeatures", "natural-feature"],
  ["person-allegiances", "personAllegiances", "person-allegiance"],
  ["preferences", "preferences", "preference"],
  ["traditions", "traditions", "tradition"],
  ["epithets", "epithets", "epithet"],
  ["reputation-milestones", "reputationMilestones", "reputation-milestone"],
  ["structures", "structures", "structure"],
  ["households", "households", "household"],
  ["lineages", "lineages", "lineage"],
  ["chapters", "chapters", "chapter"],
  ["organizations", "organizations", "organization"],
  ["memberships", "memberships", "membership"],
  ["organization-ranks", "organizationRanks", "organization-rank"],
  ["beliefs", "beliefs", "belief"],
  ["belief-adherences", "beliefAdherences", "belief-adherence"],
  ["myths-magic", "mythsAndMagic", "myths-magic"],
  ["gods", "gods", "god"],
  ["commandments", "commandments", "commandment"],
  ["destinies", "destinies", "destiny"],
  ["miracles", "miracles", "miracle"],
  ["myths", "myths", "myth"],
  ["doctrines", "doctrines", "doctrine"],
  ["magic-roles", "magicRoles", "magic-role"],
  ["prophecies", "prophecies", "prophecy"],
  ["civilization-goals", "civilizationGoals", "civilization-goal"],
  ["sacred-sites", "sacredSites", "sacred-site"],
  ["offices", "offices", "office"],
  ["office-terms", "officeTerms", "office-term"],
  ["laws", "laws", "law"],
  ["cases", "cases", "case"],
  ["testimonies", "testimonies", "testimony"],
  ["conflicts", "conflicts", "conflict"],
  ["battles", "battles", "battle"],
  ["battle-participations", "battleParticipations", "battle-participation"],
  ["military-units", "militaryUnits", "military-unit"],
  ["equipment-caches", "equipmentCaches", "equipment-cache"],
  ["spy-networks", "spyNetworks", "spy-network"],
  ["spy-operations", "spyOperations", "spy-operation"],
  ["injuries", "injuries", "injury"],
  ["illnesses", "illnesses", "illness"],
  ["care-records", "careRecords", "care-record"],
  ["wound-legacies", "woundLegacies", "wound-legacy"],
  ["memorials", "memorials", "memorial"],
  ["burials", "burials", "burial"],
  ["death-records", "deathRecords", "death-record"],
  ["ambitions", "ambitions", "ambition"],
  ["apprenticeships", "apprenticeships", "apprenticeship"],
  ["skills", "skills", "skill"],
  ["residences", "residences", "residence"],
  ["careers", "careers", "career"],
  ["journeys", "journeys", "journey"],
  ["roads", "roads", "road"],
  ["relationships", "relationships", "relationship"],
  ["relationship-milestones", "relationshipMilestones", "relationship-milestone"],
  ["unions", "unions", "union"],
  ["artifacts", "artifacts", "artifact"],
  ["artifact-conditions", "artifactConditions", "artifact-condition"],
  ["chronicles", "chronicles", "chronicle"],
  ["written-works", "writtenWorks", "written-work"],
  ["memories", "memories", "memory"],
  ["thoughts", "thoughts", "thought"],
  ["personality-shifts", "personalityShifts", "personality-shift"],
  ["need-episodes", "needEpisodes", "need-episode"],
  ["opinions", "opinions", "opinion"],
  ["social-claims", "socialClaims", "social-claim"],
  ["conversations", "conversations", "conversation"],
  ["rumors", "rumors", "rumor"],
  ["secrets", "secrets", "secret"],
  ["schemes", "schemes", "scheme"],
  ["feuds", "feuds", "feud"],
  ["oaths", "oaths", "oath"],
  ["ceremonies", "ceremonies", "ceremony"],
  ["ceremony-participations", "ceremonyParticipations", "ceremony-participation"],
  ["activities", "activities", "activity"],
  ["teachings", "teachings", "teaching"],
  ["projects", "projects", "project"],
  ["project-participations", "projectParticipations", "project-participation"],
  ["obligations", "obligations", "obligation"],
  ["holdings", "holdings", "holding"],
  ["belongings", "belongings", "belonging"],
  ["possession-attachments", "possessionAttachments", "possession-attachment"],
  ["estates", "estates", "estate"],
  ["civilizations", "civilizations", "civilization"],
  ["events", "events", "event"],
];

const countFields = new Map([
  ["civilizationCount", "civilizations"],
  ["settlementCount", "settlements"],
  ["settlementControlCount", "settlementControls"],
  ["naturalFeatureCount", "naturalFeatures"],
  ["personCount", "people"],
  ["birthCount", "births"],
  ["ageMilestoneCount", "ageMilestones"],
  ["appearanceFeatureCount", "appearanceFeatures"],
  ["personAllegianceCount", "personAllegiances"],
  ["preferenceCount", "preferences"],
  ["traditionCount", "traditions"],
  ["epithetCount", "epithets"],
  ["reputationMilestoneCount", "reputationMilestones"],
  ["artifactCount", "artifacts"],
  ["artifactConditionCount", "artifactConditions"],
  ["chronicleCount", "chronicles"],
  ["writtenWorkCount", "writtenWorks"],
  ["memoryCount", "memories"],
  ["thoughtCount", "thoughts"],
  ["personalityShiftCount", "personalityShifts"],
  ["needEpisodeCount", "needEpisodes"],
  ["opinionCount", "opinions"],
  ["socialClaimCount", "socialClaims"],
  ["conversationCount", "conversations"],
  ["rumorCount", "rumors"],
  ["secretCount", "secrets"],
  ["schemeCount", "schemes"],
  ["feudCount", "feuds"],
  ["oathCount", "oaths"],
  ["ceremonyCount", "ceremonies"],
  ["ceremonyParticipationCount", "ceremonyParticipations"],
  ["activityCount", "activities"],
  ["teachingCount", "teachings"],
  ["projectCount", "projects"],
  ["projectParticipationCount", "projectParticipations"],
  ["obligationCount", "obligations"],
  ["holdingCount", "holdings"],
  ["belongingCount", "belongings"],
  ["possessionAttachmentCount", "possessionAttachments"],
  ["estateCount", "estates"],
  ["unionCount", "unions"],
  ["organizationCount", "organizations"],
  ["membershipCount", "memberships"],
  ["organizationRankCount", "organizationRanks"],
  ["relationshipCount", "relationships"],
  ["relationshipMilestoneCount", "relationshipMilestones"],
  ["beliefCount", "beliefs"],
  ["beliefAdherenceCount", "beliefAdherences"],
  ["mythsAndMagicCount", "mythsAndMagic"],
  ["godCount", "gods"],
  ["commandmentCount", "commandments"],
  ["destinyCount", "destinies"],
  ["miracleCount", "miracles"],
  ["mythCount", "myths"],
  ["doctrineCount", "doctrines"],
  ["magicRoleCount", "magicRoles"],
  ["prophecyCount", "prophecies"],
  ["civilizationGoalCount", "civilizationGoals"],
  ["sacredSiteCount", "sacredSites"],
  ["officeCount", "offices"],
  ["officeTermCount", "officeTerms"],
  ["lawCount", "laws"],
  ["caseCount", "cases"],
  ["testimonyCount", "testimonies"],
  ["conflictCount", "conflicts"],
  ["battleCount", "battles"],
  ["battleParticipationCount", "battleParticipations"],
  ["militaryUnitCount", "militaryUnits"],
  ["equipmentCacheCount", "equipmentCaches"],
  ["spyNetworkCount", "spyNetworks"],
  ["spyOperationCount", "spyOperations"],
  ["injuryCount", "injuries"],
  ["illnessCount", "illnesses"],
  ["careRecordCount", "careRecords"],
  ["woundLegacyCount", "woundLegacies"],
  ["memorialCount", "memorials"],
  ["burialCount", "burials"],
  ["deathRecordCount", "deathRecords"],
  ["ambitionCount", "ambitions"],
  ["apprenticeshipCount", "apprenticeships"],
  ["skillRecordCount", "skills"],
  ["residenceCount", "residences"],
  ["careerCount", "careers"],
  ["journeyCount", "journeys"],
  ["roadCount", "roads"],
  ["structureCount", "structures"],
  ["householdCount", "households"],
  ["lineageCount", "lineages"],
  ["storyHookCount", "storyHooks"],
  ["storyHookEraCount", "storyHookEras"],
  ["eventCount", "events"],
]);

const fieldTargets = new Map([
  ["storyHookId", "story-hook"],
  ["storyHookIds", "story-hook"],
  ["activityId", "activity"],
  ["activityIds", "activity"],
  ["conversationId", "conversation"],
  ["conversationIds", "conversation"],
  ["testimonyId", "testimony"],
  ["testimonyIds", "testimony"],
  ["teachingId", "teaching"],
  ["teachingIds", "teaching"],
  ["actorAgentId", "person"],
  ["accusedAgentId", "person"],
  ["adherenceIds", "belief-adherence"],
  ["adherentAgentIds", "person"],
  ["adherentIds", "person"],
  ["agentId", "person"],
  ["agentIds", "person"],
  ["ambitionId", "ambition"],
  ["ambitionIds", "ambition"],
  ["apprenticeAgentId", "person"],
  ["apprenticeshipId", "apprenticeship"],
  ["apprenticeshipIds", "apprenticeship"],
  ["artifactId", "artifact"],
  ["artifactIds", "artifact"],
  ["artifactConditionId", "artifact-condition"],
  ["artifactConditionIds", "artifact-condition"],
  ["conditionRecordIds", "artifact-condition"],
  ["attackerCivilizationId", "civilization"],
  ["attackerCommanderId", "person"],
  ["attackerParticipantIds", "person"],
  ["attackerUnitIds", "military-unit"],
  ["authorAgentId", "person"],
  ["battleEventId", "event"],
  ["battleId", "battle"],
  ["battleIds", "battle"],
  ["battleParticipationId", "battle-participation"],
  ["battleParticipationIds", "battle-participation"],
  ["militaryUnitId", "military-unit"],
  ["militaryUnitIds", "military-unit"],
  ["commanderAgentId", "person"],
  ["troopAgentIds", "person"],
  ["unitId", "military-unit"],
  ["unitIds", "military-unit"],
  ["equipmentCacheId", "equipment-cache"],
  ["equipmentCacheIds", "equipment-cache"],
  ["handlerAgentId", "person"],
  ["spyNetworkId", "spy-network"],
  ["spyNetworkIds", "spy-network"],
  ["networkId", "spy-network"],
  ["networkIds", "spy-network"],
  ["spyOperationId", "spy-operation"],
  ["spyOperationIds", "spy-operation"],
  ["operationId", "spy-operation"],
  ["operationIds", "spy-operation"],
  ["birthId", "birth"],
  ["birthIds", "birth"],
  ["birthEventId", "event"],
  ["ageMilestoneId", "age-milestone"],
  ["ageMilestoneIds", "age-milestone"],
  ["appearanceFeatureId", "appearance-feature"],
  ["appearanceFeatureIds", "appearance-feature"],
  ["burialId", "burial"],
  ["burialIds", "burial"],
  ["deathRecordId", "death-record"],
  ["deathRecordIds", "death-record"],
  ["careRecordId", "care-record"],
  ["careRecordIds", "care-record"],
  ["beliefAdherenceId", "belief-adherence"],
  ["beliefAdherenceIds", "belief-adherence"],
  ["beliefId", "belief"],
  ["beliefIds", "belief"],
  ["mythsMagicId", "myths-magic"],
  ["mythsMagicIds", "myths-magic"],
  ["godId", "god"],
  ["godIds", "god"],
  ["creationGodId", "god"],
  ["patronGodId", "god"],
  ["commandmentId", "commandment"],
  ["commandmentIds", "commandment"],
  ["destinyId", "destiny"],
  ["destinyIds", "destiny"],
  ["activeDestinyIds", "destiny"],
  ["miracleId", "miracle"],
  ["miracleIds", "miracle"],
  ["mythId", "myth"],
  ["mythIds", "myth"],
  ["doctrineId", "doctrine"],
  ["doctrineIds", "doctrine"],
  ["magicRoleId", "magic-role"],
  ["magicRoleIds", "magic-role"],
  ["prophecyId", "prophecy"],
  ["prophecyIds", "prophecy"],
  ["openProphecyIds", "prophecy"],
  ["civilizationGoalId", "civilization-goal"],
  ["civilizationGoalIds", "civilization-goal"],
  ["activeCivilizationGoalIds", "civilization-goal"],
  ["sacredSiteId", "sacred-site"],
  ["sacredSiteIds", "sacred-site"],
  ["naturalFeatureId", "natural-feature"],
  ["naturalFeatureIds", "natural-feature"],
  ["belongingId", "belonging"],
  ["belongingIds", "belonging"],
  ["graveGoodBelongingIds", "belonging"],
  ["graveGoodArtifactIds", "artifact"],
  ["mournerAgentIds", "person"],
  ["possessionAttachmentId", "possession-attachment"],
  ["possessionAttachmentIds", "possession-attachment"],
  ["caseId", "case"],
  ["caseIds", "case"],
  ["chapterId", "chapter"],
  ["chapterIds", "chapter"],
  ["casualtyAgentIds", "person"],
  ["casualtyEventId", "event"],
  ["capturedArtifactIds", "artifact"],
  ["capturedSettlementIds", "settlement"],
  ["careerId", "career"],
  ["careerIds", "career"],
  ["capitalSettlementId", "settlement"],
  ["centralAgentId", "person"],
  ["ceremonyEventId", "event"],
  ["ceremonyId", "ceremony"],
  ["ceremonyIds", "ceremony"],
  ["ceremonyParticipationId", "ceremony-participation"],
  ["ceremonyParticipationIds", "ceremony-participation"],
  ["childAgentIds", "person"],
  ["childIds", "person"],
  ["chronicleId", "chronicle"],
  ["chronicleIds", "chronicle"],
  ["civilizationId", "civilization"],
  ["civilizationIds", "civilization"],
  ["conflictId", "conflict"],
  ["contestedSettlementIds", "settlement"],
  ["conspiratorAgentIds", "person"],
  ["controlIds", "settlement-control"],
  ["creditorAgentId", "person"],
  ["creatorAgentId", "person"],
  ["deathEventId", "event"],
  ["decedentAgentId", "person"],
  ["debtorAgentId", "person"],
  ["defenderCivilizationId", "civilization"],
  ["defenderCommanderId", "person"],
  ["defenderParticipantIds", "person"],
  ["defenderUnitIds", "military-unit"],
  ["disbandedEventId", "event"],
  ["destinationStructureId", "structure"],
  ["disputeCaseIds", "case"],
  ["disputeFeudIds", "feud"],
  ["disputeOathIds", "oath"],
  ["disputeRumorIds", "rumor"],
  ["endEventId", "event"],
  ["endedEventId", "event"],
  ["eventId", "event"],
  ["eventIds", "event"],
  ["exposedEventId", "event"],
  ["estateId", "estate"],
  ["estateIds", "estate"],
  ["feudId", "feud"],
  ["feudIds", "feud"],
  ["founderAgentId", "person"],
  ["founderAgentIds", "person"],
  ["formedEventId", "event"],
  ["fromSettlementId", "settlement"],
  ["healerAgentId", "person"],
  ["heirAgentIds", "person"],
  ["holderAgentId", "person"],
  ["magicRoleHolderIds", "person"],
  ["hostAgentId", "person"],
  ["holdingId", "holding"],
  ["holdingIds", "holding"],
  ["householdId", "household"],
  ["householdIds", "household"],
  ["illnessId", "illness"],
  ["illnessIds", "illness"],
  ["injuryId", "injury"],
  ["injuryIds", "injury"],
  ["woundLegacyId", "wound-legacy"],
  ["woundLegacyIds", "wound-legacy"],
  ["instigatorCivilizationId", "civilization"],
  ["journeyId", "journey"],
  ["journeyIds", "journey"],
  ["keeperAgentIds", "person"],
  ["lawId", "law"],
  ["lawIds", "law"],
  ["lastActivityId", "activity"],
  ["lastCeremonyId", "ceremony"],
  ["lastInteractionEventId", "event"],
  ["lastThoughtId", "thought"],
  ["leadAgentId", "person"],
  ["leaderAgentId", "person"],
  ["lineageId", "lineage"],
  ["lineageIds", "lineage"],
  ["memberAgentIds", "person"],
  ["memberIds", "person"],
  ["membershipId", "membership"],
  ["membershipIds", "membership"],
  ["organizationRankId", "organization-rank"],
  ["organizationRankIds", "organization-rank"],
  ["currentRankId", "organization-rank"],
  ["previousRankId", "organization-rank"],
  ["rankIds", "organization-rank"],
  ["memorialId", "memorial"],
  ["memorialIds", "memorial"],
  ["memoryId", "memory"],
  ["memoryIds", "memory"],
  ["personalityShiftId", "personality-shift"],
  ["personalityShiftIds", "personality-shift"],
  ["needEpisodeId", "need-episode"],
  ["needEpisodeIds", "need-episode"],
  ["mentorAgentId", "person"],
  ["officeId", "office"],
  ["officeIds", "office"],
  ["officeTermId", "office-term"],
  ["officeTermIds", "office-term"],
  ["opinionId", "opinion"],
  ["opinionIds", "opinion"],
  ["socialClaimId", "social-claim"],
  ["socialClaimIds", "social-claim"],
  ["onsetEventId", "event"],
  ["opposingCivilizationId", "civilization"],
  ["parentCivilizationId", "civilization"],
  ["organizationId", "organization"],
  ["organizationIds", "organization"],
  ["originSettlementId", "settlement"],
  ["originStructureId", "structure"],
  ["obligationId", "obligation"],
  ["obligationIds", "obligation"],
  ["oathId", "oath"],
  ["oathIds", "oath"],
  ["ownerAgentId", "person"],
  ["ownerSettlementId", "settlement"],
  ["parentAgentIds", "person"],
  ["parentIds", "person"],
  ["patientAgentId", "person"],
  ["participantAgentIds", "person"],
  ["partnerAgentIds", "person"],
  ["personAllegianceId", "person-allegiance"],
  ["personAllegianceIds", "person-allegiance"],
  ["personId", "person"],
  ["preferenceId", "preference"],
  ["preferenceIds", "preference"],
  ["previousCivilizationId", "civilization"],
  ["restoredCivilizationId", "civilization"],
  ["previousOwnerAgentId", "person"],
  ["previousSettlementId", "settlement"],
  ["previousStructureId", "structure"],
  ["primaryAgentId", "person"],
  ["projectEventId", "event"],
  ["projectId", "project"],
  ["projectIds", "project"],
  ["projectParticipationId", "project-participation"],
  ["projectParticipationIds", "project-participation"],
  ["recipientAgentId", "person"],
  ["recordedEventId", "event"],
  ["relationshipId", "relationship"],
  ["relationshipMilestoneId", "relationship-milestone"],
  ["relationshipMilestoneIds", "relationship-milestone"],
  ["milestoneIds", "relationship-milestone"],
  ["residenceStructureId", "structure"],
  ["residenceId", "residence"],
  ["residenceIds", "residence"],
  ["residentAgentIds", "person"],
  ["revealedEventId", "event"],
  ["resolvedEventId", "event"],
  ["roadId", "road"],
  ["roadIds", "road"],
  ["rumorId", "rumor"],
  ["rumorIds", "rumor"],
  ["schemeId", "scheme"],
  ["schemeIds", "scheme"],
  ["secretId", "secret"],
  ["secretIds", "secret"],
  ["settlementControlId", "settlement-control"],
  ["settlementId", "settlement"],
  ["settlementIds", "settlement"],
  ["settledEventId", "event"],
  ["sideAAgentIds", "person"],
  ["sideBAgentIds", "person"],
  ["studentAgentId", "person"],
  ["skillId", "skill"],
  ["skillRecordIds", "skill"],
  ["socialBondIds", "relationship"],
  ["sourceChronicleId", "chronicle"],
  ["sourceEventId", "event"],
  ["sourceEventIds", "event"],
  ["sourceMemoryId", "memory"],
  ["sourceOpinionId", "opinion"],
  ["sourcePersonalityShiftId", "personality-shift"],
  ["sourcePreferenceId", "preference"],
  ["sourceTraditionId", "tradition"],
  ["listenerAgentId", "person"],
  ["speakerAgentId", "person"],
  ["sponsorAgentId", "person"],
  ["spouseId", "person"],
  ["spreadAgentIds", "person"],
  ["spreadSettlementIds", "settlement"],
  ["startEventId", "event"],
  ["startedEventId", "event"],
  ["structureId", "structure"],
  ["structureIds", "structure"],
  ["targetAgentId", "person"],
  ["targetAmbitionId", "ambition"],
  ["targetArtifactId", "artifact"],
  ["targetCaseId", "case"],
  ["targetCivilizationId", "civilization"],
  ["targetBeliefId", "belief"],
  ["targetEventId", "event"],
  ["targetFeudId", "feud"],
  ["targetOfficeId", "office"],
  ["targetProphecyId", "prophecy"],
  ["targetSecretId", "secret"],
  ["targetSettlementId", "settlement"],
  ["targetCivilizationGoalId", "civilization-goal"],
  ["swearerAgentId", "person"],
  ["tellerAgentId", "person"],
  ["termIds", "office-term"],
  ["thoughtId", "thought"],
  ["thoughtIds", "thought"],
  ["toSettlementId", "settlement"],
  ["traditionId", "tradition"],
  ["traditionIds", "tradition"],
  ["epithetId", "epithet"],
  ["epithetIds", "epithet"],
  ["reputationMilestoneId", "reputation-milestone"],
  ["reputationMilestoneIds", "reputation-milestone"],
  ["transferredEventId", "event"],
  ["transferredEventIds", "event"],
  ["unionId", "union"],
  ["unionIds", "union"],
  ["victimAgentId", "person"],
  ["witnessAgentId", "person"],
  ["witnessAgentIds", "person"],
  ["workerAgentIds", "person"],
  ["writtenWorkId", "written-work"],
  ["writtenWorkIds", "written-work"],
]);

const refKindToKey = new Map(kindSpecs.map(([, key, refKind]) => [refKind, key]));
const viewerKindToKey = new Map(kindSpecs.map(([viewerKind, key]) => [viewerKind, key]));

function usage() {
  console.error("Usage: world-mapgen verify-legends <legends.json> [viewer-dir]");
  process.exit(2);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function pushIssue(issues, message, limit = 200) {
  if (issues.length < limit) issues.push(message);
}

function assertRefExists(issues, maps, refKind, id, context) {
  if (id === undefined || id === null) return;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 0) {
    pushIssue(issues, `${context}: invalid ${refKind} id ${JSON.stringify(id)}`);
    return;
  }
  const key = refKindToKey.get(refKind);
  if (!key) {
    pushIssue(issues, `${context}: unknown ref kind ${refKind}`);
    return;
  }
  if (!maps.get(key)?.has(numericId)) {
    pushIssue(issues, `${context}: missing ${refKind} ${numericId}`);
  }
}

function validateRefObject(issues, maps, value, context) {
  if (!isRecord(value)) return;
  if (typeof value.kind !== "string") {
    pushIssue(issues, `${context}: ref missing kind`);
    return;
  }
  assertRefExists(issues, maps, value.kind, value.id, context);
}

function validateIdField(issues, maps, field, value, context) {
  const refKind = fieldTargets.get(field);
  if (!refKind) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertRefExists(issues, maps, refKind, value[i], `${context}.${field}[${i}]`);
    }
  } else {
    assertRefExists(issues, maps, refKind, value, `${context}.${field}`);
  }
}

function isUnmappedIdField(field) {
  return /(?:Id|Ids)$/.test(field) && !fieldTargets.has(field);
}

function validateObjectLinks(issues, maps, value, context) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) validateObjectLinks(issues, maps, value[i], `${context}[${i}]`);
    return;
  }
  if (!isRecord(value)) return;

  for (let [field, child] of Object.entries(value)) {
    if (field === "subjectRefs" || field === "entityRefs" || field === "seedRefs" || field === "targetRefs" || field === "depictionRefs" || field === "dedicationRefs") {
      if (!Array.isArray(child)) {
        pushIssue(issues, `${context}.${field}: expected array`);
        continue;
      }
      for (let i = 0; i < child.length; i++) validateRefObject(issues, maps, child[i], `${context}.${field}[${i}]`);
      continue;
    }
    if (field === "targetRef") {
      validateRefObject(issues, maps, child, `${context}.${field}`);
      continue;
    }
    if (isUnmappedIdField(field)) {
      pushIssue(issues, `${context}.${field}: id field is not mapped to a Legends route kind`);
      continue;
    }
    validateIdField(issues, maps, field, child, context);
    if (isRecord(child) || Array.isArray(child)) validateObjectLinks(issues, maps, child, `${context}.${field}`);
  }
}

function validateTopLevelCounts(issues, legends) {
  if (legends.schema !== "world-map-legends-v1") {
    pushIssue(issues, `schema: expected world-map-legends-v1, got ${JSON.stringify(legends.schema)}`);
  }

  for (let [field, key] of countFields) {
    if (!Array.isArray(legends[key])) {
      pushIssue(issues, `${key}: missing array`);
      continue;
    }
    if (legends[field] !== legends[key].length) {
      pushIssue(issues, `${field}: expected ${legends[key].length}, got ${legends[field]}`);
    }
  }
}

function buildRecordMaps(issues, legends) {
  const maps = new Map();
  for (let [, key] of kindSpecs) {
    const records = legends[key] ?? [];
    if (!Array.isArray(records)) continue;
    const byId = new Map();
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!isRecord(record)) {
        pushIssue(issues, `${key}[${i}]: expected object`);
        continue;
      }
      if (!Number.isInteger(record.id) || record.id < 0) {
        pushIssue(issues, `${key}[${i}]: invalid id ${JSON.stringify(record.id)}`);
        continue;
      }
      if (byId.has(record.id)) pushIssue(issues, `${key}: duplicate id ${record.id}`);
      byId.set(record.id, record);
      if (record.id !== i) pushIssue(issues, `${key}[${i}]: id ${record.id} does not match array position`);
    }
    maps.set(key, byId);
  }
  return maps;
}

function validateCoreHistory(issues, legends, maps) {
  if ((legends.people?.length ?? 0) === 0) pushIssue(issues, "people: archive has no people");
  if ((legends.settlements?.length ?? 0) === 0) pushIssue(issues, "settlements: archive has no settlements");
  if ((legends.events?.length ?? 0) === 0) pushIssue(issues, "events: archive has no legend events");

  const nonEmptyPeople = (legends.people ?? []).filter(person => Array.isArray(person.eventIds) && person.eventIds.length > 0);
  if ((legends.people?.length ?? 0) > 0 && nonEmptyPeople.length === 0) {
    pushIssue(issues, "people: no person has a timeline eventIds list");
  }

  const nonEmptySettlements = (legends.settlements ?? []).filter(settlement => Array.isArray(settlement.eventIds) && settlement.eventIds.length > 0);
  if ((legends.settlements?.length ?? 0) > 0 && nonEmptySettlements.length === 0) {
    pushIssue(issues, "settlements: no settlement has a timeline eventIds list");
  }

  const artifacts = legends.artifacts ?? [];
  if (artifacts.length > 0 && !artifacts.some(artifact => Array.isArray(artifact.provenance) && artifact.provenance.length > 0)) {
    pushIssue(issues, "artifacts: artifacts exist but none have provenance entries");
  }
  const validArtifactScales = new Set(["trinket", "personal", "monumental", "wonder"]);
  const validArtifactPurposes = new Set(["keepsake", "regalia", "tool", "record", "votive", "weapon", "instrument", "monument", "wonder"]);
  const validArtifactDecorations = new Set(["plain", "geometric", "lineage", "mythic", "historical", "civic", "celestial", "funerary", "landscape"]);
  const validArtifactConditions = new Set(["pristine", "intact", "worn", "damaged", "restored", "lost"]);
  const validArtifactConditionKinds = new Set(["creation", "wear", "battle-damage", "capture-damage", "restoration", "loss", "recovery"]);
  const validArtifactProvenanceKinds = new Set(["created", "moved", "inherited", "captured", "gifted", "dedicated", "lost", "recovered", "reclaimed", "stolen", "contested"]);
  const monumentalArtifactKinds = new Set(["monument", "pyramid", "great-work"]);
  const projectMap = maps.get("projects") ?? new Map();
  const structureMap = maps.get("structures") ?? new Map();
  const artifactConditionMap = maps.get("artifactConditions") ?? new Map();
  for (let artifact of artifacts) {
    if (!validArtifactScales.has(artifact.scale)) {
      pushIssue(issues, `artifacts/${artifact.id}: invalid scale ${JSON.stringify(artifact.scale)}`);
    }
    if (!validArtifactPurposes.has(artifact.purpose)) {
      pushIssue(issues, `artifacts/${artifact.id}: invalid purpose ${JSON.stringify(artifact.purpose)}`);
    }
    if (!validArtifactDecorations.has(artifact.decorationKind)) {
      pushIssue(issues, `artifacts/${artifact.id}: invalid decorationKind ${JSON.stringify(artifact.decorationKind)}`);
    }
    if (!validArtifactConditions.has(artifact.condition)) {
      pushIssue(issues, `artifacts/${artifact.id}: invalid condition ${JSON.stringify(artifact.condition)}`);
    }
    if (!Number.isFinite(artifact.value) || artifact.value <= 0) {
      pushIssue(issues, `artifacts/${artifact.id}: invalid value ${JSON.stringify(artifact.value)}`);
    }
    if (typeof artifact.detail !== "string" || artifact.detail.trim().length < 12) {
      pushIssue(issues, `artifacts/${artifact.id}: missing detail`);
    }
    if (!Array.isArray(artifact.depictionRefs) || artifact.depictionRefs.length === 0) {
      pushIssue(issues, `artifacts/${artifact.id}: missing depictionRefs`);
    }
    if (!Array.isArray(artifact.dedicationRefs)) {
      pushIssue(issues, `artifacts/${artifact.id}: missing dedicationRefs array`);
    }
    if ((artifact.scale === "monumental" || artifact.scale === "wonder") && artifact.structureId == null) {
      pushIssue(issues, `artifacts/${artifact.id}: ${artifact.scale} artifact missing structureId`);
    }
    if (artifact.scale === "wonder" && artifact.purpose !== "wonder") {
      pushIssue(issues, `artifacts/${artifact.id}: wonder artifact has purpose ${artifact.purpose}`);
    }
    if (artifact.scale === "monumental" && artifact.purpose !== "monument") {
      pushIssue(issues, `artifacts/${artifact.id}: monumental artifact has purpose ${artifact.purpose}`);
    }
    if (monumentalArtifactKinds.has(artifact.kind) && artifact.scale !== "monumental" && artifact.scale !== "wonder") {
      pushIssue(issues, `artifacts/${artifact.id}: ${artifact.kind} has non-monumental scale ${artifact.scale}`);
    }
    if (artifact.projectId != null && !projectMap.has(artifact.projectId)) {
      pushIssue(issues, `artifacts/${artifact.id}: missing project ${artifact.projectId}`);
    }
    if (artifact.structureId != null && !structureMap.has(artifact.structureId)) {
      pushIssue(issues, `artifacts/${artifact.id}: missing structure ${artifact.structureId}`);
    }
    if (!Array.isArray(artifact.conditionRecordIds) || artifact.conditionRecordIds.length === 0) {
      pushIssue(issues, `artifacts/${artifact.id}: missing conditionRecordIds`);
    }
    for (let conditionRecordId of artifact.conditionRecordIds ?? []) {
      const record = artifactConditionMap.get(conditionRecordId);
      if (!record) {
        pushIssue(issues, `artifacts/${artifact.id}: missing condition record ${conditionRecordId}`);
      } else if (record.artifactId !== artifact.id) {
        pushIssue(issues, `artifacts/${artifact.id}: condition record ${conditionRecordId} belongs to artifact ${record.artifactId}`);
      }
    }
    const latestCondition = (artifact.conditionRecordIds ?? [])
      .map(id => artifactConditionMap.get(id))
      .filter(Boolean)
      .sort((a, b) => b.year - a.year || b.id - a.id)[0];
    if (latestCondition && latestCondition.condition !== artifact.condition) {
      pushIssue(issues, `artifacts/${artifact.id}: current condition ${artifact.condition} does not match latest condition record ${latestCondition.condition}`);
    }
    for (let entry of artifact.provenance ?? []) {
      if (!validArtifactProvenanceKinds.has(entry.kind)) {
        pushIssue(issues, `artifacts/${artifact.id}: invalid provenance kind ${JSON.stringify(entry.kind)}`);
      }
      if (entry.projectId != null && !projectMap.has(entry.projectId)) {
        pushIssue(issues, `artifacts/${artifact.id}: provenance entry ${entry.eventId} missing project ${entry.projectId}`);
      }
    }
  }

  const eventMap = maps.get("events") ?? new Map();
  const personMap = maps.get("people") ?? new Map();
  for (let record of legends.artifactConditions ?? []) {
    if (!validArtifactConditionKinds.has(record.kind)) {
      pushIssue(issues, `artifactConditions/${record.id}: invalid kind ${JSON.stringify(record.kind)}`);
    }
    if (!validArtifactConditions.has(record.condition)) {
      pushIssue(issues, `artifactConditions/${record.id}: invalid condition ${JSON.stringify(record.condition)}`);
    }
    const artifact = maps.get("artifacts")?.get(record.artifactId);
    if (!artifact) {
      pushIssue(issues, `artifactConditions/${record.id}: missing artifact ${record.artifactId}`);
    } else if (!(artifact.conditionRecordIds ?? []).includes(record.id)) {
      pushIssue(issues, `artifactConditions/${record.id}: artifact ${record.artifactId} does not link back to this record`);
    }
    if (!eventMap.has(record.sourceEventId)) {
      pushIssue(issues, `artifactConditions/${record.id}: missing source event ${record.sourceEventId}`);
    }
    if (!Number.isFinite(record.severity) || record.severity < 0 || record.severity > 1) {
      pushIssue(issues, `artifactConditions/${record.id}: invalid severity ${JSON.stringify(record.severity)}`);
    }
    const refs = record.subjectRefs ?? [];
    if (!Array.isArray(refs) || refs.length === 0) {
      pushIssue(issues, `artifactConditions/${record.id}: missing subjectRefs`);
    } else {
      for (let [index, ref] of refs.entries()) validateRefObject(issues, maps, ref, `artifactConditions/${record.id}/subjectRefs/${index}`);
      if (!refs.some(ref => ref.kind === "artifact-condition" && ref.id === record.id)) pushIssue(issues, `artifactConditions/${record.id}: missing self subject ref`);
      if (!refs.some(ref => ref.kind === "artifact" && ref.id === record.artifactId)) pushIssue(issues, `artifactConditions/${record.id}: missing artifact subject ref`);
      if (!refs.some(ref => ref.kind === "event" && ref.id === record.sourceEventId)) pushIssue(issues, `artifactConditions/${record.id}: missing source event subject ref`);
    }
    if (!Array.isArray(record.eventIds) || record.eventIds.length === 0) {
      pushIssue(issues, `artifactConditions/${record.id}: missing eventIds`);
    }
  }
  const birthMap = maps.get("births") ?? new Map();
  const unionMap = maps.get("unions") ?? new Map();
  const validBirthKinds = new Set(["founding-generation", "lineage-childbirth", "recorded-birth"]);
  if ((legends.people?.length ?? 0) > 0 && (legends.births?.length ?? 0) !== (legends.people?.length ?? 0)) {
    pushIssue(issues, `births: expected one birth record per person, got ${legends.births?.length ?? 0} births for ${legends.people?.length ?? 0} people`);
  }
  for (let person of legends.people ?? []) {
    if (!Number.isInteger(person.birthId)) {
      pushIssue(issues, `people/${person.id}: missing birthId`);
    } else if (!birthMap.has(person.birthId)) {
      pushIssue(issues, `people/${person.id}: missing birth record ${person.birthId}`);
    } else if (birthMap.get(person.birthId)?.personId !== person.id) {
      pushIssue(issues, `people/${person.id}: birth ${person.birthId} belongs to person ${birthMap.get(person.birthId)?.personId}`);
    }
  }
  for (let birth of legends.births ?? []) {
    const person = personMap.get(birth.personId);
    if (!person) {
      pushIssue(issues, `births/${birth.id}: missing person ${birth.personId}`);
    } else {
      if (person.birthId !== birth.id) pushIssue(issues, `births/${birth.id}: person ${birth.personId} does not link back to this birth`);
      if (person.bornYear !== birth.year) pushIssue(issues, `births/${birth.id}: birth year ${birth.year} does not match person bornYear ${person.bornYear}`);
      const personParents = new Set(person.parentIds ?? []);
      for (let parentId of birth.parentAgentIds ?? []) {
        if (!personParents.has(parentId)) pushIssue(issues, `births/${birth.id}: parent ${parentId} is not listed on person ${birth.personId}`);
      }
    }
    if (!validBirthKinds.has(birth.kind)) {
      pushIssue(issues, `births/${birth.id}: invalid kind ${birth.kind}`);
    }
    for (let parentId of birth.parentAgentIds ?? []) {
      const parent = personMap.get(parentId);
      if (!parent) {
        pushIssue(issues, `births/${birth.id}: missing parent ${parentId}`);
      } else if (!(parent.childIds ?? []).includes(birth.personId)) {
        pushIssue(issues, `births/${birth.id}: parent ${parentId} does not list child ${birth.personId}`);
      }
    }
    if (birth.unionId != null) {
      const union = unionMap.get(birth.unionId);
      if (!union) {
        pushIssue(issues, `births/${birth.id}: missing union ${birth.unionId}`);
      } else if (!(union.childAgentIds ?? []).includes(birth.personId)) {
        pushIssue(issues, `births/${birth.id}: union ${birth.unionId} does not list child ${birth.personId}`);
      }
    }
    const birthEvent = eventMap.get(birth.birthEventId);
    if (!birthEvent) {
      pushIssue(issues, `births/${birth.id}: missing birth event ${birth.birthEventId}`);
    } else {
      if (birthEvent.type !== "person-born") pushIssue(issues, `births/${birth.id}: event ${birth.birthEventId} has type ${birthEvent.type}, not person-born`);
      if (birthEvent.personId !== birth.personId) pushIssue(issues, `births/${birth.id}: event ${birth.birthEventId} belongs to person ${birthEvent.personId}, not ${birth.personId}`);
      if (birthEvent.year !== birth.year) pushIssue(issues, `births/${birth.id}: event year ${birthEvent.year} does not match birth year ${birth.year}`);
      if (birthEvent.birthId !== birth.id && !(birthEvent.entityRefs ?? []).some(ref => ref.kind === "birth" && ref.id === birth.id)) {
        pushIssue(issues, `births/${birth.id}: birth event ${birth.birthEventId} does not link back to this birth`);
      }
    }
    if (!Array.isArray(birth.eventIds) || !birth.eventIds.includes(birth.birthEventId)) {
      pushIssue(issues, `births/${birth.id}: eventIds does not include birth event ${birth.birthEventId}`);
    } else {
      const hasBirthEvent = birth.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.birthId === birth.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "birth" && ref.id === birth.id);
      });
      if (!hasBirthEvent) pushIssue(issues, `births/${birth.id}: no event links back to this birth`);
    }
    for (let [kind, id] of [["birth", birth.id], ["person", birth.personId], ["event", birth.birthEventId], ["settlement", birth.settlementId], ["civilization", birth.civilizationId]]) {
      if (!(birth.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `births/${birth.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    for (let parentId of birth.parentAgentIds ?? []) {
      if (!(birth.subjectRefs ?? []).some(ref => ref.kind === "person" && ref.id === parentId)) {
        pushIssue(issues, `births/${birth.id}: subjectRefs does not include parent person/${parentId}`);
      }
    }
    for (let [field, kind] of [["householdId", "household"], ["lineageId", "lineage"], ["structureId", "structure"], ["beliefId", "belief"], ["unionId", "union"]]) {
      const id = birth[field];
      if (id != null && !(birth.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `births/${birth.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    if (!birthMap.has(birth.id)) {
      pushIssue(issues, `births/${birth.id}: missing from birth map`);
    }
  }

  const ageMilestoneMap = maps.get("ageMilestones") ?? new Map();
  const careerMap = maps.get("careers") ?? new Map();
  const validAgeMilestoneKinds = new Set(["came-of-age", "became-elder"]);
  const ageMilestoneKeys = new Set();
  for (let milestone of legends.ageMilestones ?? []) {
    const key = `${milestone.personId}:${milestone.kind}`;
    if (ageMilestoneKeys.has(key)) {
      pushIssue(issues, `ageMilestones/${milestone.id}: duplicate ${milestone.kind} for person ${milestone.personId}`);
    }
    ageMilestoneKeys.add(key);
    const person = personMap.get(milestone.personId);
    if (!person) {
      pushIssue(issues, `ageMilestones/${milestone.id}: missing person ${milestone.personId}`);
    } else if (!(person.ageMilestoneIds ?? []).includes(milestone.id)) {
      pushIssue(issues, `ageMilestones/${milestone.id}: person ${milestone.personId} does not list this age milestone`);
    }
    if (!validAgeMilestoneKinds.has(milestone.kind)) {
      pushIssue(issues, `ageMilestones/${milestone.id}: invalid kind ${milestone.kind}`);
    }
    if (milestone.kind === "came-of-age" && (milestone.previousProfession !== "child" || milestone.newProfession === "child")) {
      pushIssue(issues, `ageMilestones/${milestone.id}: came-of-age transition is ${milestone.previousProfession} to ${milestone.newProfession}`);
    }
    if (milestone.kind === "became-elder" && milestone.newProfession !== "elder") {
      pushIssue(issues, `ageMilestones/${milestone.id}: became-elder transition ends as ${milestone.newProfession}`);
    }
    if (!Number.isInteger(milestone.age) || milestone.age < 0) {
      pushIssue(issues, `ageMilestones/${milestone.id}: invalid age ${milestone.age}`);
    }
    const sourceEvent = eventMap.get(milestone.sourceEventId);
    if (!sourceEvent) {
      pushIssue(issues, `ageMilestones/${milestone.id}: missing source event ${milestone.sourceEventId}`);
    } else {
      if (sourceEvent.type !== "profession-changed") pushIssue(issues, `ageMilestones/${milestone.id}: source event ${milestone.sourceEventId} has type ${sourceEvent.type}, not profession-changed`);
      if (sourceEvent.personId !== milestone.personId) pushIssue(issues, `ageMilestones/${milestone.id}: source event ${milestone.sourceEventId} belongs to person ${sourceEvent.personId}, not ${milestone.personId}`);
      if (sourceEvent.ageMilestoneId !== milestone.id && !(sourceEvent.entityRefs ?? []).some(ref => ref.kind === "age-milestone" && ref.id === milestone.id)) {
        pushIssue(issues, `ageMilestones/${milestone.id}: source event ${milestone.sourceEventId} does not link back to this milestone`);
      }
    }
    if (milestone.careerId != null) {
      const career = careerMap.get(milestone.careerId);
      if (!career) {
        pushIssue(issues, `ageMilestones/${milestone.id}: missing career ${milestone.careerId}`);
      } else if (career.personId !== milestone.personId) {
        pushIssue(issues, `ageMilestones/${milestone.id}: career ${milestone.careerId} belongs to person ${career.personId}, not ${milestone.personId}`);
      }
    }
    if (!Array.isArray(milestone.eventIds) || !milestone.eventIds.includes(milestone.sourceEventId)) {
      pushIssue(issues, `ageMilestones/${milestone.id}: eventIds does not include source event ${milestone.sourceEventId}`);
    } else {
      const hasMilestoneEvent = milestone.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.ageMilestoneId === milestone.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "age-milestone" && ref.id === milestone.id);
      });
      if (!hasMilestoneEvent) pushIssue(issues, `ageMilestones/${milestone.id}: no event links back to this milestone`);
    }
    for (let [kind, id] of [["age-milestone", milestone.id], ["person", milestone.personId], ["event", milestone.sourceEventId], ["settlement", milestone.settlementId], ["civilization", milestone.civilizationId]]) {
      if (!(milestone.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `ageMilestones/${milestone.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    for (let [field, kind] of [["householdId", "household"], ["lineageId", "lineage"], ["structureId", "structure"], ["careerId", "career"]]) {
      const id = milestone[field];
      if (id != null && !(milestone.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `ageMilestones/${milestone.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    if (!ageMilestoneMap.has(milestone.id)) {
      pushIssue(issues, `ageMilestones/${milestone.id}: missing from age milestone map`);
    }
  }

  const appearanceFeatureMap = maps.get("appearanceFeatures") ?? new Map();
  const appearanceWoundLegacyMap = maps.get("woundLegacies") ?? new Map();
  const validAppearanceFeatureKinds = new Set(["birth-description", "wound-mark", "elder-mark"]);
  for (let feature of legends.appearanceFeatures ?? []) {
    const person = personMap.get(feature.personId);
    if (!person) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: missing person ${feature.personId}`);
    } else if (!(person.appearanceFeatureIds ?? []).includes(feature.id)) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: person ${feature.personId} does not list this appearance feature`);
    }
    if (!validAppearanceFeatureKinds.has(feature.kind)) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: invalid kind ${feature.kind}`);
    }
    if (!Array.isArray(feature.traits) || feature.traits.length === 0) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: missing traits`);
    }
    if (typeof feature.visibility !== "number" || feature.visibility < 0 || feature.visibility > 1) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: invalid visibility ${feature.visibility}`);
    }
    const sourceEvent = eventMap.get(feature.sourceEventId);
    if (!sourceEvent) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: missing source event ${feature.sourceEventId}`);
    } else if (sourceEvent.appearanceFeatureId !== feature.id && !(sourceEvent.entityRefs ?? []).some(ref => ref.kind === "appearance-feature" && ref.id === feature.id)) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: source event ${feature.sourceEventId} does not link back to this appearance feature`);
    }
    if (feature.kind === "birth-description") {
      const birth = feature.birthId == null ? undefined : birthMap.get(feature.birthId);
      if (!birth) {
        pushIssue(issues, `appearanceFeatures/${feature.id}: missing birth ${feature.birthId}`);
      } else if (birth.personId !== feature.personId) {
        pushIssue(issues, `appearanceFeatures/${feature.id}: birth ${feature.birthId} belongs to person ${birth.personId}, not ${feature.personId}`);
      }
    }
    if (feature.kind === "elder-mark") {
      const milestone = feature.ageMilestoneId == null ? undefined : ageMilestoneMap.get(feature.ageMilestoneId);
      if (!milestone) {
        pushIssue(issues, `appearanceFeatures/${feature.id}: missing age milestone ${feature.ageMilestoneId}`);
      } else {
        if (milestone.personId !== feature.personId) pushIssue(issues, `appearanceFeatures/${feature.id}: age milestone ${feature.ageMilestoneId} belongs to person ${milestone.personId}, not ${feature.personId}`);
        if (milestone.kind !== "became-elder") pushIssue(issues, `appearanceFeatures/${feature.id}: elder mark points to ${milestone.kind} milestone ${feature.ageMilestoneId}`);
      }
    }
    if (feature.kind === "wound-mark") {
      const legacy = feature.woundLegacyId == null ? undefined : appearanceWoundLegacyMap.get(feature.woundLegacyId);
      if (!legacy) {
        pushIssue(issues, `appearanceFeatures/${feature.id}: missing wound legacy ${feature.woundLegacyId}`);
      } else if (legacy.personId !== feature.personId) {
        pushIssue(issues, `appearanceFeatures/${feature.id}: wound legacy ${feature.woundLegacyId} belongs to person ${legacy.personId}, not ${feature.personId}`);
      }
    }
    if (!Array.isArray(feature.eventIds) || !feature.eventIds.includes(feature.sourceEventId)) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: eventIds does not include source event ${feature.sourceEventId}`);
    } else {
      const hasAppearanceEvent = feature.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.appearanceFeatureId === feature.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "appearance-feature" && ref.id === feature.id);
      });
      if (!hasAppearanceEvent) pushIssue(issues, `appearanceFeatures/${feature.id}: no event links back to this appearance feature`);
    }
    for (let [kind, id] of [["appearance-feature", feature.id], ["person", feature.personId], ["event", feature.sourceEventId], ["settlement", feature.settlementId], ["civilization", feature.civilizationId]]) {
      if (!(feature.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `appearanceFeatures/${feature.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    for (let [field, kind] of [["birthId", "birth"], ["ageMilestoneId", "age-milestone"], ["woundLegacyId", "wound-legacy"], ["householdId", "household"], ["lineageId", "lineage"]]) {
      const id = feature[field];
      if (id != null && !(feature.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `appearanceFeatures/${feature.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    if (!appearanceFeatureMap.has(feature.id)) {
      pushIssue(issues, `appearanceFeatures/${feature.id}: missing from appearance feature map`);
    }
  }

  const attachmentMap = maps.get("possessionAttachments") ?? new Map();
  for (let attachment of legends.possessionAttachments ?? []) {
    const objectCount = (attachment.artifactId == null ? 0 : 1) + (attachment.belongingId == null ? 0 : 1);
    if (objectCount !== 1) {
      pushIssue(issues, `possessionAttachments/${attachment.id}: expected exactly one artifactId or belongingId`);
    }
    if (!Number.isInteger(attachment.agentId)) {
      pushIssue(issues, `possessionAttachments/${attachment.id}: missing agentId`);
    }
    if (!Number.isInteger(attachment.sourceEventId) || !eventMap.has(attachment.sourceEventId)) {
      pushIssue(issues, `possessionAttachments/${attachment.id}: missing source event ${attachment.sourceEventId}`);
    }
    if (!Array.isArray(attachment.eventIds) || attachment.eventIds.length === 0) {
      pushIssue(issues, `possessionAttachments/${attachment.id}: missing eventIds`);
    } else {
      const hasAttachmentEvent = attachment.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.possessionAttachmentId === attachment.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "possession-attachment" && ref.id === attachment.id);
      });
      if (!hasAttachmentEvent) {
        pushIssue(issues, `possessionAttachments/${attachment.id}: no event links back to this attachment`);
      }
    }
    if (!attachmentMap.has(attachment.id)) {
      pushIssue(issues, `possessionAttachments/${attachment.id}: missing from attachment map`);
    }
  }

  const rankMap = maps.get("organizationRanks") ?? new Map();
  for (let rank of legends.organizationRanks ?? []) {
    if (!Number.isInteger(rank.agentId)) {
      pushIssue(issues, `organizationRanks/${rank.id}: missing agentId`);
    }
    if (!Number.isInteger(rank.organizationId)) {
      pushIssue(issues, `organizationRanks/${rank.id}: missing organizationId`);
    }
    if (!Number.isInteger(rank.membershipId)) {
      pushIssue(issues, `organizationRanks/${rank.id}: missing membershipId`);
    } else {
      const membership = maps.get("memberships")?.get(rank.membershipId);
      if (membership && membership.agentId !== rank.agentId) {
        pushIssue(issues, `organizationRanks/${rank.id}: membership ${rank.membershipId} belongs to person ${membership.agentId}, not ${rank.agentId}`);
      }
      if (membership && membership.organizationId !== rank.organizationId) {
        pushIssue(issues, `organizationRanks/${rank.id}: membership ${rank.membershipId} belongs to organization ${membership.organizationId}, not ${rank.organizationId}`);
      }
      if (membership && !(membership.rankIds ?? []).includes(rank.id)) {
        pushIssue(issues, `organizationRanks/${rank.id}: membership ${rank.membershipId} does not list this rank`);
      }
    }
    if (!Array.isArray(rank.eventIds) || rank.eventIds.length === 0) {
      pushIssue(issues, `organizationRanks/${rank.id}: missing eventIds`);
    } else {
      const hasRankEvent = rank.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.organizationRankId === rank.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "organization-rank" && ref.id === rank.id);
      });
      if (!hasRankEvent) {
        pushIssue(issues, `organizationRanks/${rank.id}: no event links back to this rank`);
      }
    }
    if (!rankMap.has(rank.id)) {
      pushIssue(issues, `organizationRanks/${rank.id}: missing from rank map`);
    }
  }

  const epithetMap = maps.get("epithets") ?? new Map();
  for (let epithet of legends.epithets ?? []) {
    if (!Number.isInteger(epithet.agentId)) {
      pushIssue(issues, `epithets/${epithet.id}: missing agentId`);
    } else {
      const person = maps.get("people")?.get(epithet.agentId);
      if (person && !(person.epithetIds ?? []).includes(epithet.id)) {
        pushIssue(issues, `epithets/${epithet.id}: person ${epithet.agentId} does not list this epithet`);
      }
    }
    if (!Array.isArray(epithet.eventIds) || epithet.eventIds.length === 0) {
      pushIssue(issues, `epithets/${epithet.id}: missing eventIds`);
    } else {
      const hasEpithetEvent = epithet.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.epithetId === epithet.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "epithet" && ref.id === epithet.id);
      });
      if (!hasEpithetEvent) {
        pushIssue(issues, `epithets/${epithet.id}: no event links back to this epithet`);
      }
    }
    if (!epithetMap.has(epithet.id)) {
      pushIssue(issues, `epithets/${epithet.id}: missing from epithet map`);
    }
  }

  const reputationMilestoneMap = maps.get("reputationMilestones") ?? new Map();
  const validReputationMilestoneKinds = new Set(["became-known", "became-renowned", "epithet-earned"]);
  for (let milestone of legends.reputationMilestones ?? []) {
    if (!validReputationMilestoneKinds.has(milestone.kind)) {
      pushIssue(issues, `reputationMilestones/${milestone.id}: invalid kind ${milestone.kind}`);
    }
    if (!Number.isInteger(milestone.agentId)) {
      pushIssue(issues, `reputationMilestones/${milestone.id}: missing agentId`);
    } else {
      const person = maps.get("people")?.get(milestone.agentId);
      if (!person) {
        pushIssue(issues, `reputationMilestones/${milestone.id}: missing person ${milestone.agentId}`);
      } else if (!(person.reputationMilestoneIds ?? []).includes(milestone.id)) {
        pushIssue(issues, `reputationMilestones/${milestone.id}: person ${milestone.agentId} does not list this milestone`);
      }
    }
    if (!Number.isInteger(milestone.year)) {
      pushIssue(issues, `reputationMilestones/${milestone.id}: missing year`);
    }
    if (!Number.isFinite(milestone.previousReputation) || !Number.isFinite(milestone.reputation)) {
      pushIssue(issues, `reputationMilestones/${milestone.id}: missing reputation values`);
    }
    if (milestone.epithetId != null) {
      const epithet = epithetMap.get(milestone.epithetId);
      if (!epithet) {
        pushIssue(issues, `reputationMilestones/${milestone.id}: missing epithet ${milestone.epithetId}`);
      } else if (epithet.agentId !== milestone.agentId) {
        pushIssue(issues, `reputationMilestones/${milestone.id}: epithet ${milestone.epithetId} belongs to person ${epithet.agentId}`);
      }
    }
    const sourceEvent = eventMap.get(milestone.sourceEventId);
    if (!sourceEvent) {
      pushIssue(issues, `reputationMilestones/${milestone.id}: missing source event ${milestone.sourceEventId}`);
    } else if (sourceEvent.reputationMilestoneId !== milestone.id && !(sourceEvent.entityRefs ?? []).some(ref => ref.kind === "reputation-milestone" && ref.id === milestone.id)) {
      pushIssue(issues, `reputationMilestones/${milestone.id}: source event ${milestone.sourceEventId} does not link back to this milestone`);
    }
    if (!Array.isArray(milestone.eventIds) || milestone.eventIds.length === 0) {
      pushIssue(issues, `reputationMilestones/${milestone.id}: missing eventIds`);
    } else {
      const hasMilestoneEvent = milestone.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.reputationMilestoneId === milestone.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "reputation-milestone" && ref.id === milestone.id);
      });
      if (!hasMilestoneEvent) {
        pushIssue(issues, `reputationMilestones/${milestone.id}: no event links back to this milestone`);
      }
    }
    for (let [kind, id] of [["reputation-milestone", milestone.id], ["person", milestone.agentId], ["event", milestone.sourceEventId]]) {
      if (!(milestone.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `reputationMilestones/${milestone.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    if (!reputationMilestoneMap.has(milestone.id)) {
      pushIssue(issues, `reputationMilestones/${milestone.id}: missing from reputation milestone map`);
    }
  }

  const personalityShiftMap = maps.get("personalityShifts") ?? new Map();
  const memoryMap = maps.get("memories") ?? new Map();
  for (let shift of legends.personalityShifts ?? []) {
    if (!Number.isInteger(shift.agentId)) {
      pushIssue(issues, `personalityShifts/${shift.id}: missing agentId`);
    } else {
      const person = maps.get("people")?.get(shift.agentId);
      if (person && !(person.personalityShiftIds ?? []).includes(shift.id)) {
        pushIssue(issues, `personalityShifts/${shift.id}: person ${shift.agentId} does not list this personality shift`);
      }
    }
    const changeCount = (shift.trait == null ? 0 : 1) + (shift.value == null ? 0 : 1);
    if (changeCount !== 1) {
      pushIssue(issues, `personalityShifts/${shift.id}: expected exactly one trait or value`);
    }
    if (!Number.isInteger(shift.sourceMemoryId) || !memoryMap.has(shift.sourceMemoryId)) {
      pushIssue(issues, `personalityShifts/${shift.id}: missing source memory ${shift.sourceMemoryId}`);
    }
    if (!Number.isInteger(shift.sourceEventId) || !eventMap.has(shift.sourceEventId)) {
      pushIssue(issues, `personalityShifts/${shift.id}: missing source event ${shift.sourceEventId}`);
    }
    if (!Array.isArray(shift.eventIds) || shift.eventIds.length === 0) {
      pushIssue(issues, `personalityShifts/${shift.id}: missing eventIds`);
    } else {
      const hasShiftEvent = shift.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.personalityShiftId === shift.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "personality-shift" && ref.id === shift.id);
      });
      if (!hasShiftEvent) {
        pushIssue(issues, `personalityShifts/${shift.id}: no event links back to this personality shift`);
      }
    }
    if (!personalityShiftMap.has(shift.id)) {
      pushIssue(issues, `personalityShifts/${shift.id}: missing from personality shift map`);
    }
  }

  const socialClaimMap = maps.get("socialClaims") ?? new Map();
  const opinionMap = maps.get("opinions") ?? new Map();
  const relationshipMap = maps.get("relationships") ?? new Map();
  for (let claim of legends.socialClaims ?? []) {
    if (!Number.isInteger(claim.agentId)) {
      pushIssue(issues, `socialClaims/${claim.id}: missing agentId`);
    } else {
      const person = maps.get("people")?.get(claim.agentId);
      if (person && !(person.socialClaimIds ?? []).includes(claim.id)) {
        pushIssue(issues, `socialClaims/${claim.id}: person ${claim.agentId} does not list this social claim`);
      }
    }
    if (!Number.isInteger(claim.targetAgentId) || !maps.get("people")?.has(claim.targetAgentId)) {
      pushIssue(issues, `socialClaims/${claim.id}: missing target person ${claim.targetAgentId}`);
    }
    if (claim.agentId === claim.targetAgentId) {
      pushIssue(issues, `socialClaims/${claim.id}: holder and target are the same person`);
    }
    if (claim.kind !== "favor" && claim.kind !== "grudge") {
      pushIssue(issues, `socialClaims/${claim.id}: invalid kind ${claim.kind}`);
    }
    if (!["active", "repaid", "settled", "faded"].includes(claim.status)) {
      pushIssue(issues, `socialClaims/${claim.id}: invalid status ${claim.status}`);
    }
    if (!Number.isInteger(claim.sourceOpinionId) || !opinionMap.has(claim.sourceOpinionId)) {
      pushIssue(issues, `socialClaims/${claim.id}: missing source opinion ${claim.sourceOpinionId}`);
    }
    if (!Number.isInteger(claim.sourceMemoryId) || !memoryMap.has(claim.sourceMemoryId)) {
      pushIssue(issues, `socialClaims/${claim.id}: missing source memory ${claim.sourceMemoryId}`);
    }
    if (!Number.isInteger(claim.sourceEventId) || !eventMap.has(claim.sourceEventId)) {
      pushIssue(issues, `socialClaims/${claim.id}: missing source event ${claim.sourceEventId}`);
    }
    if (claim.relationshipId != null && !relationshipMap.has(claim.relationshipId)) {
      pushIssue(issues, `socialClaims/${claim.id}: missing relationship ${claim.relationshipId}`);
    }
    if (!Array.isArray(claim.eventIds) || claim.eventIds.length === 0) {
      pushIssue(issues, `socialClaims/${claim.id}: missing eventIds`);
    } else {
      const hasClaimEvent = claim.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.socialClaimId === claim.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "social-claim" && ref.id === claim.id);
      });
      if (!hasClaimEvent) {
        pushIssue(issues, `socialClaims/${claim.id}: no event links back to this social claim`);
      }
    }
    if (!socialClaimMap.has(claim.id)) {
      pushIssue(issues, `socialClaims/${claim.id}: missing from social claim map`);
    }
  }

  const relationshipMilestoneMap = maps.get("relationshipMilestones") ?? new Map();
  const personMapForMilestones = maps.get("people") ?? new Map();
  const conversationMap = maps.get("conversations") ?? new Map();
  const validRelationshipMilestoneKinds = new Set(["formed", "deepened", "strained", "reconciled", "claim-made", "ended"]);
  for (let milestone of legends.relationshipMilestones ?? []) {
    if (!validRelationshipMilestoneKinds.has(milestone.kind)) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: invalid kind ${milestone.kind}`);
    }
    if (!Number.isInteger(milestone.year)) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: missing year`);
    }
    if (typeof milestone.status !== "string" || milestone.status.length === 0) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: missing status`);
    }
    const relationship = relationshipMap.get(milestone.relationshipId);
    if (!relationship) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: missing relationship ${milestone.relationshipId}`);
    } else {
      if (!(relationship.milestoneIds ?? []).includes(milestone.id)) {
        pushIssue(issues, `relationshipMilestones/${milestone.id}: relationship ${milestone.relationshipId} does not list this milestone`);
      }
      for (let agentId of milestone.agentIds ?? []) {
        if (!(relationship.agentIds ?? []).includes(agentId)) {
          pushIssue(issues, `relationshipMilestones/${milestone.id}: agent ${agentId} is not part of relationship ${milestone.relationshipId}`);
        }
      }
    }
    if (!Array.isArray(milestone.agentIds) || milestone.agentIds.length !== 2) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: expected two agentIds`);
    } else {
      for (let agentId of milestone.agentIds) {
        const person = personMapForMilestones.get(agentId);
        if (!person) {
          pushIssue(issues, `relationshipMilestones/${milestone.id}: missing person ${agentId}`);
        } else if (!(person.relationshipMilestoneIds ?? []).includes(milestone.id)) {
          pushIssue(issues, `relationshipMilestones/${milestone.id}: person ${agentId} does not list this milestone`);
        }
      }
    }
    const sourceEvent = eventMap.get(milestone.sourceEventId);
    if (!sourceEvent) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: missing source event ${milestone.sourceEventId}`);
    } else if (sourceEvent.relationshipMilestoneId !== milestone.id && !(sourceEvent.entityRefs ?? []).some(ref => ref.kind === "relationship-milestone" && ref.id === milestone.id)) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: source event ${milestone.sourceEventId} does not link back to this milestone`);
    }
    if (milestone.socialClaimId != null && !socialClaimMap.has(milestone.socialClaimId)) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: missing social claim ${milestone.socialClaimId}`);
    }
    if (milestone.conversationId != null && !conversationMap.has(milestone.conversationId)) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: missing conversation ${milestone.conversationId}`);
    }
    if (!Array.isArray(milestone.eventIds) || milestone.eventIds.length === 0) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: missing eventIds`);
    } else {
      const hasMilestoneEvent = milestone.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.relationshipMilestoneId === milestone.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "relationship-milestone" && ref.id === milestone.id);
      });
      if (!hasMilestoneEvent) {
        pushIssue(issues, `relationshipMilestones/${milestone.id}: no event links back to this milestone`);
      }
    }
    for (let [kind, id] of [["relationship-milestone", milestone.id], ["relationship", milestone.relationshipId], ["event", milestone.sourceEventId]]) {
      if (!(milestone.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `relationshipMilestones/${milestone.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    for (let agentId of milestone.agentIds ?? []) {
      if (!(milestone.subjectRefs ?? []).some(ref => ref.kind === "person" && ref.id === agentId)) {
        pushIssue(issues, `relationshipMilestones/${milestone.id}: subjectRefs does not include person/${agentId}`);
      }
    }
    if (!relationshipMilestoneMap.has(milestone.id)) {
      pushIssue(issues, `relationshipMilestones/${milestone.id}: missing from relationship milestone map`);
    }
  }

  const naturalFeatureMap = maps.get("naturalFeatures") ?? new Map();
  for (let feature of legends.naturalFeatures ?? []) {
    if (!Number.isInteger(feature.triangle)) {
      pushIssue(issues, `naturalFeatures/${feature.id}: missing triangle`);
    }
    if (!Number.isFinite(feature.x) || !Number.isFinite(feature.y)) {
      pushIssue(issues, `naturalFeatures/${feature.id}: missing coordinates`);
    }
    if (!Array.isArray(feature.eventIds) || feature.eventIds.length === 0) {
      pushIssue(issues, `naturalFeatures/${feature.id}: missing eventIds`);
    } else {
      const hasFeatureEvent = feature.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.naturalFeatureId === feature.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "natural-feature" && ref.id === feature.id);
      });
      if (!hasFeatureEvent) {
        pushIssue(issues, `naturalFeatures/${feature.id}: no event links back to this feature`);
      }
    }
    if (!naturalFeatureMap.has(feature.id)) {
      pushIssue(issues, `naturalFeatures/${feature.id}: missing from natural feature map`);
    }
  }

  const mythsAndMagicByCiv = new Map();
  for (let record of legends.mythsAndMagic ?? []) {
    if (mythsAndMagicByCiv.has(record.civilizationId)) {
      pushIssue(issues, `mythsAndMagic/${record.id}: duplicate myths and magic record for civilization ${record.civilizationId}`);
    }
    mythsAndMagicByCiv.set(record.civilizationId, record);
    if (record.id !== record.civilizationId) {
      pushIssue(issues, `mythsAndMagic/${record.id}: expected id to match civilizationId ${record.civilizationId}`);
    }
    const civilization = maps.get("civilizations")?.get(record.civilizationId);
    if (!civilization) {
      pushIssue(issues, `mythsAndMagic/${record.id}: missing civilization ${record.civilizationId}`);
      continue;
    }
    if (record.capitalSettlementId !== civilization.capitalSettlementId) {
      pushIssue(issues, `mythsAndMagic/${record.id}: capitalSettlementId ${record.capitalSettlementId} does not match civilization capital ${civilization.capitalSettlementId}`);
    }
    const assertCivilization = (field, key) => {
      for (let id of record[field] ?? []) {
        const target = maps.get(key)?.get(id);
        if (!target) continue;
        if (target.civilizationId !== record.civilizationId) {
          pushIssue(issues, `mythsAndMagic/${record.id}: ${field} contains ${key}/${id} from civilization ${target.civilizationId}`);
        }
      }
    };
    assertCivilization("beliefIds", "beliefs");
    assertCivilization("mythIds", "myths");
    assertCivilization("doctrineIds", "doctrines");
    assertCivilization("magicRoleIds", "magicRoles");
    assertCivilization("prophecyIds", "prophecies");
    assertCivilization("civilizationGoalIds", "civilizationGoals");
    assertCivilization("sacredSiteIds", "sacredSites");
    const prophecyIds = new Set(record.prophecyIds ?? []);
    for (let id of record.openProphecyIds ?? []) {
      const prophecy = maps.get("prophecies")?.get(id);
      if (!prophecyIds.has(id)) pushIssue(issues, `mythsAndMagic/${record.id}: openProphecyIds contains prophecy ${id} not present in prophecyIds`);
      if (prophecy && prophecy.status !== "open") pushIssue(issues, `mythsAndMagic/${record.id}: openProphecyIds contains ${prophecy.status} prophecy ${id}`);
    }
    const goalIds = new Set(record.civilizationGoalIds ?? []);
    for (let id of record.activeCivilizationGoalIds ?? []) {
      const goal = maps.get("civilizationGoals")?.get(id);
      if (!goalIds.has(id)) pushIssue(issues, `mythsAndMagic/${record.id}: activeCivilizationGoalIds contains goal ${id} not present in civilizationGoalIds`);
      if (goal && goal.status !== "active") pushIssue(issues, `mythsAndMagic/${record.id}: activeCivilizationGoalIds contains ${goal.status} goal ${id}`);
    }
    const holderIds = new Set(record.magicRoleHolderIds ?? []);
    for (let roleId of record.magicRoleIds ?? []) {
      const role = maps.get("magicRoles")?.get(roleId);
      if (role && !holderIds.has(role.agentId)) {
        pushIssue(issues, `mythsAndMagic/${record.id}: missing holder ${role.agentId} for magic role ${roleId}`);
      }
    }
    if (!(record.subjectRefs ?? []).some(ref => ref.kind === "civilization" && ref.id === record.civilizationId)) {
      pushIssue(issues, `mythsAndMagic/${record.id}: subjectRefs does not include its civilization`);
    }
  }
  for (let civilization of legends.civilizations ?? []) {
    const record = mythsAndMagicByCiv.get(civilization.id);
    if (!record) {
      pushIssue(issues, `civilizations/${civilization.id}: missing mythsAndMagic record`);
      continue;
    }
    if (civilization.mythsMagicId !== record.id) {
      pushIssue(issues, `civilizations/${civilization.id}: mythsMagicId ${civilization.mythsMagicId} does not point to mythsAndMagic/${record.id}`);
    }
    if (!Array.isArray(civilization.beliefIds)) {
      pushIssue(issues, `civilizations/${civilization.id}: missing beliefIds`);
    } else {
      const civBeliefIds = new Set(civilization.beliefIds);
      const recordBeliefIds = new Set(record.beliefIds ?? []);
      for (let beliefId of civilization.beliefIds) {
        const belief = maps.get("beliefs")?.get(beliefId);
        if (!belief) continue;
        if (belief.civilizationId !== civilization.id) {
          pushIssue(issues, `civilizations/${civilization.id}: beliefIds contains belief ${beliefId} from civilization ${belief.civilizationId}`);
        }
        if (!recordBeliefIds.has(beliefId)) {
          pushIssue(issues, `civilizations/${civilization.id}: beliefIds contains belief ${beliefId} missing from mythsAndMagic/${record.id}`);
        }
      }
      for (let beliefId of recordBeliefIds) {
        if (!civBeliefIds.has(beliefId)) {
          pushIssue(issues, `civilizations/${civilization.id}: missing belief ${beliefId} listed by mythsAndMagic/${record.id}`);
        }
      }
    }
  }

  const woundLegacyMap = maps.get("woundLegacies") ?? new Map();
  const injuryMap = maps.get("injuries") ?? new Map();
  const illnessMap = maps.get("illnesses") ?? new Map();
  const careRecordMap = maps.get("careRecords") ?? new Map();
  const battleParticipationMap = maps.get("battleParticipations") ?? new Map();
  for (let legacy of legends.woundLegacies ?? []) {
    const person = personMap.get(legacy.personId);
    if (!person) {
      pushIssue(issues, `woundLegacies/${legacy.id}: missing person ${legacy.personId}`);
    } else if (!(person.woundLegacyIds ?? []).includes(legacy.id)) {
      pushIssue(issues, `woundLegacies/${legacy.id}: person ${legacy.personId} does not list this wound legacy`);
    }

    const injury = injuryMap.get(legacy.injuryId);
    if (!injury) {
      pushIssue(issues, `woundLegacies/${legacy.id}: missing injury ${legacy.injuryId}`);
    } else {
      if (injury.personId !== legacy.personId) pushIssue(issues, `woundLegacies/${legacy.id}: injury ${legacy.injuryId} belongs to person ${injury.personId}, not ${legacy.personId}`);
      if (injury.civilizationId !== legacy.civilizationId) pushIssue(issues, `woundLegacies/${legacy.id}: injury ${legacy.injuryId} has civilization ${injury.civilizationId}, not ${legacy.civilizationId}`);
      if (injury.severity !== legacy.severity) pushIssue(issues, `woundLegacies/${legacy.id}: injury severity ${injury.severity} does not match legacy severity ${legacy.severity}`);
      if (legacy.careRecordId != null && !(injury.careRecordIds ?? []).includes(legacy.careRecordId)) {
        pushIssue(issues, `woundLegacies/${legacy.id}: injury ${legacy.injuryId} does not list care record ${legacy.careRecordId}`);
      }
    }

    if (legacy.illnessId != null) {
      const illness = illnessMap.get(legacy.illnessId);
      if (!illness) {
        pushIssue(issues, `woundLegacies/${legacy.id}: missing illness ${legacy.illnessId}`);
      } else {
        if (illness.personId !== legacy.personId) pushIssue(issues, `woundLegacies/${legacy.id}: illness ${legacy.illnessId} belongs to person ${illness.personId}, not ${legacy.personId}`);
        if (illness.injuryId !== legacy.injuryId) pushIssue(issues, `woundLegacies/${legacy.id}: illness ${legacy.illnessId} points to injury ${illness.injuryId}, not ${legacy.injuryId}`);
      }
    }

    if (legacy.careRecordId != null) {
      const care = careRecordMap.get(legacy.careRecordId);
      if (!care) {
        pushIssue(issues, `woundLegacies/${legacy.id}: missing care record ${legacy.careRecordId}`);
      } else {
        if (care.patientAgentId !== legacy.personId) pushIssue(issues, `woundLegacies/${legacy.id}: care record ${legacy.careRecordId} belongs to patient ${care.patientAgentId}, not ${legacy.personId}`);
        if (care.injuryId !== legacy.injuryId) pushIssue(issues, `woundLegacies/${legacy.id}: care record ${legacy.careRecordId} points to injury ${care.injuryId}, not ${legacy.injuryId}`);
        if (legacy.illnessId != null && care.illnessId !== legacy.illnessId) pushIssue(issues, `woundLegacies/${legacy.id}: care record ${legacy.careRecordId} points to illness ${care.illnessId}, not ${legacy.illnessId}`);
      }
    }

    if (legacy.battleParticipationId != null) {
      const participation = battleParticipationMap.get(legacy.battleParticipationId);
      if (!participation) {
        pushIssue(issues, `woundLegacies/${legacy.id}: missing battle participation ${legacy.battleParticipationId}`);
      } else {
        if (participation.agentId !== legacy.personId) pushIssue(issues, `woundLegacies/${legacy.id}: battle participation ${legacy.battleParticipationId} belongs to person ${participation.agentId}, not ${legacy.personId}`);
        if (legacy.battleId != null && participation.battleId !== legacy.battleId) pushIssue(issues, `woundLegacies/${legacy.id}: battle participation ${legacy.battleParticipationId} points to battle ${participation.battleId}, not ${legacy.battleId}`);
      }
    }

    if (!Number.isInteger(legacy.sourceEventId) || !eventMap.has(legacy.sourceEventId)) {
      pushIssue(issues, `woundLegacies/${legacy.id}: missing source event ${legacy.sourceEventId}`);
    }
    if (!Array.isArray(legacy.eventIds) || legacy.eventIds.length === 0) {
      pushIssue(issues, `woundLegacies/${legacy.id}: missing eventIds`);
    } else {
      const hasLegacyEvent = legacy.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.woundLegacyId === legacy.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "wound-legacy" && ref.id === legacy.id);
      });
      if (!hasLegacyEvent) {
        pushIssue(issues, `woundLegacies/${legacy.id}: no event links back to this wound legacy`);
      }
    }
    for (let [kind, id] of [["wound-legacy", legacy.id], ["person", legacy.personId], ["injury", legacy.injuryId]]) {
      if (!(legacy.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `woundLegacies/${legacy.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    if (legacy.careRecordId != null && !(legacy.subjectRefs ?? []).some(ref => ref.kind === "care-record" && ref.id === legacy.careRecordId)) {
      pushIssue(issues, `woundLegacies/${legacy.id}: subjectRefs does not include care-record/${legacy.careRecordId}`);
    }
    if (!woundLegacyMap.has(legacy.id)) {
      pushIssue(issues, `woundLegacies/${legacy.id}: missing from wound legacy map`);
    }
  }

  const burialMap = maps.get("burials") ?? new Map();
  const memorialMap = maps.get("memorials") ?? new Map();
  const artifactMap = maps.get("artifacts") ?? new Map();
  const belongingMap = maps.get("belongings") ?? new Map();
  const validBurialKinds = new Set(["grave-burial", "tomb-interment", "battlefield-burial", "ancestor-resting-place"]);
  for (let burial of legends.burials ?? []) {
    const person = personMap.get(burial.personId);
    if (!person) {
      pushIssue(issues, `burials/${burial.id}: missing person ${burial.personId}`);
    } else if (!(person.burialIds ?? []).includes(burial.id)) {
      pushIssue(issues, `burials/${burial.id}: person ${burial.personId} does not list this burial`);
    }
    if (!validBurialKinds.has(burial.kind)) {
      pushIssue(issues, `burials/${burial.id}: invalid kind ${burial.kind}`);
    }
    const deathEvent = eventMap.get(burial.deathEventId);
    if (!deathEvent) {
      pushIssue(issues, `burials/${burial.id}: missing death event ${burial.deathEventId}`);
    } else {
      if (deathEvent.personId !== burial.personId) pushIssue(issues, `burials/${burial.id}: death event ${burial.deathEventId} belongs to person ${deathEvent.personId}, not ${burial.personId}`);
      if (deathEvent.burialId !== burial.id && !(deathEvent.entityRefs ?? []).some(ref => ref.kind === "burial" && ref.id === burial.id)) {
        pushIssue(issues, `burials/${burial.id}: death event ${burial.deathEventId} does not link back to this burial`);
      }
    }
    if (burial.memorialId != null) {
      const memorial = memorialMap.get(burial.memorialId);
      if (!memorial) {
        pushIssue(issues, `burials/${burial.id}: missing memorial ${burial.memorialId}`);
      } else if (memorial.personId !== burial.personId) {
        pushIssue(issues, `burials/${burial.id}: memorial ${burial.memorialId} belongs to person ${memorial.personId}, not ${burial.personId}`);
      }
    }
    for (let mournerId of burial.mournerAgentIds ?? []) {
      if (!personMap.has(mournerId)) pushIssue(issues, `burials/${burial.id}: missing mourner ${mournerId}`);
    }
    for (let artifactId of burial.graveGoodArtifactIds ?? []) {
      if (!artifactMap.has(artifactId)) pushIssue(issues, `burials/${burial.id}: missing grave good artifact ${artifactId}`);
    }
    for (let belongingId of burial.graveGoodBelongingIds ?? []) {
      if (!belongingMap.has(belongingId)) pushIssue(issues, `burials/${burial.id}: missing grave good belonging ${belongingId}`);
    }
    if (!Array.isArray(burial.eventIds) || burial.eventIds.length === 0) {
      pushIssue(issues, `burials/${burial.id}: missing eventIds`);
    } else {
      const hasBurialEvent = burial.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.burialId === burial.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "burial" && ref.id === burial.id);
      });
      if (!hasBurialEvent) {
        pushIssue(issues, `burials/${burial.id}: no event links back to this burial`);
      }
    }
    for (let [kind, id] of [["burial", burial.id], ["person", burial.personId], ["event", burial.deathEventId], ["settlement", burial.settlementId], ["civilization", burial.civilizationId]]) {
      if (!(burial.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `burials/${burial.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    if (burial.memorialId != null && !(burial.subjectRefs ?? []).some(ref => ref.kind === "memorial" && ref.id === burial.memorialId)) {
      pushIssue(issues, `burials/${burial.id}: subjectRefs does not include memorial/${burial.memorialId}`);
    }
    if (!burialMap.has(burial.id)) {
      pushIssue(issues, `burials/${burial.id}: missing from burial map`);
    }
  }

  const deathRecordMap = maps.get("deathRecords") ?? new Map();
  const estateMap = maps.get("estates") ?? new Map();
  const validDeathCauseKinds = new Set(["battle", "old-age", "illness", "injury", "hunger", "unrest", "hardship"]);
  for (let person of legends.people ?? []) {
    if (person.alive === false && !Number.isInteger(person.deathRecordId)) {
      pushIssue(issues, `people/${person.id}: dead person missing deathRecordId`);
    }
  }
  for (let record of legends.deathRecords ?? []) {
    const person = personMap.get(record.personId);
    if (!person) {
      pushIssue(issues, `deathRecords/${record.id}: missing person ${record.personId}`);
    } else {
      if (person.deathRecordId !== record.id) pushIssue(issues, `deathRecords/${record.id}: person ${record.personId} does not link back to this death record`);
      if (person.alive !== false) pushIssue(issues, `deathRecords/${record.id}: person ${record.personId} is not marked dead`);
      if (person.diedYear !== record.year) pushIssue(issues, `deathRecords/${record.id}: year ${record.year} does not match person diedYear ${person.diedYear}`);
    }
    if (!validDeathCauseKinds.has(record.kind)) {
      pushIssue(issues, `deathRecords/${record.id}: invalid kind ${record.kind}`);
    }
    if (!Number.isInteger(record.age) || record.age < 0) {
      pushIssue(issues, `deathRecords/${record.id}: invalid age ${record.age}`);
    }
    const sourceEvent = eventMap.get(record.sourceEventId);
    if (!sourceEvent) {
      pushIssue(issues, `deathRecords/${record.id}: missing source event ${record.sourceEventId}`);
    } else {
      if (sourceEvent.type !== "person-died" && sourceEvent.type !== "battle-casualty") pushIssue(issues, `deathRecords/${record.id}: source event ${record.sourceEventId} has type ${sourceEvent.type}`);
      if (sourceEvent.personId !== record.personId) pushIssue(issues, `deathRecords/${record.id}: source event ${record.sourceEventId} belongs to person ${sourceEvent.personId}, not ${record.personId}`);
      if (record.kind === "battle" && sourceEvent.type !== "battle-casualty") pushIssue(issues, `deathRecords/${record.id}: battle death source event is ${sourceEvent.type}`);
      if (record.kind !== "battle" && sourceEvent.type !== "person-died") pushIssue(issues, `deathRecords/${record.id}: non-battle death source event is ${sourceEvent.type}`);
      if (sourceEvent.deathRecordId !== record.id && !(sourceEvent.entityRefs ?? []).some(ref => ref.kind === "death-record" && ref.id === record.id)) {
        pushIssue(issues, `deathRecords/${record.id}: source event ${record.sourceEventId} does not link back to this death record`);
      }
    }
    if (record.memorialId != null) {
      const memorial = memorialMap.get(record.memorialId);
      if (!memorial) pushIssue(issues, `deathRecords/${record.id}: missing memorial ${record.memorialId}`);
      else if (memorial.personId !== record.personId) pushIssue(issues, `deathRecords/${record.id}: memorial ${record.memorialId} belongs to person ${memorial.personId}, not ${record.personId}`);
    }
    if (record.burialId != null) {
      const burial = burialMap.get(record.burialId);
      if (!burial) pushIssue(issues, `deathRecords/${record.id}: missing burial ${record.burialId}`);
      else if (burial.personId !== record.personId) pushIssue(issues, `deathRecords/${record.id}: burial ${record.burialId} belongs to person ${burial.personId}, not ${record.personId}`);
    }
    if (record.estateId != null) {
      const estate = estateMap.get(record.estateId);
      if (!estate) pushIssue(issues, `deathRecords/${record.id}: missing estate ${record.estateId}`);
      else if (estate.decedentAgentId !== record.personId) pushIssue(issues, `deathRecords/${record.id}: estate ${record.estateId} belongs to decedent ${estate.decedentAgentId}, not ${record.personId}`);
    }
    if (record.battleParticipationId != null) {
      const participation = battleParticipationMap.get(record.battleParticipationId);
      if (!participation) pushIssue(issues, `deathRecords/${record.id}: missing battle participation ${record.battleParticipationId}`);
      else if (participation.agentId !== record.personId) pushIssue(issues, `deathRecords/${record.id}: battle participation ${record.battleParticipationId} belongs to person ${participation.agentId}, not ${record.personId}`);
    }
    for (let injuryId of record.injuryIds ?? []) {
      const injury = injuryMap.get(injuryId);
      if (!injury) pushIssue(issues, `deathRecords/${record.id}: missing injury ${injuryId}`);
      else {
        if (injury.personId !== record.personId) pushIssue(issues, `deathRecords/${record.id}: injury ${injuryId} belongs to person ${injury.personId}, not ${record.personId}`);
        if (injury.status !== "fatal") pushIssue(issues, `deathRecords/${record.id}: injury ${injuryId} is ${injury.status}, not fatal`);
      }
    }
    for (let illnessId of record.illnessIds ?? []) {
      const illness = illnessMap.get(illnessId);
      if (!illness) pushIssue(issues, `deathRecords/${record.id}: missing illness ${illnessId}`);
      else {
        if (illness.personId !== record.personId) pushIssue(issues, `deathRecords/${record.id}: illness ${illnessId} belongs to person ${illness.personId}, not ${record.personId}`);
        if (illness.status !== "fatal") pushIssue(issues, `deathRecords/${record.id}: illness ${illnessId} is ${illness.status}, not fatal`);
      }
    }
    if (!Array.isArray(record.eventIds) || !record.eventIds.includes(record.sourceEventId)) {
      pushIssue(issues, `deathRecords/${record.id}: eventIds does not include source event ${record.sourceEventId}`);
    }
    for (let [kind, id] of [["death-record", record.id], ["person", record.personId], ["event", record.sourceEventId], ["settlement", record.settlementId], ["civilization", record.civilizationId]]) {
      if (!(record.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `deathRecords/${record.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    for (let [field, kind] of [["householdId", "household"], ["lineageId", "lineage"], ["beliefId", "belief"], ["battleId", "battle"], ["battleParticipationId", "battle-participation"], ["memorialId", "memorial"], ["burialId", "burial"], ["estateId", "estate"]]) {
      const id = record[field];
      if (id != null && !(record.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `deathRecords/${record.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    if (!deathRecordMap.has(record.id)) {
      pushIssue(issues, `deathRecords/${record.id}: missing from death record map`);
    }
  }

  const needEpisodeMap = maps.get("needEpisodes") ?? new Map();
  const validNeedEpisodeStatuses = new Set(["active", "resolved"]);
  for (let episode of legends.needEpisodes ?? []) {
    const person = personMap.get(episode.personId);
    if (!person) {
      pushIssue(issues, `needEpisodes/${episode.id}: missing person ${episode.personId}`);
    } else if (!(person.needEpisodeIds ?? []).includes(episode.id)) {
      pushIssue(issues, `needEpisodes/${episode.id}: person ${episode.personId} does not list this need episode`);
    }
    if (!validNeedEpisodeStatuses.has(episode.status)) {
      pushIssue(issues, `needEpisodes/${episode.id}: invalid status ${episode.status}`);
    }
    if (!episode.kind) {
      pushIssue(issues, `needEpisodes/${episode.id}: missing kind`);
    }
    if (!Number.isInteger(episode.startedYear)) {
      pushIssue(issues, `needEpisodes/${episode.id}: missing startedYear`);
    }
    if (episode.status === "resolved" && !Number.isInteger(episode.resolvedYear)) {
      pushIssue(issues, `needEpisodes/${episode.id}: resolved episode missing resolvedYear`);
    }
    if (episode.status === "active" && episode.resolvedYear != null) {
      pushIssue(issues, `needEpisodes/${episode.id}: active episode has resolvedYear ${episode.resolvedYear}`);
    }
    if (Number.isInteger(episode.resolvedYear) && Number.isInteger(episode.startedYear) && episode.resolvedYear < episode.startedYear) {
      pushIssue(issues, `needEpisodes/${episode.id}: resolvedYear ${episode.resolvedYear} is before startedYear ${episode.startedYear}`);
    }
    for (let eventField of ["sourceEventId", "resolvedEventId"]) {
      if (episode[eventField] == null) continue;
      const event = eventMap.get(episode[eventField]);
      if (!event) {
        pushIssue(issues, `needEpisodes/${episode.id}: missing ${eventField} ${episode[eventField]}`);
      } else if (event.needEpisodeId !== episode.id && !(event.entityRefs ?? []).some(ref => ref.kind === "need-episode" && ref.id === episode.id)) {
        pushIssue(issues, `needEpisodes/${episode.id}: ${eventField} ${episode[eventField]} does not link back to this need episode`);
      }
    }
    if (episode.resolvedEventId != null && episode.status !== "resolved") {
      pushIssue(issues, `needEpisodes/${episode.id}: unresolved status has resolvedEventId ${episode.resolvedEventId}`);
    }
    if (!Array.isArray(episode.eventIds) || episode.eventIds.length === 0) {
      pushIssue(issues, `needEpisodes/${episode.id}: missing eventIds`);
    } else {
      const hasEpisodeEvent = episode.eventIds.some(eventId => {
        const event = eventMap.get(eventId);
        return event?.needEpisodeId === episode.id
          || (event?.entityRefs ?? []).some(ref => ref.kind === "need-episode" && ref.id === episode.id);
      });
      if (!hasEpisodeEvent) {
        pushIssue(issues, `needEpisodes/${episode.id}: no event links back to this need episode`);
      }
    }
    for (let [kind, id] of [["need-episode", episode.id], ["person", episode.personId], ["civilization", episode.civilizationId], ["settlement", episode.settlementId]]) {
      if (!(episode.subjectRefs ?? []).some(ref => ref.kind === kind && ref.id === id)) {
        pushIssue(issues, `needEpisodes/${episode.id}: subjectRefs does not include ${kind}/${id}`);
      }
    }
    if (!needEpisodeMap.has(episode.id)) {
      pushIssue(issues, `needEpisodes/${episode.id}: missing from need episode map`);
    }
  }

  for (let person of legends.people ?? []) {
    if (!Array.isArray(person.eventIds)) continue;
    for (let eventId of person.eventIds.slice(0, 50)) {
      const event = eventMap.get(eventId);
      if (!event) continue;
      const mentionsPerson = event.personId === person.id
        || (event.entityRefs ?? []).some(ref => ref.kind === "person" && ref.id === person.id);
      if (!mentionsPerson) pushIssue(issues, `people/${person.id}: event ${eventId} does not mention that person`);
    }
  }

  const journeyMap = maps.get("journeys") ?? new Map();
  for (let road of legends.roads ?? []) {
    if (!Array.isArray(road.eventIds)) continue;
    for (let eventId of road.eventIds) {
      const event = eventMap.get(eventId);
      if (!event) continue;
      const directRoadRef = (event.entityRefs ?? []).some(ref => ref.kind === "road" && ref.id === road.id);
      const journeyIds = [
        event.journeyId,
        ...(event.entityRefs ?? []).filter(ref => ref.kind === "journey").map(ref => ref.id),
      ].filter(id => Number.isInteger(id));
      const journeyRoadRef = journeyIds.some(journeyId => (journeyMap.get(journeyId)?.roadIds ?? []).includes(road.id));
      if (!directRoadRef && !journeyRoadRef) {
        pushIssue(issues, `roads/${road.id}: event ${eventId} does not mention that road or a journey using it`);
      }
    }
  }
}

function validateArchive(legends) {
  const issues = [];
  validateTopLevelCounts(issues, legends);
  const maps = buildRecordMaps(issues, legends);
  validateCoreHistory(issues, legends, maps);

  for (let [, key] of kindSpecs) {
    for (let record of legends[key] ?? []) {
      validateObjectLinks(issues, maps, record, `${key}/${record.id ?? "?"}`);
    }
  }

  return {issues, maps};
}

const explicitEventMentionFields = new Set([
  "battleEventId",
  "casualtyEventId",
  "ceremonyEventId",
  "endEventId",
  "endedEventId",
  "eventId",
  "lastInteractionEventId",
  "onsetEventId",
  "projectEventId",
  "recordedEventId",
  "revealedEventId",
  "resolvedEventId",
  "settledEventId",
  "sourceEventId",
  "sourceEventIds",
  "startEventId",
  "startedEventId",
  "targetEventId",
  "transferredEventId",
]);

function archiveHasExplicitEventMentions(legends) {
  for (let [, key] of kindSpecs) {
    if (key === "events") continue;
    for (let record of legends[key] ?? []) {
      if (!isRecord(record)) continue;
      for (let field of explicitEventMentionFields) {
        const value = record[field];
        if (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null) return true;
      }
      for (let field of ["subjectRefs", "entityRefs", "targetRefs"]) {
        if ((record[field] ?? []).some(ref => ref?.kind === "event")) return true;
      }
      if (record.targetRef?.kind === "event") return true;
    }
  }
  return false;
}

const derivedChapterSources = [
  ["people", "people", "lifeChapters"],
  ["relationships", "relationships", "relationshipChapters"],
  ["settlements", "settlements", "placeChapters"],
  ["artifacts", "artifacts", "artifactChapters"],
  ["roads", "roads", "roadChapters"],
  ["structures", "structures", "structureChapters"],
  ["conflicts", "conflicts", "conflictChapters"],
  ["battles", "battles", "battleChapters"],
  ["civilizations", "civilizations", "civilizationChapters"],
  ["organizations", "organizations", "organizationChapters"],
  ["households", "households", "householdChapters"],
  ["lineages", "lineages", "lineageChapters"],
];

function derivedChapterCount(legends) {
  let count = 0;
  for (let [, key, chapterKey] of derivedChapterSources) {
    for (let record of legends[key] ?? []) {
      count += Array.isArray(record?.[chapterKey]) ? record[chapterKey].length : 0;
    }
  }
  return count;
}

function expectedViewerCounts(legends) {
  const counts = new Map();
  for (let [viewerKind, key] of kindSpecs) {
    counts.set(viewerKind, Array.isArray(legends[key]) ? legends[key].length : 0);
  }
  counts.set("chapters", derivedChapterCount(legends));
  return counts;
}

function validateViewerRecordFiles(issues, viewerDir, viewerKind, expectedLength) {
  const indexPath = path.join(viewerDir, "indexes", `${viewerKind}.json`);
  if (!fs.existsSync(indexPath)) {
    pushIssue(issues, `viewer: missing index ${indexPath}`);
    return undefined;
  }
  const index = readJson(indexPath);
  if (!Array.isArray(index)) {
    pushIssue(issues, `viewer: index ${viewerKind} is not an array`);
  } else if (index.length !== expectedLength) {
    pushIssue(issues, `viewer: index ${viewerKind} length ${index.length} does not match expected length ${expectedLength}`);
  } else if (index.length > 0) {
    const sample = index[0];
    if (!Number.isInteger(sample.id) || typeof sample.label !== "string") {
      pushIssue(issues, `viewer: index ${viewerKind} sample entry is missing id/label`);
    }
  }

  const recordsDir = path.join(viewerDir, "records", viewerKind);
  const expectedChunks = Math.ceil(expectedLength / chunkSize);
  for (let chunkId = 0; chunkId < expectedChunks; chunkId++) {
    const chunkPath = path.join(recordsDir, `${chunkId}.json`);
    if (!fs.existsSync(chunkPath)) {
      pushIssue(issues, `viewer: missing record chunk ${chunkPath}`);
      continue;
    }
    const chunk = readJson(chunkPath);
    const expectedChunkLength = chunkId === expectedChunks - 1 ? expectedLength - chunkId * chunkSize : chunkSize;
    if (!Array.isArray(chunk)) {
      pushIssue(issues, `viewer: record chunk ${viewerKind}/${chunkId} is not an array`);
    } else if (chunk.length !== expectedChunkLength) {
      pushIssue(issues, `viewer: record chunk ${viewerKind}/${chunkId} length ${chunk.length} expected ${expectedChunkLength}`);
    }
  }
  return index;
}

function readViewerRecordChunks(issues, viewerDir, viewerKind, expectedLength) {
  const records = [];
  const recordsDir = path.join(viewerDir, "records", viewerKind);
  const expectedChunks = Math.ceil(expectedLength / chunkSize);
  for (let chunkId = 0; chunkId < expectedChunks; chunkId++) {
    const chunkPath = path.join(recordsDir, `${chunkId}.json`);
    if (!fs.existsSync(chunkPath)) continue;
    const chunk = readJson(chunkPath);
    if (!Array.isArray(chunk)) continue;
    records.push(...chunk);
  }
  return records;
}

function validateViewerChapters(issues, legends, viewerDir, counts) {
  const expectedLength = counts.get("chapters") ?? 0;
  if (expectedLength === 0) return;

  validateViewerRecordFiles(issues, viewerDir, "chapters", expectedLength);
  const chapterRecords = readViewerRecordChunks(issues, viewerDir, "chapters", expectedLength);
  const chapterIds = new Set();
  for (let i = 0; i < chapterRecords.length; i++) {
    const record = chapterRecords[i];
    if (!isRecord(record)) {
      pushIssue(issues, `viewer: chapters record ${i} is not an object`);
      continue;
    }
    if (!Number.isInteger(record.id)) pushIssue(issues, `viewer: chapters record ${i} missing integer id`);
    else chapterIds.add(record.id);
    if (typeof record.ownerKind !== "string" || !Number.isInteger(record.ownerId)) {
      pushIssue(issues, `viewer: chapter ${record.id ?? i} missing ownerKind/ownerId`);
    }
    if (typeof record.chapterKind !== "string" || typeof record.chapterType !== "string") {
      pushIssue(issues, `viewer: chapter ${record.id ?? i} missing chapter kind/type`);
    }
  }

  const embeddedChapterIds = new Set();
  let embeddedCount = 0;
  for (let [viewerKind, key, chapterKey] of derivedChapterSources) {
    const ownerCount = counts.get(viewerKind) ?? 0;
    if (ownerCount === 0) continue;
    const owners = readViewerRecordChunks(issues, viewerDir, viewerKind, ownerCount);
    for (let owner of owners) {
      const chapters = owner?.[chapterKey];
      if (!Array.isArray(chapters)) continue;
      for (let chapter of chapters) {
        embeddedCount += 1;
        if (!Number.isInteger(chapter?.chapterId)) {
          pushIssue(issues, `viewer: ${viewerKind}/${owner?.id ?? "?"}.${chapterKey} missing chapterId`);
          continue;
        }
        embeddedChapterIds.add(chapter.chapterId);
        if (!chapterIds.has(chapter.chapterId)) {
          pushIssue(issues, `viewer: ${viewerKind}/${owner?.id ?? "?"}.${chapterKey} points to missing chapter ${chapter.chapterId}`);
        }
      }
    }
  }
  if (embeddedCount !== expectedLength) {
    pushIssue(issues, `viewer: embedded owner chapter count ${embeddedCount} does not match derived chapter count ${expectedLength}`);
  }
  if (embeddedChapterIds.size !== expectedLength) {
    pushIssue(issues, `viewer: embedded owner chapter ids cover ${embeddedChapterIds.size} unique chapters, expected ${expectedLength}`);
  }

  const mentionDir = path.join(viewerDir, "mentions", "chapters");
  if (!fs.existsSync(mentionDir)) {
    pushIssue(issues, `viewer: missing mention directory ${mentionDir}`);
    return;
  }
  const mentionedChapterIds = new Set();
  for (let file of fs.readdirSync(mentionDir)) {
    if (!file.endsWith(".json")) continue;
    const chunkPath = path.join(mentionDir, file);
    const mentions = readJson(chunkPath);
    if (!isRecord(mentions)) {
      pushIssue(issues, `viewer: mention chunk ${chunkPath} is not an object`);
      continue;
    }
    for (let [id, groups] of Object.entries(mentions)) {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || !chapterIds.has(numericId)) {
        pushIssue(issues, `viewer: mention chunk ${chunkPath} has unknown chapter target ${id}`);
        continue;
      }
      if (!isRecord(groups)) pushIssue(issues, `viewer: chapter mentions ${id} is not an object`);
      mentionedChapterIds.add(numericId);
    }
  }
  if (mentionedChapterIds.size !== expectedLength) {
    pushIssue(issues, `viewer: mentions/chapters covers ${mentionedChapterIds.size} chapters, expected ${expectedLength}`);
  }
}

function validateViewer(issues, legends, viewerDir) {
  const htmlPath = path.join(viewerDir, "index.html");
  if (!fs.existsSync(htmlPath)) pushIssue(issues, `viewer: missing ${htmlPath}`);

  const counts = expectedViewerCounts(legends);
  for (let [viewerKind, expectedLength] of counts) {
    if (expectedLength > 0) validateViewerRecordFiles(issues, viewerDir, viewerKind, expectedLength);
  }
  validateViewerChapters(issues, legends, viewerDir, counts);

  const checkedMentionKinds = new Set();
  const validateMentionKind = (viewerKind, required) => {
    if (!viewerKindToKey.has(viewerKind) || (counts.get(viewerKind) ?? 0) === 0) return;
    const mentionDir = path.join(viewerDir, "mentions", viewerKind);
    if (!fs.existsSync(mentionDir)) {
      if (required) pushIssue(issues, `viewer: missing mention directory ${mentionDir}`);
      return;
    }
    checkedMentionKinds.add(viewerKind);
    for (let file of fs.readdirSync(mentionDir)) {
      if (!file.endsWith(".json")) continue;
      const chunkPath = path.join(mentionDir, file);
      const mentions = readJson(chunkPath);
      if (!isRecord(mentions)) pushIssue(issues, `viewer: mention chunk ${chunkPath} is not an object`);
    }
  };

  for (let viewerKind of ["people", "settlements", "artifacts"]) validateMentionKind(viewerKind, true);
  if ((legends.journeys ?? []).some(journey => Array.isArray(journey.roadIds) && journey.roadIds.length > 0)) {
    validateMentionKind("roads", true);
  }
  if (archiveHasExplicitEventMentions(legends)) validateMentionKind("events", true);

  const mentionsRoot = path.join(viewerDir, "mentions");
  if (fs.existsSync(mentionsRoot)) {
    for (let entry of fs.readdirSync(mentionsRoot, {withFileTypes: true})) {
      if (!entry.isDirectory() || checkedMentionKinds.has(entry.name)) continue;
      if (!viewerKindToKey.has(entry.name)) {
        pushIssue(issues, `viewer: unknown mention directory ${path.join(mentionsRoot, entry.name)}`);
        continue;
      }
      validateMentionKind(entry.name, false);
    }
  }
}

function summarize(legends, viewerDir) {
  const top = [
    ["year", legends.year],
    ["civilizations", legends.civilizations?.length ?? 0],
    ["settlements", legends.settlements?.length ?? 0],
    ["people", legends.people?.length ?? 0],
    ["deathRecords", legends.deathRecords?.length ?? 0],
    ["appearanceFeatures", legends.appearanceFeatures?.length ?? 0],
    ["artifacts", legends.artifacts?.length ?? 0],
    ["roads", legends.roads?.length ?? 0],
    ["mythsAndMagic", legends.mythsAndMagic?.length ?? 0],
    ["events", legends.events?.length ?? 0],
    ["viewer", viewerDir ? path.resolve(viewerDir) : "not checked"],
  ];
  for (let [key, value] of top) console.log(`${key}: ${value}`);
}

export function runVerifyLegendsCommand(argv = process.argv.slice(2)) {
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("Usage: world-mapgen verify-legends <legends.json> [viewer-dir]");
  return;
}
const [legendsPath, viewerDir] = argv;
if (!legendsPath) usage();

const resolvedLegendsPath = path.resolve(legendsPath);
const legends = readJson(resolvedLegendsPath);
const {issues} = validateArchive(legends);
if (viewerDir) validateViewer(issues, legends, path.resolve(viewerDir));

summarize(legends, viewerDir);
if (issues.length > 0) {
  console.error(`Legends verification failed with ${issues.length} issue(s):`);
  for (let issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Legends verification passed.");
}
