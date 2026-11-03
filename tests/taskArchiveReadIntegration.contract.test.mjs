import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
// Released manifest is copied by installer only as package metadata, so this
// test inventories the exact operational source files directly.
const files=['services/campaignWorkspaceCrm.service.js','services/executiveMissionControl.service.js','services/politicalGraph.service.js','services/aiTacticalIntelligence.service.js','services/launchAutomation.service.js','services/taskOwnership.service.js','services/workspaceActivity.service.js','services/unifiedExecutiveIntelligence.service.js','services/platformIntelligence.service.js','services/operationsLiveSignals.service.js','services/executiveKpi.service.js','services/influence.service.js','services/notificationCenter.service.js','services/politicalIntelligence.service.js','services/liveIntelligenceLayer.service.js','services/opportunityEngine.service.js','services/operationsScoring.service.js','services/scheduledReports.service.js','services/executiveWorkspace.service.js','services/universalSearch.service.js','routes/workspaceIntelligence.routes.js','routes/workspaces.routes.js','routes/workspaceOperatingRoom.routes.js','routes/tasks.routes.js'];
import baseline from './fixtures/taskArchiveReadHashes.json' with {type:'json'};
const hash=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n').replace(/^\uFEFF/,'')).digest('hex');
test('operational edits change only task read relation; auth, tenant filters, payloads and mutation checks are byte-equivalent',async()=>{
 for(const rel of files){const s=await fs.readFile(new URL('../'+rel,import.meta.url),'utf8');assert.match(s,/public\.operational_tasks/);const restored=s.replace(/\b(FROM|JOIN) public\.operational_tasks\b/gi,'$1 tasks');assert.equal(hash(restored),baseline[rel],rel);}
});
test('single task history/mutation checks and duplicate prevention still read original task rows',async()=>{
 const s=await fs.readFile(new URL('../routes/tasks.routes.js',import.meta.url),'utf8');assert.match(s,/SELECT \* FROM tasks WHERE id = \$1 AND firm_id = \$2/);const duplicate=s.slice(s.indexOf('async function findDuplicateTask'),s.indexOf('function normalizeTaskPayload'));assert.match(duplicate,/FROM tasks/);assert.doesNotMatch(duplicate,/operational_tasks/);
});
